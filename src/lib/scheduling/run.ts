import { prisma } from "@/lib/db";
import { addDays, dateKey, eachDay, today, toDateOnly } from "@/lib/time";
import { getAvailabilityForRange } from "./availability-db";
import { diffAgainstExisting, planRecurringTasks } from "./materialize";
import { assignDay, type CandidateInput, type TaskInput } from "./assign";
import { syncOnboarding } from "@/lib/people/onboarding-db";
import { syncCrmCalls } from "@/lib/crm/sync";
import { sweepOpenDays } from "@/lib/attendance/attendance-db";

/**
 * The scheduling run: materialize what the rules say should exist, then place
 * it on people.
 *
 * Re-running is safe. Generated tasks are keyed so they are never duplicated,
 * and anything a person has already started, paused or finished is treated as
 * immovable -- the engine schedules around it rather than through it.
 */

export type RunSummary = {
  from: Date;
  to: Date;
  created: number;
  alreadyPresent: number;
  /** Generated work removed because no rule produces it any more. */
  removedStale: number;
  /** Induction interviews created for joiners. */
  onboardingCreated: number;
  /** Batched CRM call tasks raised for today. */
  crmCallsCreated: number;
  /** Past workdays nobody closed, closed by the sweep. */
  attendanceClosed: number;
  /** Abandoned timers ended, which stops them counting for ever. */
  timersClosed: number;
  assigned: number;
  unassigned: number;
  skippedInFlight: number;
};

/** Statuses the engine must never touch. Someone is mid-task, or it is done. */
const IMMOVABLE = ["IN_PROGRESS", "PAUSED", "DONE"] as const;

