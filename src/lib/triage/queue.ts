import { prisma } from "@/lib/db";
import { addDays, dateKey, today as todayInZone, toDateOnly } from "@/lib/time";
import { getAvailabilityForRange } from "@/lib/scheduling/availability-db";
import { findSlot } from "@/lib/scheduling/availability";

/**
 * Orphaned work, with the options already worked out.
 *
 * The manager decides -- nothing here moves on its own -- but they should be
 * choosing between concrete answers, not going away to research who is free.
 * So each orphan arrives with the colleagues who genuinely have room for it
 * that day, in rotation order, and the earliest date its original owner could
 * pick it back up.
 */

const LOOKAHEAD_DAYS = 21;

export type Candidate = {
  userId: string;
  displayName: string;
  /** Free minutes left that day once existing work is counted. */
  freeMinutes: number;
  /** Times they have been given this job before -- lower is fairer. */
  timesGiven: number;
  slotStart: number;
};

export type OrphanedTask = {
  id: string;
  title: string;
  estimatedMinutes: number;
  scheduledDate: string | null;
  origin: string;
  orphanReason: string | null;
  previousAssignee: string | null;
  candidates: Candidate[];
  /** Earliest date the original assignee could do it themselves. */
  earliestOwnerDate: string | null;
};

export async function getTriageQueue(
  departmentId: string,
): Promise<OrphanedTask[]> {
  const orphans = await prisma.task.findMany({
    where: { departmentId, status: "ORPHANED" },
    include: { assignee: { select: { id: true, displayName: true } } },
    orderBy: [{ scheduledDate: "asc" }, { title: "asc" }],
  });

  if (orphans.length === 0) return [];

  const people = await prisma.user.findMany({
    where: { departmentId, active: true },
    select: { id: true, displayName: true },
  });

  const today = todayInZone();
  const horizon = addDays(today, LOOKAHEAD_DAYS);
  const dates: Date[] = [];
  for (let d = today; d <= horizon; d = addDays(d, 1)) dates.push(d);

  const availability = await getAvailabilityForRange(
    people.map((p) => p.id),
    dates,
  );

  // What each person already has booked, per day, so "free" means free.
  const booked = await prisma.task.groupBy({
    by: ["assigneeId", "scheduledDate"],
    where: {
      assigneeId: { in: people.map((p) => p.id) },
      scheduledDate: { gte: today, lte: horizon },
      status: { in: ["ASSIGNED", "IN_PROGRESS", "PAUSED", "DONE"] },
    },
    _sum: { estimatedMinutes: true },
  });

  const bookedBy = new Map<string, number>();
  for (const row of booked) {
    if (!row.assigneeId || !row.scheduledDate) continue;
    bookedBy.set(
      `${row.assigneeId}:${dateKey(row.scheduledDate)}`,
      row._sum.estimatedMinutes ?? 0,
    );
  }

  const templateIds = orphans
    .map((o) => o.templateId)
    .filter((id): id is string => id !== null);

  const ledger = await prisma.rotationLedger.findMany({
    where: { templateId: { in: templateIds } },
  });
  const timesGivenBy = new Map(
    ledger.map((r) => [`${r.templateId}:${r.userId}`, r.assignedCount]),
  );

  const freeOn = (userId: string, date: Date) => {
    const avail = availability.get(userId)?.get(dateKey(date));
    if (!avail) return null;
    const used = bookedBy.get(`${userId}:${dateKey(date)}`) ?? 0;
    return { avail, free: Math.max(0, avail.availableMinutes - used) };
  };

  return orphans.map((task) => {
    const day = task.scheduledDate ? toDateOnly(task.scheduledDate) : today;

    const candidates: Candidate[] = people
      .filter((p) => p.id !== task.assigneeId)
      .map((p) => {
        const state = freeOn(p.id, day);
        if (!state || state.free < task.estimatedMinutes) return null;

        const slot = findSlot(state.avail.windows, task.estimatedMinutes);
        if (!slot) return null;

        return {
          userId: p.id,
          displayName: p.displayName,
          freeMinutes: state.free,
          timesGiven: task.templateId
            ? (timesGivenBy.get(`${task.templateId}:${p.id}`) ?? 0)
            : 0,
          slotStart: slot.start,
        };
      })
      .filter((c): c is Candidate => c !== null)
      // Same fairness rule the engine uses: least-given first, then most room.
      .sort(
        (a, b) =>
          a.timesGiven - b.timesGiven || b.freeMinutes - a.freeMinutes,
      );

    // When could the original owner do it themselves?
    let earliestOwnerDate: string | null = null;
    if (task.assigneeId) {
      for (const date of dates) {
        if (dateKey(date) <= dateKey(day)) continue;
        const state = freeOn(task.assigneeId, date);
        if (state && state.free >= task.estimatedMinutes) {
          earliestOwnerDate = dateKey(date);
          break;
        }
      }
    }

    return {
      id: task.id,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      scheduledDate: task.scheduledDate ? dateKey(task.scheduledDate) : null,
      origin: task.origin,
      orphanReason: task.orphanReason,
      previousAssignee: task.assignee?.displayName ?? null,
      candidates: candidates.slice(0, 4),
      earliestOwnerDate,
    };
  });
}

