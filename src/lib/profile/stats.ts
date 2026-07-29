import { prisma } from "@/lib/db";
import { addDays, today as todayInZone, toDateOnly } from "@/lib/time";
import { elapsedSeconds } from "@/lib/tasks/elapsed";

/**
 * Somebody's own record.
 *
 * Deliberately framed as "where your time went", not "how productive were
 * you". The same numbers could be used either way; these are the ones a
 * person would want about themselves, and the comparisons are against their
 * own estimates rather than against colleagues.
 */

export type ProfileStats = {
  tenure: {
    startDate: string | null;
    endDate: string | null;
    daysHere: number | null;
    daysLeft: number | null;
    /** Friendlier than a day count on its own; worded by the page. */
    served: Span | null;
  };
  tracked: { week: number; month: number; total: number };
  completed: { week: number; month: number; total: number };
  estimate: {
    /** Tasks with both an estimate and real tracked time. */
    sample: number;
    estimatedMinutes: number;
    actualMinutes: number;
    /** Positive means work takes longer than the catalogue says. */
    driftPercent: number | null;
  };
  /** `reason` is the PauseLog code -- translate with pause.reasons.*. */
  stalls: { reason: string; count: number; minutes: number }[];
  favourites: { title: string; count: number }[];
  timeOff: { category: string; days: number }[];
  pendingRequests: number;
  /** Mistakes reported, and how many pointed at the process rather than you. */
  p1n: { total: number; attention: number; process: number; applied: number };
  upcoming: { title: string; dueDate: string }[];
};

/**
 * How long somebody has been here, as numbers rather than as a sentence.
 *
 * This used to return "1 year, 7 months" already written out, which meant the
 * profile page said it in English however the rest of the page was set. The
 * words are the page's job now -- see profile.span* in the dictionary.
 */
export type Span =
  | { unit: "days"; days: number }
  | { unit: "months"; months: number }
  | { unit: "years"; years: number }
  | { unit: "yearsMonths"; years: number; months: number };

