import { prisma } from "@/lib/db";
import { addDays, dateKey, toDateOnly } from "@/lib/time";
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

  const today = toDateOnly(new Date());
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
