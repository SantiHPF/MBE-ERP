import { prisma } from "@/lib/db";
import { addDays, dateKey, toDateOnly } from "@/lib/time";
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
  anchor: Date = new Date(),
): Promise<TeamWeek> {
  const monday = weekStart(anchor);
  const days = [0, 1, 2, 3, 4].map((n) => addDays(monday, n));
  const friday = days[4];

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
      where: { userId: { in: userIds }, date: { gte: monday, lte: friday } },
    }),
    prisma.absence.findMany({
      where: {
        userId: { in: userIds },
        startDate: { lte: friday },
        endDate: { gte: monday },
      },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: { in: userIds },
        scheduledDate: { gte: monday, lte: friday },
        status: { notIn: ["CANCELLED"] },
      },
      orderBy: { scheduledStart: "asc" },
    }),
    prisma.task.count({
      where: { departmentId, status: "ORPHANED" },
    }),
  ]);

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

      const blocks: WeekBlock[] = mine.tasks
        .filter((t) => t.scheduledDate && dateKey(t.scheduledDate) === key)
        .map((t) => ({
          id: t.id,
          title: t.title,
          start: t.scheduledStart ?? 0,
          end: t.scheduledEnd ?? 0,
          status: t.status,
          estimatedMinutes: t.estimatedMinutes,
        }));

      const booked = blocks.reduce((s, b) => s + b.estimatedMinutes, 0);
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
