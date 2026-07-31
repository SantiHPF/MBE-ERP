import type { Prisma, TaskOrigin } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays, toDateOnly } from "@/lib/time";
import type { Gap } from "./gap";
import {
  pickOffers,
  rankFillers,
  type Filler,
  type FillerSource,
} from "./score";
import { isOfferable } from "./eligible";

/**
 * What could fill the gap.
 *
 * Four pools, gathered in one round and then ranked by score.ts. Each query is
 * bounded by the gap itself -- nothing longer than the time available is ever
 * read -- so this stays cheap enough to run when the dialog opens rather than
 * on every page load. getNowState() is deliberately not the place for it.
 *
 * The I/O half of the split; the rules are in gap.ts and score.ts.
 */

/** How far ahead we are willing to borrow work from. */
const PULL_FORWARD_DAYS = 7;

/** Beyond this an orphan is still triage's problem, not this afternoon's. */
const ORPHAN_HORIZON_DAYS = 7;

/** Per pool. The ranking only ever shows the top few. */
const PER_POOL = 25;

export type Offer = Filler & {
  /** Dictionary key explaining why this was picked, for the dialog. */
  reason: string;
  notes: string | null;
  instructions: string | null;
  isMeeting: boolean;
};

const REASON: Record<FillerSource, string> = {
  unassigned: "gaps.reasonUnassigned",
  orphaned: "gaps.reasonOrphaned",
  pullForward: "gaps.reasonPullForward",
  spare: "gaps.reasonSpare",
};

/**
 * A repeatable task is planned as a block of goes, and what is left of it is
 * what has to fit -- offering "4 x 15 min" for a 20-minute gap would be a lie.
 * Splitting the block to fit is worth doing, but it is a change to how quantity
 * works and does not belong in this one.
 */
function remainingMinutes(task: {
  estimatedMinutes: number;
  quantity: number;
  doneCount: number;
  unitMinutes: number | null;
}): number {
  if (task.unitMinutes == null || task.quantity <= 1) return task.estimatedMinutes;
  return Math.max(0, task.quantity - task.doneCount) * task.unitMinutes;
}

const TASK_FIELDS = {
  id: true,
  title: true,
  estimatedMinutes: true,
  quantity: true,
  doneCount: true,
  unitMinutes: true,
  priority: true,
  dueDate: true,
  templateId: true,
  origin: true,
  anchor: true,
  shiftHalf: true,
  followsTask: { select: { status: true } },
  template: {
    select: {
      notes: true,
      instructions: true,
      isMeeting: true,
      // A clock time lives on the rule, not the task -- the same hop
      // plan/place.ts makes to honour it.
      recurringRules: {
        where: { active: true, fixedStartMinutes: { not: null } },
        select: { fixedStartMinutes: true },
        take: 1,
      },
    },
  },
} satisfies Prisma.TaskSelect;

/**
 * Work owed to a clock, excluded in SQL so it never reaches the ranking.
 *
 * A task with no template passes both NOT clauses, which is right: an ad-hoc
 * job has no rule to pin it and no meeting to attend.
 */
const NOT_HOUR_BOUND = {
  anchor: null,
  NOT: [
    { template: { isMeeting: true } },
    {
      template: {
        recurringRules: {
          some: { active: true, fixedStartMinutes: { not: null } },
        },
      },
    },
  ],
} satisfies Prisma.TaskWhereInput;

/** Origins whose date is the meaning. Kept in step with eligible.ts. */
const CADENCE_ORIGINS: TaskOrigin[] = ["RECURRING", "CRM"];

/** Cadence work only on its own day; everything else on its deadline. */
function onlyOnItsDay(today: Date): Prisma.TaskWhereInput {
  return {
    OR: [{ origin: { notIn: CADENCE_ORIGINS } }, { dueDate: today }],
  };
}