export async function runSchedule(options?: {
  from?: Date;
  to?: Date;
  departmentId?: string;
}): Promise<RunSummary> {
  const from = options?.from ? toDateOnly(options.from) : today();
  const to = toDateOnly(options?.to ?? addDays(from, 13));
  const days = eachDay(from, to);

  // ------------------------------------------------- 1. materialize rules

  const rules = await prisma.recurringRule.findMany({
    where: {
      active: true,
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
    },
    include: { template: true },
  });

  // Joiners' induction interviews are kept in existence here too, so an
  // indefinite contract never runs out of two-monthly reviews.
  const onboarding = await syncOnboarding();

  // And the CRM's calls: one batched task per CRM per day, holding whoever is
  // owed a call. Today only -- see syncCrmCalls.
  const crm = await syncCrmCalls(options?.departmentId);

  // Close yesterday's books before planning tomorrow: workdays nobody ended,
  // and the abandoned timers that were counting until somebody happened to
  // start something else.
  const attendance = await sweepOpenDays();

  const planned = planRecurringTasks({ rules, from, to });

  /**
   * Sweep up generated work whose rule no longer says it should happen --
   * the rule was retired, deleted, or moved to different days. Only tasks
   * nobody has picked up are removed; anything assigned or started belongs
   * to a person now and is left for them or their manager to deal with.
   */
  const liveKeys = new Set(planned.map((p) => p.externalKey));
  const stale = await prisma.task.findMany({
    where: {
      origin: "RECURRING",
      status: "UNASSIGNED",
      dueDate: { gte: from, lte: to },
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
    },
    select: { id: true, externalKey: true },
  });
  const staleIds = stale
    .filter(
      (t) =>
        t.externalKey &&
        // Onboarding work is generated per person, not per rule, and is
        // looked after by syncOnboarding.
        t.externalKey.startsWith("recurring:") &&
        !liveKeys.has(t.externalKey),
    )
    .map((t) => t.id);
  if (staleIds.length > 0) {
    await prisma.task.deleteMany({ where: { id: { in: staleIds } } });
  }

  const existing = await prisma.task.findMany({
    where: { externalKey: { in: planned.map((p) => p.externalKey) } },
    select: { externalKey: true },
  });

  const { toCreate, alreadyPresent } = diffAgainstExisting(
    planned,
    new Set(existing.map((e) => e.externalKey).filter((k): k is string => !!k)),
  );

  if (toCreate.length > 0) {
    await prisma.task.createMany({
      data: toCreate.map((t) => ({
        externalKey: t.externalKey,
        title: t.title,
        estimatedMinutes: t.estimatedMinutes,
        dueDate: t.dueDate,
        departmentId: t.departmentId,
        templateId: t.templateId,
        priority: t.priority,
        origin: "RECURRING" as const,
        status: "UNASSIGNED" as const,
        // Stored on the task so re-placing it later still knows where in the
        // day it belongs, long after this run's plan is gone.
        anchor: t.anchor,
      })),
    });
  }

  // Fixed windows and routine grouping live on the rule, not the task, so keep
  // a lookup for later.
  const fixedByKey = new Map(
    planned.map((p) => [
      p.externalKey,
      {
        start: p.fixedStartMinutes,
        end: p.fixedEndMinutes,
        groupKey: p.groupKey,
      },
    ]),
  );

  // ------------------------------------------------------ 2. gather state

  const people = await prisma.user.findMany({
    where: {
      active: true,
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
    },
    select: { id: true, departmentId: true },
  });

  const availability = await getAvailabilityForRange(
    people.map((p) => p.id),
    days,
  );

  const allTasks = await prisma.task.findMany({
    where: {
      dueDate: { gte: from, lte: to },
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
      status: { notIn: ["CANCELLED"] },
    },
    include: { actionItem: { select: { pinnedAssigneeId: true } } },
  });

  // Rotation history is counted strictly *before* the window being scheduled.
  //
  // Reading the stored ledger instead would make runs unstable: run one writes
  // the window's assignments into the ledger, run two reads them back and
  // ranks differently, and the schedule shuffles under people every time the
  // engine fires. Counting only prior work makes the run a pure function of
  // history, so re-running is a no-op.
  const priorAssignments = await prisma.task.groupBy({
    by: ["templateId", "assigneeId"],
    where: {
      templateId: { not: null },
      assigneeId: { not: null },
      dueDate: { lt: from },
    },
    _count: { _all: true },
    _max: { dueDate: true },
  });

  const rotation = priorAssignments.map((row) => ({
    templateId: row.templateId as string,
    userId: row.assigneeId as string,
    assignedCount: row._count._all,
    lastAssignedAt: row._max.dueDate,
  }));

  // One-off fairness: how many template-less tasks each person picked up in
  // the last 30 days.
  const recentOneOffs = await prisma.task.groupBy({
    by: ["assigneeId"],
    where: {
      templateId: null,
      assigneeId: { not: null },
      dueDate: { gte: addDays(from, -30), lt: from },
    },
    _count: { _all: true },
  });

  const oneOffLoad = recentOneOffs
    .filter((r) => r.assigneeId)
    .map((r) => ({ userId: r.assigneeId as string, count: r._count._all }));

  // ----------------------------------------------------------- 3. assign

  const summary: RunSummary = {
    from,
    to,
    created: toCreate.length,
    alreadyPresent,
    removedStale: staleIds.length + onboarding.removed + crm.removed,
    onboardingCreated: onboarding.created,
    crmCallsCreated: crm.created,
    attendanceClosed: attendance.daysClosed,
    timersClosed: attendance.entriesClosed,
    assigned: 0,
    unassigned: 0,
    skippedInFlight: 0,
  };

  // Rotation counts must carry across days within a run, or Monday and
  // Tuesday would both go to the same "fairest" person.
  const runningRotation = rotation.map((r) => ({ ...r }));
  const runningOneOff = [...oneOffLoad];

  const writes: {
    taskId: string;
    userId: string | null;
    date: Date | null;
    start: number | null;
    end: number | null;
    status: "ASSIGNED" | "UNASSIGNED";
  }[] = [];

  for (const date of days) {
    const key = dateKey(date);
    const dayTasks = allTasks.filter((t) => dateKey(t.dueDate) === key);

    const inFlight = dayTasks.filter((t) =>
      (IMMOVABLE as readonly string[]).includes(t.status),
    );
    summary.skippedInFlight += inFlight.length;

    const schedulable = dayTasks.filter(
      (t) => !(IMMOVABLE as readonly string[]).includes(t.status),
    );
    if (schedulable.length === 0) continue;

    // Time already spoken for by in-flight work, per person.
    const busyBy = new Map<string, { start: number; end: number }[]>();
    const committedBy = new Map<string, number>();
    for (const t of inFlight) {
      if (!t.assigneeId) continue;
      committedBy.set(
        t.assigneeId,
        (committedBy.get(t.assigneeId) ?? 0) + t.estimatedMinutes,
      );
      if (t.scheduledStart != null && t.scheduledEnd != null) {
        const list = busyBy.get(t.assigneeId) ?? [];
        list.push({ start: t.scheduledStart, end: t.scheduledEnd });
        busyBy.set(t.assigneeId, list);
      }
    }

    const candidates: CandidateInput[] = people
      .map((p) => {
        const avail = availability.get(p.id)?.get(key);
        if (!avail) return null;
        return {
          userId: p.id,
          departmentId: p.departmentId,
          availability: avail,
          committedMinutes: committedBy.get(p.id) ?? 0,
          busy: busyBy.get(p.id) ?? [],
        };
      })
      .filter((c): c is CandidateInput => c !== null);

    const taskInputs: TaskInput[] = schedulable.map((t) => {
      const fixed = t.externalKey ? fixedByKey.get(t.externalKey) : undefined;
      return {
        id: t.id,
        departmentId: t.departmentId,
        estimatedMinutes: t.estimatedMinutes,
        templateId: t.templateId,
        priority: t.priority,
        pinnedAssigneeId: t.actionItem?.pinnedAssigneeId ?? null,
        fixedStartMinutes: fixed?.start ?? null,
        fixedEndMinutes: fixed?.end ?? null,
        // The task's own anchor is authoritative -- it survives a rule being
        // edited between the run that created it and this one.
        anchor: t.anchor,
        groupKey: t.anchor ? (fixed?.groupKey ?? null) : null,
      };
    });

    const result = assignDay({
      date,
      tasks: taskInputs,
      candidates,
      rotation: runningRotation,
      oneOffLoad: runningOneOff,
    });

    for (const a of result.assignments) {
      writes.push({
        taskId: a.taskId,
        userId: a.userId,
        date,
        start: a.start,
        end: a.end,
        status: "ASSIGNED",
      });

      const task = taskInputs.find((t) => t.id === a.taskId);
      if (task?.templateId) {
        const row = runningRotation.find(
          (r) => r.templateId === task.templateId && r.userId === a.userId,
        );
        if (row) {
          row.assignedCount += 1;
          row.lastAssignedAt = date;
        } else {
          runningRotation.push({
            templateId: task.templateId,
            userId: a.userId,
            assignedCount: 1,
            lastAssignedAt: date,
          });
        }
      } else {
        const row = runningOneOff.find((r) => r.userId === a.userId);
        if (row) row.count += 1;
        else runningOneOff.push({ userId: a.userId, count: 1 });
      }
    }

    for (const u of result.unassigned) {
      writes.push({
        taskId: u.taskId,
        userId: null,
        date: null,
        start: null,
        end: null,
        status: "UNASSIGNED",
      });
    }

    summary.assigned += result.assignments.length;
    summary.unassigned += result.unassigned.length;
  }

  // ------------------------------------------------------------ 4. persist

  await prisma.$transaction(
    writes.map((w) =>
      prisma.task.update({
        where: { id: w.taskId },
        data: {
          assigneeId: w.userId,
          scheduledDate: w.date,
          scheduledStart: w.start,
          scheduledEnd: w.end,
          status: w.status,
        },
      }),
    ),
  );

  await refreshRotationLedger();

  return summary;
}