function describeSpan(days: number): Span {
  if (days < 31) return { unit: "days", days };
  const months = Math.floor(days / 30.44);
  const years = Math.floor(months / 12);
  const restMonths = months % 12;
  if (years === 0) return { unit: "months", months };
  if (restMonths === 0) return { unit: "years", years };
  return { unit: "yearsMonths", years, months: restMonths };
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const today = todayInZone();
  const weekStart = addDays(today, -((today.getUTCDay() + 6) % 7));
  const monthStart = toDateOnly(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
  );
  const yearStart = toDateOnly(new Date(Date.UTC(today.getUTCFullYear(), 0, 1)));

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { startDate: true, endDate: true },
  });

  // --- everything they have ever worked on, with its pauses
  const entries = await prisma.timeEntry.findMany({
    where: { userId },
    include: { pauses: true, task: { select: { id: true, title: true } } },
  });

  const now = new Date();
  const secondsIn = (from: Date) =>
    entries
      .filter((e) => e.startedAt >= from)
      .reduce((sum, e) => sum + elapsedSeconds([e], now), 0);

  const doneTasks = await prisma.task.findMany({
    where: { assigneeId: userId, status: "DONE" },
    select: { id: true, title: true, estimatedMinutes: true, dueDate: true },
  });

  const doneIds = new Set(doneTasks.map((t) => t.id));
  const secondsByTask = new Map<string, number>();
  for (const entry of entries) {
    secondsByTask.set(
      entry.taskId,
      (secondsByTask.get(entry.taskId) ?? 0) + elapsedSeconds([entry], now),
    );
  }

  // --- estimate drift, over tasks that were actually timed
  let estimated = 0;
  let actual = 0;
  let sample = 0;
  for (const task of doneTasks) {
    const seconds = secondsByTask.get(task.id);
    if (!seconds || seconds < 30) continue; // never started, or a mis-click
    estimated += task.estimatedMinutes;
    actual += seconds / 60;
    sample += 1;
  }

  // --- what stops the work
  const stallMap = new Map<string, { count: number; minutes: number }>();
  for (const entry of entries) {
    for (const pause of entry.pauses) {
      const end = pause.resumedAt ?? now;
      const minutes = Math.max(
        0,
        (end.getTime() - pause.pausedAt.getTime()) / 60000,
      );
      // Grouped by the raw code; the page turns it into words with
      // pause.reasons.*, which the pause dialog already uses.
      const key = pause.reasonCode;
      const at = stallMap.get(key) ?? { count: 0, minutes: 0 };
      stallMap.set(key, { count: at.count + 1, minutes: at.minutes + minutes });
    }
  }

  // --- the jobs they do most
  const titleCount = new Map<string, number>();
  for (const task of doneTasks) {
    titleCount.set(task.title, (titleCount.get(task.title) ?? 0) + 1);
  }

  // --- time off taken this year
  const absences = await prisma.absence.findMany({
    where: { userId, status: "APPROVED", startDate: { gte: yearStart } },
  });
  const offMap = new Map<string, number>();
  for (const a of absences) {
    const days =
      Math.round(
        (toDateOnly(a.endDate).getTime() - toDateOnly(a.startDate).getTime()) /
          86_400_000,
      ) + 1;
    const key = a.category.toLowerCase();
    offMap.set(key, (offMap.get(key) ?? 0) + (a.scope === "PARTIAL" ? 0.5 : days));
  }

  const pendingRequests = await prisma.absence.count({
    where: { userId, status: "PENDING" },
  });

  const p1ns = await prisma.p1n.findMany({
    where: { userId },
    select: { cause: true, appliedAt: true },
  });

  // --- their own induction interviews still to come
  const upcoming = await prisma.task.findMany({
    where: {
      externalKey: { startsWith: `onboarding:${userId}:` },
      status: { notIn: ["DONE", "CANCELLED"] },
      dueDate: { gte: today },
    },
    orderBy: { dueDate: "asc" },
    take: 3,
    select: { title: true, dueDate: true },
  });

  const daysHere = user.startDate
    ? Math.max(
        0,
        Math.round(
          (today.getTime() - toDateOnly(user.startDate).getTime()) / 86_400_000,
        ),
      )
    : null;

  const daysLeft = user.endDate
    ? Math.max(
        0,
        Math.round(
          (toDateOnly(user.endDate).getTime() - today.getTime()) / 86_400_000,
        ),
      )
    : null;

  return {
    tenure: {
      startDate: user.startDate
        ? toDateOnly(user.startDate).toISOString().slice(0, 10)
        : null,
      endDate: user.endDate
        ? toDateOnly(user.endDate).toISOString().slice(0, 10)
        : null,
      daysHere,
      daysLeft,
      served: daysHere !== null ? describeSpan(daysHere) : null,
    },
    tracked: {
      week: Math.round(secondsIn(weekStart) / 60),
      month: Math.round(secondsIn(monthStart) / 60),
      total: Math.round(secondsIn(new Date(0)) / 60),
    },
    completed: {
      week: doneTasks.filter((t) => toDateOnly(t.dueDate) >= weekStart).length,
      month: doneTasks.filter((t) => toDateOnly(t.dueDate) >= monthStart).length,
      total: doneIds.size,
    },
    estimate: {
      sample,
      estimatedMinutes: Math.round(estimated),
      actualMinutes: Math.round(actual),
      driftPercent:
        sample > 0 && estimated > 0
          ? Math.round(((actual - estimated) / estimated) * 100)
          : null,
    },
    stalls: [...stallMap.entries()]
      .map(([reason, v]) => ({ reason, count: v.count, minutes: Math.round(v.minutes) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5),
    favourites: [...titleCount.entries()]
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    timeOff: [...offMap.entries()]
      .map(([category, days]) => ({ category, days }))
      .sort((a, b) => b.days - a.days),
    pendingRequests,
    p1n: {
      total: p1ns.length,
      attention: p1ns.filter((p) => p.cause === "ATTENTION").length,
      process: p1ns.filter((p) => p.cause === "PROCESS").length,
      applied: p1ns.filter((p) => p.appliedAt !== null).length,
    },
    upcoming: upcoming.map((t) => ({
      title: t.title,
      dueDate: toDateOnly(t.dueDate).toISOString().slice(0, 10),
    })),
  };
}