/**
 * Somebody said they could not do a task, and what they chose to happen to it.
 *
 * The first thing a manager should see. An orphan is the system reporting a
 * clash of dates; this is a person reporting that the plan did not survive
 * contact with the day, which is both more useful and more perishable.
 *
 * Unresolved only, newest first. Resolved rows stay in the table so "why did
 * this move" is still answerable, but they are not a queue any more.
 */
export type StuckTask = {
  blockId: string;
  taskId: string;
  title: string;
  estimatedMinutes: number;
  who: string;
  reason: string;
  outcome: string;
  /** Where they moved it to, for MOVED. */
  movedTo: string | null;
  when: string;
  /** Whether the task is still theirs to be given back. */
  stillOwned: boolean;
  status: string;
};

export async function getStuckQueue(departmentId: string): Promise<StuckTask[]> {
  const blocks = await prisma.taskBlock.findMany({
    where: { resolvedAt: null, task: { departmentId } },
    include: {
      user: { select: { displayName: true } },
      task: {
        select: {
          id: true,
          title: true,
          estimatedMinutes: true,
          status: true,
          assigneeId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return blocks
    // A task cancelled or finished since is no longer a decision anybody owes.
    .filter((b) => !["CANCELLED", "DONE"].includes(b.task.status))
    .map((b) => ({
      blockId: b.id,
      taskId: b.task.id,
      title: b.task.title,
      estimatedMinutes: b.task.estimatedMinutes,
      who: b.user.displayName,
      reason: b.reason,
      outcome: b.outcome,
      movedTo: b.movedTo ? dateKey(b.movedTo) : null,
      when: b.createdAt.toISOString(),
      stillOwned: b.task.assigneeId !== null,
      status: b.task.status,
    }));
}

/**
 * Work the engine could not place, with the reason it worked out at the time.
 *
 * This used to be a bare count and a paragraph of prose, because assignDay
 * computed a reason every run and runSchedule threw it away. Persisting it
 * turns "4 tasks nobody had room for" into a list, and separates the ones
 * waiting on a spare hour from the ones that will never fit until they are
 * split up.
 */
export type UnplacedTask = {
  id: string;
  title: string;
  estimatedMinutes: number;
  dueDate: string;
  reason: string | null;
};

export async function getUnplaced(departmentId: string): Promise<UnplacedTask[]> {
  const tasks = await prisma.task.findMany({
    where: { departmentId, status: "UNASSIGNED", assigneeId: null },
    select: {
      id: true,
      title: true,
      estimatedMinutes: true,
      dueDate: true,
      unplacedReason: true,
    },
    orderBy: [{ dueDate: "asc" }, { estimatedMinutes: "desc" }],
    take: 40,
  });

  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    estimatedMinutes: t.estimatedMinutes,
    dueDate: dateKey(t.dueDate),
    reason: t.unplacedReason,
  }));
}

/**
 * Recent slips: work that moved, and what the person said about it.
 *
 * TaskDeferral has been written on every deferral since the feature shipped
 * and read by nothing at all. A manager who wants to know why a week keeps
 * sliding has had no way to find out.
 */
export type Slip = {
  taskId: string;
  title: string;
  who: string;
  reason: string;
  from: string;
  to: string;
  when: string;
};

export async function getRecentSlips(
  departmentId: string,
  days = 7,
): Promise<Slip[]> {
  const since = new Date(Date.now() - days * 86_400_000);

  const deferrals = await prisma.taskDeferral.findMany({
    where: { createdAt: { gte: since }, task: { departmentId } },
    include: {
      user: { select: { displayName: true } },
      task: { select: { id: true, title: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return deferrals
    .filter((d) => d.task.status !== "CANCELLED")
    .map((d) => ({
      taskId: d.task.id,
      title: d.task.title,
      who: d.user.displayName,
      reason: d.reason,
      from: dateKey(d.fromDate),
      to: dateKey(d.toDate),
      when: d.createdAt.toISOString(),
    }));
}