/**
 * Rebuild the rotation ledger from the tasks themselves.
 *
 * The ledger is a cache of a derivable fact -- how often each person has been
 * given each template. Incrementing it per run looked simpler but was wrong:
 * a second run over the same window reassigns the same work and would count
 * it twice, inflating the counters and skewing every later run. Recomputing
 * is self-correcting, and cheap at this headcount.
 */
export async function refreshRotationLedger(): Promise<void> {
  const [assigned, completed] = await Promise.all([
    prisma.task.groupBy({
      by: ["templateId", "assigneeId"],
      where: { templateId: { not: null }, assigneeId: { not: null } },
      _count: { _all: true },
      _max: { dueDate: true },
    }),
    prisma.task.groupBy({
      by: ["templateId", "assigneeId"],
      where: {
        templateId: { not: null },
        assigneeId: { not: null },
        status: "DONE",
      },
      _count: { _all: true },
    }),
  ]);

  const completedBy = new Map(
    completed.map((c) => [`${c.templateId}:${c.assigneeId}`, c._count._all]),
  );

  const liveKeys = new Set(
    assigned.map((row) => `${row.templateId}:${row.assigneeId}`),
  );

  // Drop rows whose pairing no longer has any tasks -- otherwise a
  // reassignment leaves a phantom count behind that skews future ranking.
  const stored = await prisma.rotationLedger.findMany({
    select: { id: true, templateId: true, userId: true },
  });
  const staleIds = stored
    .filter((r) => !liveKeys.has(`${r.templateId}:${r.userId}`))
    .map((r) => r.id);

  await prisma.$transaction([
    ...(staleIds.length > 0
      ? [prisma.rotationLedger.deleteMany({ where: { id: { in: staleIds } } })]
      : []),
    ...assigned.map((row) => {
      const templateId = row.templateId as string;
      const userId = row.assigneeId as string;
      return prisma.rotationLedger.upsert({
        where: { templateId_userId: { templateId, userId } },
        create: {
          templateId,
          userId,
          assignedCount: row._count._all,
          completedCount: completedBy.get(`${templateId}:${userId}`) ?? 0,
          lastAssignedAt: row._max.dueDate,
        },
        update: {
          assignedCount: row._count._all,
          completedCount: completedBy.get(`${templateId}:${userId}`) ?? 0,
          lastAssignedAt: row._max.dueDate,
        },
      });
    }),
  ]);
}
