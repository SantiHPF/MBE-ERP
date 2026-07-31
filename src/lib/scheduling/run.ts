import { prisma } from "@/lib/db";
import { addDays, dateKey, eachDay, today, toDateOnly } from "@/lib/time";
import { getAvailabilityForRange } from "./availability-db";
import {
  ANCHOR_LABEL,
  coverageKey,
  diffAgainstExisting,
  dropAlreadyCovered,
  planRecurringTasks,
} from "./materialize";
import type { DayAnchor } from "./availability";
import { assignDay, type CandidateInput, type TaskInput } from "./assign";
import { syncOnboarding } from "@/lib/people/onboarding-db";
import { syncCrmCalls } from "@/lib/crm/sync";
import { sweepOpenDays } from "@/lib/attendance/attendance-db";
import { createFollowers } from "@/lib/plan/follow-db";
import {
  ensureSessions,
  parentsNeedingSpread,
  respreadSessions,
} from "@/lib/plan/sessions-db";
import { DEFAULT_SESSION_MINUTES, planSessions } from "@/lib/plan/sessions";

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
  /**
   * Repetitions a rule did not need to raise because somebody had already
   * planned that work themselves.
   */
  alreadyCovered: number;
  /** Induction interviews created for joiners. */
  onboardingCreated: number;
  /** Batched CRM call tasks raised for today. */
  crmCallsCreated: number;
  /** Second halves raised for work that goes hand in hand. */
  followersCreated: number;
  /** Past workdays nobody closed, closed by the sweep. */
  attendanceClosed: number;
  /** Abandoned timers ended, which stops them counting for ever. */
  timersClosed: number;
  /** Long jobs cut into sittings this run. */
  longSplit: number;
  /** Sittings that had no slot and found one this time. */
  longRespread: number;
  /**
   * Repetitions of a break-anchored routine dropped because the person doing
   * it had no break that day. Checking WhatsApp four times around a break you
   * do not take is three times too many.
   */
  collapsedRepeats: number;
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
  /**
   * Work somebody has already put on the calendar for themselves.
   *
   * Anything for one of these templates on one of these days that the rules
   * did not generate: a plan-board claim, an ad-hoc task, work pulled out of
   * the catalogue to fill a gap. It counts towards what the rule wants, so the
   * rule tops up instead of adding on top -- see dropAlreadyCovered.
   *
   * Cancelled work is left out: giving it back is exactly what should happen
   * once somebody decides it is not needed.
   *
   * Worked out before the stale sweep on purpose. Feeding the sweep the
   * topped-up plan rather than the raw one makes the rule behave the same
   * whichever way round it happened -- claim first and the instance is never
   * created, claim second and the instance nobody has picked up is swept.
   */
  const claimed = await prisma.task.findMany({
    where: {
      templateId: { in: [...new Set(planned.map((p) => p.templateId))] },
      dueDate: { gte: from, lte: to },
      status: { notIn: ["CANCELLED"] },
      origin: { not: "RECURRING" },
      parentTaskId: null,
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
    },
    select: { templateId: true, dueDate: true },
  });

  const coverage = new Map<string, number>();
  for (const c of claimed) {
    if (!c.templateId) continue;
    const key = coverageKey(c.templateId, c.dueDate);
    coverage.set(key, (coverage.get(key) ?? 0) + 1);
  }

  const { toPlan, covered } = dropAlreadyCovered(planned, coverage);

  const liveKeys = new Set(toPlan.map((p) => p.externalKey));
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
    where: { externalKey: { in: toPlan.map((p) => p.externalKey) } },
    select: { externalKey: true },
  });

  const { toCreate, alreadyPresent } = diffAgainstExisting(
    toPlan,
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
        shiftHalf: t.shiftHalf,
      })),
    });
  }

  /**
   * Whatever goes hand in hand with the work just materialised.
   *
   * Done here, before assignment, so the followers are in the pool the engine
   * sees: their minutes count against the day and they get a slot alongside
   * their leader rather than turning up afterwards on a day already full.
   * createFollowers() is keyed on the leader, so re-running finds them.
   */
  const leadersNeedingFollowers = await prisma.task.findMany({
    where: {
      dueDate: { gte: from, lte: to },
      // SPLIT excluded and sittings excluded: a split job's followers hang off
      // the job, not off each of its sittings, or reviewing the portals over
      // four afternoons would raise four copies of the report.
      status: { notIn: ["CANCELLED", "SPLIT"] },
      parentTaskId: null,
      followsTaskId: null,
      template: { followers: { some: { active: true } } },
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
    },
  });
  let followersCreated = 0;
  for (const leader of leadersNeedingFollowers) {
    followersCreated += (await createFollowers(leader)).length;
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
      // A split job is one turn at the work, not four. The parent carries the
      // template and the assignee and is the row worth counting; counting its
      // sittings too would tell the engine this person has had five times as
      // many goes as they have, and it would quietly stop offering them work.
      parentTaskId: null,
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
      // Same reason as priorAssignments above: one long job is one pick-up.
      parentTaskId: null,
    },
    _count: { _all: true },
  });

  const oneOffLoad = recentOneOffs
    .filter((r) => r.assigneeId)
    .map((r) => ({ userId: r.assigneeId as string, count: r._count._all }));

  // ------------------------------------------- 2b. long work, split first
  //
  // A ten-hour job cannot be placed by assignDay: findSlot wants one
  // contiguous window and there is no such thing. Left alone it would come
  // back "needs-splitting" every night for ever.
  //
  // So before the pool is read, long unowned work is given an owner and cut
  // into sittings. The owner is chosen by asking assignDay who has room for
  // the *first* sitting -- a single-task day -- which reuses the capacity,
  // rotation and department rules exactly as they are rather than growing a
  // second, subtly different copy of them here.
  //
  // The whole job goes to one person. A job is a job; splitting it across
  // people as well as days would be a different feature and a worse one.
  const longSplit = await splitLongWork({
    from,
    to,
    days,
    departmentId: options?.departmentId,
    people,
    availability,
    rotation,
    oneOffLoad,
  });

  // Read *after* the split pass, so the sittings it just created are in the
  // pool: the day loop needs their minutes and slots to schedule around them.
  const allTasks = await prisma.task.findMany({
    where: {
      dueDate: { gte: from, lte: to },
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
      // A parent is not work. Letting it into the pool would have assignDay
      // book its whole estimate -- ten hours -- against somebody's day, on top
      // of the sittings that are the real work.
      status: { notIn: ["CANCELLED", "SPLIT"] },
    },
    include: { actionItem: { select: { pinnedAssigneeId: true } } },
  });

  // ----------------------------------------------------------- 3. assign

  const summary: RunSummary = {
    from,
    to,
    created: toCreate.length,
    alreadyPresent,
    removedStale: staleIds.length + onboarding.removed + crm.removed,
    alreadyCovered: covered,
    onboardingCreated: onboarding.created,
    crmCallsCreated: crm.created,
    followersCreated,
    attendanceClosed: attendance.daysClosed,
    timersClosed: attendance.entriesClosed,
    longSplit,
    longRespread: 0,
    collapsedRepeats: 0,
    assigned: 0,
    unassigned: 0,
    skippedInFlight: 0,
  };

  /**
   * Repetitions folded away because their person's day had no break, and the
   * ones that moved to a different point in it. Applied after the day loop
   * alongside the placements, so one routine is decided in one place.
   */
  const folds: { taskId: string; into: DayAnchor | null }[] = [];

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
    /** Why it could not be placed. Cleared when it is. */
    unplacedReason?: string | null;
  }[] = [];

  for (const date of days) {
    const key = dateKey(date);
    const dayTasks = allTasks.filter((t) => dateKey(t.dueDate) === key);

    /**
     * A sitting of a long job is in flight as far as this run is concerned.
     *
     * Its position was worked out across several days by respreadSessions,
     * which is a decision assignDay cannot make -- it places one day at a
     * time. So its minutes go into committedMinutes and its slot into busy,
     * exactly like a paused task, and the engine schedules *around* it. That
     * is what makes re-running the window leave a split job where it was.
     *
     * Note it is not simply added to IMMOVABLE: that list is a status check,
     * and a sitting's status is the perfectly ordinary ASSIGNED.
     */
    const held = (t: (typeof dayTasks)[number]) =>
      (IMMOVABLE as readonly string[]).includes(t.status) || t.parentTaskId !== null;

    const inFlight = dayTasks.filter(held);
    summary.skippedInFlight += inFlight.length;

    const schedulable = dayTasks.filter((t) => !held(t));
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

    const schedulableById = new Map(schedulable.map((t) => [t.id, t]));
    const heldById = new Map(inFlight.map((t) => [t.id, t]));

    /**
     * A pair that goes hand in hand is one unit of work, so it reuses the
     * grouping the anchored routines already have: the whole chain is keyed on
     * the task at the top of it, which sends it to one person.
     *
     * "The top" means the highest ancestor this run is placing, not the
     * absolute root. Once somebody starts the leader it becomes immovable and
     * drops out of `schedulable`, and this walk used to lose it -- leaving the
     * follower in a group of one, pointing at a task the engine could not see,
     * to be first-fit to whoever was free. The second half of a pair went to a
     * different person, in the morning, while the first half was being done in
     * the afternoon.
     */
    const chainRoot = new Map<string, string>();

    /**
     * Chain heads whose leader is in flight: who owns it, and when it ends.
     * Enough for the engine to keep the pair together and in order without
     * being able to move the half somebody is holding.
     */
    const detached = new Map<
      string,
      { assigneeId: string | null; end: number | null }
    >();

    for (const t of schedulable) {
      if (!t.followsTaskId) continue;

      let root = t.id;
      const seen = new Set<string>([t.id]);

      // Bounded by MAX_CHAIN's worth of hops, and by `seen`, so a cycle in the
      // stored links stops rather than spinning.
      for (let hop = 0; hop < 5; hop++) {
        const parentId = schedulableById.get(root)?.followsTaskId;
        if (!parentId || seen.has(parentId)) break;

        if (!schedulableById.has(parentId)) {
          const leader = heldById.get(parentId);
          if (leader) {
            detached.set(root, {
              assigneeId: leader.assigneeId,
              end: leader.scheduledEnd,
            });
          }
          break;
        }

        seen.add(parentId);
        root = parentId;
      }

      chainRoot.set(t.id, root);
      chainRoot.set(root, root);
    }

    const taskInputs: TaskInput[] = schedulable.map((t) => {
      const fixed = t.externalKey ? fixedByKey.get(t.externalKey) : undefined;
      const root = chainRoot.get(t.id);
      const detach = detached.get(t.id);
      return {
        id: t.id,
        departmentId: t.departmentId,
        estimatedMinutes: t.estimatedMinutes,
        templateId: t.templateId,
        priority: t.priority,
        // A meeting naming somebody wins over an inherited owner: it is a
        // decision a person made, not one the calendar implies.
        pinnedAssigneeId:
          t.actionItem?.pinnedAssigneeId ?? detach?.assigneeId ?? null,
        notBeforeMinutes: detach?.end ?? null,
        fixedStartMinutes: fixed?.start ?? null,
        fixedEndMinutes: fixed?.end ?? null,
        // The task's own anchor is authoritative -- it survives a rule being
        // edited between the run that created it and this one.
        anchor: t.anchor,
        shiftHalf: t.shiftHalf,
        groupKey: root
          ? `follows:${root}`
          : t.anchor
            ? (fixed?.groupKey ?? null)
            : null,
        followsTaskId: t.followsTaskId,
      };
    });

    /**
     * Anchored repetitions already done or under way today.
     *
     * They are in-flight, so they are not in taskInputs -- but they are still
     * sitting on their point in the day, and folding a routine onto a short
     * day has to know that. Without it the afternoon check moves onto arrival
     * where the finished one already is, and the day shows "al llegar" twice.
     */
    const occupiedAnchors = inFlight
      .filter((t) => t.anchor !== null && t.externalKey)
      .map((t) => ({
        groupKey: fixedByKey.get(t.externalKey!)?.groupKey ?? null,
        anchor: t.anchor!,
      }))
      .filter((h): h is { groupKey: string; anchor: DayAnchor } =>
        h.groupKey !== null,
      );

    const result = assignDay({
      date,
      tasks: taskInputs,
      candidates,
      rotation: runningRotation,
      oneOffLoad: runningOneOff,
      occupiedAnchors,
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
        // Kept, rather than worked out and thrown away. It is the difference
        // between triage saying "4 tasks nobody had room for" and saying which
        // four, and which of them wants splitting rather than a spare hour.
        unplacedReason: u.reason,
      });
    }

    folds.push(...result.collapsed);

    summary.assigned += result.assignments.length;
    summary.unassigned += result.unassigned.length;
  }

  summary.collapsedRepeats = folds.filter((f) => f.into === null).length;

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
          unplacedReason: w.unplacedReason ?? null,
        },
      }),
    ),
  );

  /**
   * ------------------------------------- 4b. routines folded onto a short day
   *
   * Cancelled rather than deleted, so the externalKey stays put. The key is
   * this rule's identity for this date; leaving it in place is what stops the
   * next run materialising the repetition again and folding it away again,
   * for ever. Nothing reads a cancelled task, and the stale sweep only touches
   * UNASSIGNED, so it stays cancelled.
   *
   * The ones that merely moved keep their key too -- where it ended up is the
   * anchor column's business, not the key's -- but their title is rewritten,
   * because "CRM · antes del descanso" sitting at the end of a day with no
   * break is the app telling the person something untrue.
   */
  if (folds.length > 0) {
    const folded = new Map(allTasks.map((t) => [t.id, t]));

    await prisma.$transaction(
      folds.map((f) => {
        const task = folded.get(f.taskId);

        if (f.into === null) {
          return prisma.task.update({
            where: { id: f.taskId },
            data: {
              status: "CANCELLED",
              assigneeId: null,
              scheduledDate: null,
              scheduledStart: null,
              scheduledEnd: null,
              unplacedReason: null,
            },
          });
        }

        const oldLabel = task?.anchor ? ANCHOR_LABEL[task.anchor] : null;
        const title =
          task && oldLabel
            ? task.title.replace(`· ${oldLabel}`, `· ${ANCHOR_LABEL[f.into]}`)
            : task?.title;

        return prisma.task.update({
          where: { id: f.taskId },
          data: { anchor: f.into, ...(title ? { title } : {}) },
        });
      }),
    );
  }

  /**
   * ------------------------------------------------- 5. reconcile long work
   *
   * A sitting that found no slot when its job was split is not lost, it is
   * waiting: somebody's absence was cancelled, or the day it wanted has since
   * been cleared. Re-spreading here is the recovery path, and it is a no-op
   * for a job whose sittings all landed.
   *
   * Deliberately not triggered by an orphaned sitting. Orphaned work belongs
   * to a manager, and quietly re-laying a sick person's week would break the
   * rule that an absence never reassigns anything on its own.
   */
  for (const parentId of await parentsNeedingSpread(options?.departmentId)) {
    const spread = await respreadSessions(parentId, from);
    summary.longRespread += spread.placed;
  }

  await refreshRotationLedger();

  return summary;
}

