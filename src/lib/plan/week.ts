import { prisma } from "@/lib/db";
import { addDays, dateKey, toDateOnly } from "@/lib/time";
import { computeAvailability } from "@/lib/scheduling/availability";

/**
 * The planning board: next week, from one person's point of view.
 *
 * People claim their own work here rather than waiting to be given it. A task
 * instance belongs to whoever took it first -- which matches how the catalogue
 * already talks ("OJO, max 1 integrante por dia"). Anything still unclaimed
 * when the week starts gets handed out by the engine, so nothing quietly goes
 * undone.
 */

export type PlanTask = {
  id: string;
  title: string;
  estimatedMinutes: number;
  origin: string;
  status: string;
  templateId: string | null;
  /** null when nobody has taken it yet. */
  assigneeId: string | null;
  assigneeName: string | null;
  mine: boolean;
  /** True once work has started -- moving or releasing it is no longer safe. */
  locked: boolean;
  notes: string | null;
};

export type PlanDay = {
  date: string;
  weekday: number;
  label: string;
  rostered: boolean;
  capacityMinutes: number;
  /** Only counts what this person has taken. */
  claimedMinutes: number;
  overBy: number;
  mine: PlanTask[];
  /** Unclaimed work in the department, offered to whoever wants it. */
  available: PlanTask[];
  /** Taken by somebody else -- shown so the day reads honestly. */
  taken: PlanTask[];
};

export type PlanWeek = {
  weekStart: string;
  isCurrentWeek: boolean;
  days: PlanDay[];
  departmentId: string;
  totalClaimed: number;
  totalCapacity: number;
  catalogue: {
    id: string;
    name: string;
    estimatedMinutes: number;
    category: string | null;
  }[];
};

const DAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Monday of the week containing `date`. */
export function mondayOf(date: Date): Date {
  const day = toDateOnly(date);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

/** The week people are normally planning: the one after this one. */
export function defaultPlanWeek(now: Date = new Date()): Date {
  return addDays(mondayOf(now), 7);
}

export async function getPlanWeek(
  userId: string,
  weekStart: Date,
): Promise<PlanWeek> {
  const monday = mondayOf(weekStart);
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
  const lastDay = allDays[6];

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { workingPatterns: true },
  });

  const [overrides, absences, tasks, catalogue] = await Promise.all([
    prisma.dayOverride.findMany({
      where: { userId, date: { gte: monday, lte: lastDay } },
    }),
    prisma.absence.findMany({
      where: { userId, startDate: { lte: lastDay }, endDate: { gte: monday } },
    }),
    // Everything in the department for that week, however it is currently
    // owned -- the board has to show what is already taken.
    prisma.task.findMany({
      where: {
        departmentId: user.departmentId,
        dueDate: { gte: monday, lte: lastDay },
        status: { not: "CANCELLED" },
      },
      include: {
        assignee: { select: { id: true, displayName: true } },
        template: { select: { notes: true } },
      },
      orderBy: [{ estimatedMinutes: "desc" }, { title: "asc" }],
    }),
    prisma.taskTemplate.findMany({
      where: { departmentId: user.departmentId, active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, estimatedMinutes: true, category: true },
    }),
  ]);

  const LOCKED = ["IN_PROGRESS", "PAUSED", "DONE"];

  const toPlanTask = (t: (typeof tasks)[number]): PlanTask => ({
    id: t.id,
    title: t.title,
    estimatedMinutes: t.estimatedMinutes,
    origin: t.origin,
    status: t.status,
    templateId: t.templateId,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.displayName ?? null,
    mine: t.assigneeId === userId,
    locked: LOCKED.includes(t.status),
    notes: t.template?.notes ?? null,
  });

  let totalClaimed = 0;
  let totalCapacity = 0;

  const days: PlanDay[] = allDays.map((date, index) => {
    const key = dateKey(date);
    const availability = computeAvailability({
      date,
      patterns: user.workingPatterns,
      overrides,
      absences,
    });

    const onThisDay = tasks.filter((t) => dateKey(t.dueDate) === key);
    const mine = onThisDay.filter((t) => t.assigneeId === userId).map(toPlanTask);
    const available = onThisDay
      .filter((t) => t.assigneeId === null)
      .map(toPlanTask);
    const taken = onThisDay
      .filter((t) => t.assigneeId !== null && t.assigneeId !== userId)
      .map(toPlanTask);

    const claimedMinutes = mine.reduce((s, t) => s + t.estimatedMinutes, 0);
    totalClaimed += claimedMinutes;
    totalCapacity += availability.availableMinutes;

    return {
      date: key,
      weekday: index + 1,
      label: DAY_LABELS[index],
      rostered: availability.rostered && availability.availableMinutes > 0,
      capacityMinutes: availability.availableMinutes,
      claimedMinutes,
      overBy: Math.max(0, claimedMinutes - availability.availableMinutes),
      mine,
      available,
      taken,
    };
  });

  return {
    weekStart: dateKey(monday),
    isCurrentWeek: dateKey(monday) === dateKey(mondayOf(new Date())),
    // Days nobody works are dropped, so the board is not mostly empty columns.
    days: days.filter(
      (d) => d.rostered || d.mine.length > 0 || d.available.length > 0,
    ),
    departmentId: user.departmentId,
    totalClaimed,
    totalCapacity,
    catalogue,
  };
}