export async function fillerOffers(
  userId: string,
  departmentId: string,
  gap: Gap,
  date: Date = new Date(),
  excludeIds: string[] = [],
  // Six rather than three: with a slot guaranteed per tier, the list has to be
  // long enough to hold the representatives and still show alternatives.
  limit = 6,
): Promise<Offer[]> {
  const today = toDateOnly(date);
  /**
   * A cheap bound on every query rather than the real fit test, which needs a
   * contiguous stretch and so cannot be expressed in SQL -- rankFillers() does
   * that afterwards. Conservative in one direction: a part-done repeatable is
   * measured on its full estimate here and may not be offered until the whole
   * block would fit.
   */
  const fits = { lte: gap.minutes };
  const notExcluded = excludeIds.length > 0 ? { notIn: excludeIds } : undefined;

  const [owed, mineUnplaced, orphaned, laterThisWeek, spareTemplates] =
    await Promise.all([
      // --- tier 1a: due today or already late, and nobody has it
      prisma.task.findMany({
        where: {
          departmentId,
          assigneeId: null,
          status: "UNASSIGNED",
          dueDate: { lte: today },
          estimatedMinutes: fits,
          ...NOT_HOUR_BOUND,
          ...onlyOnItsDay(today),
          ...(notExcluded ? { id: notExcluded } : {}),
        },
        select: TASK_FIELDS,
        orderBy: { dueDate: "asc" },
        take: PER_POOL,
      }),

      /**
       * --- tier 1b: mine, today, and never given a slot.
       *
       * forceOnSomebody() in the engine assigns must-do work to a full day
       * with start and end left null, and blockingTask() sorts unplaced work
       * last so it never interrupts anybody. The result is real work that is
       * genuinely owed and effectively invisible. This is where it resurfaces.
       */
      prisma.task.findMany({
        where: {
          assigneeId: userId,
          scheduledDate: today,
          scheduledStart: null,
          status: "ASSIGNED",
          estimatedMinutes: fits,
          ...NOT_HOUR_BOUND,
          ...onlyOnItsDay(today),
          ...(notExcluded ? { id: notExcluded } : {}),
        },
        select: TASK_FIELDS,
        take: PER_POOL,
      }),

      /**
       * --- tier 2: dropped by an absence, waiting on triage.
       *
       * Exempt from the cadence rule, and only from that one. Nobody is going
       * to do this occurrence unless somebody picks it up, which is a different
       * thing from dragging a rhythm forward for the sake of a spare half hour.
       * Horizon-capped so an orphan dated three weeks out is still triage's
       * problem rather than this afternoon's.
       */
      prisma.task.findMany({
        where: {
          departmentId,
          status: "ORPHANED",
          dueDate: { lte: addDays(today, ORPHAN_HORIZON_DAYS) },
          estimatedMinutes: fits,
          ...NOT_HOUR_BOUND,
          ...(notExcluded ? { id: notExcluded } : {}),
        },
        select: TASK_FIELDS,
        orderBy: { dueDate: "asc" },
        take: PER_POOL,
      }),

      // --- tier 3: mine, but not until later this week
      prisma.task.findMany({
        where: {
          assigneeId: userId,
          status: "ASSIGNED",
          scheduledDate: {
            gt: today,
            lte: addDays(today, PULL_FORWARD_DAYS),
          },
          estimatedMinutes: fits,
          ...NOT_HOUR_BOUND,
          // A cadence is never dragged forward: the two-monthly interview is
          // due in two months, and that is the whole of what it means.
          ...onlyOnItsDay(today),
          /**
           * Nor is one sitting of a longer job. Dragging Thursday's third
           * sitting into today's gap while the second is still on Wednesday
           * makes the job read backwards, and blockingTask() would then refuse
           * to let anyone start any of it.
           *
           * Sittings are still offerable in tier 1b (mine, today, and never
           * given a slot) and tier 2 (orphaned), which is right -- a
           * 150-minute sitting is real work somebody can pick up.
           */
          parentTaskId: null,
          ...(notExcluded ? { id: notExcluded } : {}),
        },
        select: { ...TASK_FIELDS, scheduledDate: true },
        orderBy: { scheduledDate: "asc" },
        take: PER_POOL,
      }),

      // --- tier 4: catalogue work that exists for exactly this moment
      prisma.taskTemplate.findMany({
        where: {
          departmentId,
          active: true,
          priority: "SPARE_TIME",
          estimatedMinutes: fits,
          isMeeting: false,
          // No clock time of its own, for the same reason as everything else.
          recurringRules: {
            none: { active: true, fixedStartMinutes: { not: null } },
          },
          // One claim per template per day, so anything already live today is
          // somebody's -- the same rule the partial unique index enforces.
          tasks: { none: { dueDate: today, status: { not: "CANCELLED" } } },
          ...(notExcluded ? { id: notExcluded } : {}),
        },
        select: {
          id: true,
          name: true,
          estimatedMinutes: true,
          priority: true,
          notes: true,
          instructions: true,
          isMeeting: true,
        },
        take: PER_POOL,
      }),
    ]);

  type TaskRow = (typeof owed)[number];

  const fromTask = (task: TaskRow, source: FillerSource): Offer => ({
    taskId: task.id,
    templateId: task.templateId,
    title: task.title,
    estimatedMinutes: remainingMinutes(task),
    priority: task.priority,
    dueDate: task.dueDate,
    source,
    reason: REASON[source],
    notes: task.template?.notes ?? null,
    instructions: task.template?.instructions ?? null,
    isMeeting: task.template?.isMeeting ?? false,
  });

  /**
   * The rules again, in code this time. SQL narrowed the pools; this is the
   * authority, and running it here means the queries and takeFiller() are
   * agreeing with the same function rather than with each other by hand.
   */
  const offerable = (task: TaskRow, source: FillerSource) =>
    isOfferable(
      {
        anchor: task.anchor,
        isMeeting: task.template?.isMeeting ?? false,
        hasFixedTime: (task.template?.recurringRules.length ?? 0) > 0,
        origin: task.origin,
        dueDate: task.dueDate,
        waitingOnLeader:
          task.followsTask != null && task.followsTask.status !== "DONE",
        shiftHalf: task.shiftHalf,
      },
      source,
      today,
      gap,
    );

  const keep = (rows: TaskRow[], source: FillerSource) =>
    rows.filter((t) => offerable(t, source)).map((t) => fromTask(t, source));

  const offers: Offer[] = [
    ...keep(owed, "unassigned"),
    ...keep(mineUnplaced, "unassigned"),
    ...keep(orphaned, "orphaned"),
    ...keep(laterThisWeek, "pullForward"),
    ...spareTemplates.map((tpl) => ({
      taskId: null,
      templateId: tpl.id,
      title: tpl.name,
      estimatedMinutes: tpl.estimatedMinutes,
      priority: tpl.priority,
      // Filler has no deadline of its own; it is wanted today or not at all.
      dueDate: today,
      source: "spare" as const,
      reason: REASON.spare,
      notes: tpl.notes,
      instructions: tpl.instructions,
      isMeeting: tpl.isMeeting,
    })),
  ];

  const byKey = new Map(offers.map((o) => [o.taskId ?? o.templateId!, o]));
  const ranked = rankFillers([...byKey.values()], gap, today);

  return pickOffers(ranked, limit).map(
    (f) => byKey.get(f.taskId ?? f.templateId!)!,
  );
}
