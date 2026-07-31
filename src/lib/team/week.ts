import { prisma } from "@/lib/db";
import { addDays, dateKey, today, toDateOnly } from "@/lib/time";
import { computeAvailability, type Window } from "@/lib/scheduling/availability";

/**
 * A department's week: everyone's real hours as the backdrop, the work
 * scheduled inside them, and absences marked rather than hidden.
 */

export type WeekBlock = {
  id: string;
  title: string;
  start: number;
  end: number;
  status: string;
  estimatedMinutes: number;
};

export type WeekDay = {
  date: string;
  rostered: boolean;
  /** Free stretches after breaks and absences. Empty when absent. */
  windows: Window[];
  availableMinutes: number;
  bookedMinutes: number;
  absent: boolean;
  absenceCategory: string | null;
  blocks: WeekBlock[];
  /**
   * Owed on this day but with no slot: the day was too full, or too broken up,
   * to hold it. Kept apart from `blocks` because it has no start time, and
   * defaulting one to midnight drew it as a task that begins at 00:00.
   */
  unplaced: WeekBlock[];
};

export type WeekPerson = {
  id: string;
  displayName: string;
  role: string;
  weeklyMinutes: number;
  bookedMinutes: number;
  days: WeekDay[];
};

export type TeamWeek = {
  departmentId: string;
  departmentName: string;
  weekStart: string;
  dates: string[];
  people: WeekPerson[];
  orphanCount: number;
};

/** Monday of the week containing `date`. */
export function weekStart(date: Date): Date {
  const day = toDateOnly(date);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

export async function getTeamWeek(
  departmentId: string,
  anchor: Date = today(),
): Promise<TeamWeek> {
  const monday = weekStart(anchor);
  // The whole week is considered, not just Mon-Fri: split shifts and Saturday
  // work are normal here. Which columns actually get shown is decided below,
  // from who works when.
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
  const lastDay = allDays[6];

  const department = await prisma.department.findUniqueOrThrow({
    where: { id: departmentId },
  });

  const users = await prisma.user.findMany({
    where: { departmentId, active: true },
    include: { workingPatterns: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });

  const userIds = users.map((u) => u.id);

  const [overrides, absences, tasks, orphanCount] = await Promise.all([
    prisma.dayOverride.findMany({
      where: { userId: { in: userIds }, date: { gte: monday, lte: lastDay } },
    }),
    prisma.absence.findMany({
      where: {
        userId: { in: userIds },
        startDate: { lte: lastDay },
        endDate: { gte: monday },
      },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: { in: userIds },
        scheduledDate: { gte: monday, lte: lastDay },
        status: { notIn: ["CANCELLED"] },
      },
      orderBy: { scheduledStart: "asc" },
    }),
    prisma.task.count({
      where: { departmentId, status: "ORPHANED" },
    }),
  ]);

  // Show Monday to Friday always, plus any weekend day somebody actually
  // works -- so a Saturday shift is visible instead of silently dropped.
  const workedWeekdays = new Set(
    users.flatMap((u) => u.workingPatterns.map((p) => p.weekday)),
  );
  const days = allDays.filter((date, index) => {
    const weekday = index + 1;
    return weekday <= 5 || workedWeekdays.has(weekday);
  });

  const people: WeekPerson[] = users.map((user) => {
    const mine = {
      overrides: overrides.filter((o) => o.userId === user.id),
      absences: absences.filter((a) => a.userId === user.id),
      tasks: tasks.filter((t) => t.assigneeId === user.id),
    };

    let weeklyMinutes = 0;
    let personBooked = 0;

    const weekDays: WeekDay[] = days.map((date) => {
      const key = dateKey(date);
      const availability = computeAvailability({
        date,
        patterns: user.workingPatterns,
        overrides: mine.overrides,
        absences: mine.absences,
      });

      const covering = mine.absences.find(
        (a) => dateKey(a.startDate) <= key && key <= dateKey(a.endDate),
      );

      const onThisDay = mine.tasks.filter(
        (t) => t.scheduledDate && dateKey(t.scheduledDate) === key,
      );

      const toBlock = (t: (typeof onThisDay)[number]): WeekBlock => ({
        id: t.id,
        title: t.title,
        start: t.scheduledStart ?? 0,
        end: t.scheduledEnd ?? 0,
        status: t.status,
        estimatedMinutes: t.estimatedMinutes,
      });

      const blocks: WeekBlock[] = onThisDay
        .filter((t) => t.scheduledStart != null)
        .map(toBlock);

      /**
       * Work that belongs to this day but never got a slot -- an over-full day,
       * or an anchored task whose half of the day was already gone. It is still
       * owed, so it still counts towards the day's load; it simply has no time
       * to be drawn at.
       */
      const unplaced: WeekBlock[] = onThisDay
        .filter((t) => t.scheduledStart == null)
        .map(toBlock);

      const booked = [...blocks, ...unplaced].reduce(
        (s, b) => s + b.estimatedMinutes,
        0,
      );
      weeklyMinutes += availability.availableMinutes;
      personBooked += booked;

      return {
        date: key,
        rostered: availability.rostered,
        windows: availability.windows,
        availableMinutes: availability.availableMinutes,
        bookedMinutes: booked,
        // Rostered but with nothing left means an absence took the day, which
        // is a different thing from simply not working that weekday.
        absent: availability.rostered && availability.availableMinutes === 0,
        absenceCategory: covering?.category ?? null,
        blocks,
        unplaced,
      };
    });

    return {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      weeklyMinutes,
      bookedMinutes: personBooked,
      days: weekDays,
    };
  });

  return {
    departmentId,
    departmentName: department.name,
    weekStart: dateKey(monday),
    dates: days.map(dateKey),
    people,
    orphanCount,
  };
}