/**
 * Give long unowned work an owner, then cut it into sittings.
 *
 * Returns how many jobs were split. See the call site for why this runs
 * before the pool is read.
 */
async function splitLongWork(input: {
  from: Date;
  to: Date;
  days: Date[];
  departmentId?: string;
  people: { id: string; departmentId: string }[];
  availability: Awaited<ReturnType<typeof getAvailabilityForRange>>;
  rotation: {
    templateId: string;
    userId: string;
    assignedCount: number;
    lastAssignedAt: Date | null;
  }[];
  oneOffLoad: { userId: string; count: number }[];
}): Promise<number> {
  const candidatesLong = await prisma.task.findMany({
    where: {
      dueDate: { gte: input.from, lte: input.to },
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      status: { in: ["UNASSIGNED", "ASSIGNED"] },
      parentTaskId: null,
      sessions: { none: {} },
      estimatedMinutes: { gt: DEFAULT_SESSION_MINUTES },
    },
    include: {
      template: {
        select: {
          isMeeting: true,
          sessionMinutes: true,
          recurringRules: { select: { fixedStartMinutes: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });

  let split = 0;

  for (const task of candidatesLong) {
    const size =
      task.template?.sessionMinutes && task.template.sessionMinutes > 0
        ? task.template.sessionMinutes
        : DEFAULT_SESSION_MINUTES;
    if (task.estimatedMinutes <= size) continue;

    let ownerId = task.assigneeId;

    if (!ownerId) {
      /**
       * Who has room to *start* this? Asked as a one-task day, so the ranking
       * that picks the fairest person is the same one everything else uses.
       * The first sitting is the honest size to ask about: nobody has ten
       * contiguous hours, and asking about them would answer nobody.
       */
      const firstSitting = planSessions(task.estimatedMinutes, size)[0] ?? size;

      for (const date of input.days) {
        if (dateKey(date) > dateKey(task.dueDate)) break;
        const key = dateKey(date);

        const candidates: CandidateInput[] = input.people
          .map((p): CandidateInput | null => {
            const avail = input.availability.get(p.id)?.get(key);
            if (!avail) return null;
            return {
              userId: p.id,
              departmentId: p.departmentId,
              availability: avail,
              committedMinutes: 0,
              busy: [],
            };
          })
          .filter((c): c is CandidateInput => c !== null);

        const probe = assignDay({
          date,
          tasks: [
            {
              id: task.id,
              departmentId: task.departmentId,
              estimatedMinutes: firstSitting,
              priority: task.priority,
              templateId: task.templateId,
            },
          ],
          candidates,
          rotation: input.rotation,
          oneOffLoad: input.oneOffLoad,
        });

        ownerId = probe.assignments[0]?.userId ?? null;
        if (ownerId) break;
      }
    }

    if (!ownerId) continue;

    // ensureSessions re-reads and re-checks everything, including the
    // exclusions; this only has to get the owner on.
    if (task.assigneeId !== ownerId) {
      await prisma.task.update({
        where: { id: task.id },
        data: { assigneeId: ownerId, status: "ASSIGNED" },
      });
    }

    const result = await ensureSessions(task.id);
    if (result.split) split += 1;
  }

  return split;
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
      // parentTaskId: null throughout -- a split job is one turn at the work,
      // counted on the parent. See priorAssignments for what counting the
      // sittings as well would do to the rotation.
      where: {
        templateId: { not: null },
        assigneeId: { not: null },
        parentTaskId: null,
      },
      _count: { _all: true },
      _max: { dueDate: true },
    }),
    prisma.task.groupBy({
      by: ["templateId", "assigneeId"],
      where: {
        templateId: { not: null },
        assigneeId: { not: null },
        parentTaskId: null,
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
