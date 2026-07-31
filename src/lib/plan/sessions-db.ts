import { prisma } from "@/lib/db";
import type { Task } from "@prisma/client";
import { addDays, dateKey, eachDay, toDateOnly, today } from "@/lib/time";
import { computeAvailability, subtractWindows } from "@/lib/scheduling/availability";
import { elapsedSeconds } from "@/lib/tasks/elapsed";
import {
  DEFAULT_SESSION_MINUTES,
  MAX_SPREAD_DAYS,
  planRepeatableSessions,
  planSessions,
  rollUp,
  spreadSessions,
  type DayCapacity,
  type SessionProgress,
} from "./sessions";

/**
 * Turning a long job into sittings, and keeping them laid out.
 *
 * The I/O half of sessions.ts, same split as follow.ts / follow-db.ts.
 *
 * The invariant everything else leans on: a parent (status SPLIT) never has
 * scheduledDate, scheduledStart or scheduledEnd. Every day-scoped query in the
 * app filters on scheduledDate, so keeping the parent unscheduled is what
 * keeps it out of My Day, the now-bar, pace, /team and triage without any of
 * them being taught what a parent is.
 */

/** Sittings with tracked time, or settled, are not ours to move. */
const FROZEN = ["IN_PROGRESS", "PAUSED", "DONE", "CANCELLED"];

/** A stable key, so a re-run finds the sittings rather than making more. */
function sessionKey(parentId: string, index: number): string {
  return `session:${parentId}:${index}`;
}

/**
 * Should this task be split at all?
 *
 * Each exclusion is a real trap rather than a matter of taste:
 *
 * - CRM calls resolve their batch off the task id and are deleted and
 *   recreated nightly by syncCrmCalls, so four sittings would each show the
 *   whole call list and all four would vanish at midnight.
 * - A four-hour meeting is one meeting.
 * - Work owed to a clock -- an anchor, or a rule with a fixed start -- has no
 *   business being spread. A job long enough to need splitting has no business
 *   claiming a point in the day either, which is why sittings inherit neither
 *   the anchor nor the shift half.
 */
function splittable(task: {
  status: string;
  origin: string;
  anchor: unknown;
  parentTaskId: string | null;
  assigneeId: string | null;
  template: { isMeeting: boolean; recurringRules: { fixedStartMinutes: number | null }[] } | null;
}): boolean {
  if (task.parentTaskId) return false;
  if (task.assigneeId == null) return false;
  if (["DONE", "CANCELLED", "SPLIT"].includes(task.status)) return false;
  if (task.origin === "CRM") return false;
  if (task.anchor != null) return false;
  if (task.template?.isMeeting) return false;
  if (task.template?.recurringRules.some((r) => r.fixedStartMinutes != null)) {
    return false;
  }
  return true;
}

/** The chunk size for a job: the catalogue's if it has one, else the default. */
function sizeFor(sessionMinutes: number | null | undefined): number {
  return sessionMinutes && sessionMinutes > 0
    ? sessionMinutes
    : DEFAULT_SESSION_MINUTES;
}

/**
 * Turn a long task into a parent and its sittings.
 *
 * Idempotent: a task that is already a parent, already a sitting, or short
 * enough to do in one go is left exactly as it is. Safe to call from anywhere
 * a task acquires an owner.
 */
export async function ensureSessions(taskId: string): Promise<{
  split: boolean;
  parentId: string;
  created: number;
  placed: number;
  unplaced: number;
}> {
  const nothing = { split: false, parentId: taskId, created: 0, placed: 0, unplaced: 0 };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      template: {
        select: {
          isMeeting: true,
          sessionMinutes: true,
          recurringRules: { select: { fixedStartMinutes: true } },
        },
      },
      sessions: { select: { id: true } },
    },
  });
  if (!task) return nothing;
  if (task.sessions.length > 0) return { ...nothing, parentId: task.id };
  if (!splittable(task)) return nothing;

  const size = sizeFor(task.template?.sessionMinutes);

  /**
   * Repeatable work splits by goes rather than by minutes: half a phone call
   * is not a unit of work anybody can do, and the counter on the task counts
   * goes. Forty calls at a quarter of an hour is ten hours, and is exactly how
   * this comes up.
   */
  const repeatable = task.unitMinutes != null && task.unitMinutes > 0;
  const parts = repeatable
    ? planRepeatableSessions(task.quantity, task.unitMinutes!, size)
    : planSessions(task.estimatedMinutes, size).map((minutes) => ({
        goes: 1,
        minutes,
      }));

  if (parts.length === 0) return nothing;

  await prisma.$transaction([
    // The parent stops being work. Its slot goes, and must never come back.
    prisma.task.update({
      where: { id: task.id },
      data: {
        status: "SPLIT",
        scheduledDate: null,
        scheduledStart: null,
        scheduledEnd: null,
      },
    }),
    prisma.task.createMany({
      data: parts.map((part, i) => ({
        externalKey: sessionKey(task.id, i + 1),
        parentTaskId: task.id,
        sessionIndex: i + 1,
        title: task.title,
        description: task.description,
        estimatedMinutes: part.minutes,
        unitMinutes: repeatable ? task.unitMinutes : null,
        quantity: repeatable ? part.goes : 1,
        // Each sitting's own due date is the day it lands on; respread sets
        // it. Until then the parent's deadline is the honest answer.
        dueDate: task.dueDate,
        origin: task.origin,
        departmentId: task.departmentId,
        templateId: task.templateId,
        priority: task.priority,
        assigneeId: task.assigneeId,
        status: "ASSIGNED",
        // Deliberately not inherited -- see splittable().
        anchor: null,
        shiftHalf: null,
      })),
    }),
  ]);

  const spread = await respreadSessions(task.id, today());
  return {
    split: true,
    parentId: task.id,
    created: parts.length,
    placed: spread.placed,
    unplaced: spread.unplaced,
  };
}

/**
 * Re-lay whatever is left of a split job, from `from` forwards.
 *
 * Called after a sitting is deferred, after a manager decides a sick person's
 * week, and by the nightly run for jobs that could not fit when they were
 * created and now can.
 *
 * The past is left alone, and so is anything with tracked time on it or
 * anything sitting in triage: orphaned work belongs to a manager, and quietly
 * re-laying it would break the rule that an absence never reassigns anything
 * on its own.
 */
export async function respreadSessions(
  parentId: string,
  from: Date,
): Promise<{ placed: number; unplaced: number }> {
  const parent = await prisma.task.findUnique({
    where: { id: parentId },
    include: { sessions: { orderBy: { sessionIndex: "asc" } } },
  });
  if (!parent || !parent.assigneeId) return { placed: 0, unplaced: 0 };

  const userId = parent.assigneeId;
  const start = toDateOnly(from) > today() ? toDateOnly(from) : today();

  const frozen = parent.sessions.filter(
    (s) =>
      FROZEN.includes(s.status) ||
      s.status === "ORPHANED" ||
      (s.scheduledDate != null && s.scheduledDate < start),
  );
  const movable = parent.sessions.filter((s) => !frozen.includes(s));
  if (movable.length === 0) return { placed: 0, unplaced: 0 };

  // Never past the deadline: work that will not fit stays unplaced and shows
  // up in the gap-filler, rather than quietly landing after it was due.
  const horizon = addDays(start, MAX_SPREAD_DAYS - 1);
  const end = parent.dueDate < horizon ? parent.dueDate : horizon;
  const dates = end < start ? [start] : eachDay(start, end);

  // Two queries for the whole span, not two per day.
  const [patterns, overrides, absences, booked] = await Promise.all([
    prisma.workingPattern.findMany({ where: { userId } }),
    prisma.dayOverride.findMany({
      where: { userId, date: { gte: start, lte: dates[dates.length - 1] } },
    }),
    prisma.absence.findMany({
      where: {
        userId,
        startDate: { lte: dates[dates.length - 1] },
        endDate: { gte: start },
      },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: userId,
        scheduledDate: { gte: start, lte: dates[dates.length - 1] },
        status: { notIn: ["CANCELLED"] },
        id: { notIn: movable.map((s) => s.id) },
      },
      select: { scheduledDate: true, scheduledStart: true, scheduledEnd: true },
    }),
  ]);

  const bookedByDay = new Map<string, { start: number; end: number }[]>();
  for (const row of booked) {
    if (row.scheduledStart == null || row.scheduledEnd == null) continue;
    if (!row.scheduledDate) continue;
    const key = dateKey(row.scheduledDate);
    const list = bookedByDay.get(key) ?? [];
    list.push({ start: row.scheduledStart, end: row.scheduledEnd });
    bookedByDay.set(key, list);
  }

  const days: DayCapacity[] = dates.map((date) => {
    const availability = computeAvailability({ date, patterns, overrides, absences });
    return {
      date,
      free: subtractWindows(availability.windows, bookedByDay.get(dateKey(date)) ?? []),
    };
  });

  /**
   * A frozen sitting already on the first day is work the movable ones have to
   * come after -- it is earlier in the job, and the day runs in order.
   */
  const notBefore = frozen
    .filter((s) => s.scheduledDate && dateKey(s.scheduledDate) === dateKey(start))
    .reduce((max, s) => Math.max(max, s.scheduledEnd ?? 0), 0);

  const placements = spreadSessions({
    sessions: movable.map((s) => s.estimatedMinutes),
    days,
    notBefore,
  });

  await prisma.$transaction(
    placements.map((p) => {
      const sitting = movable[p.index];
      return prisma.task.update({
        where: { id: sitting.id },
        data: {
          scheduledDate: p.date,
          scheduledStart: p.start,
          scheduledEnd: p.end,
          // The engine groups by dueDate; a sitting that kept the parent's
          // deadline would pile onto one day with all its siblings.
          dueDate: p.date ?? parent.dueDate,
          status: "ASSIGNED",
        },
      });
    }),
  );

  const placed = placements.filter((p) => p.date != null).length;
  return { placed, unplaced: placements.length - placed };
}

/** Where each of these split jobs has got to. */
export async function sessionProgress(
  parentIds: string[],
): Promise<Map<string, SessionProgress>> {
  const out = new Map<string, SessionProgress>();
  if (parentIds.length === 0) return out;

  const sittings = await prisma.task.findMany({
    where: { parentTaskId: { in: parentIds } },
    select: {
      id: true,
      parentTaskId: true,
      status: true,
      estimatedMinutes: true,
      scheduledDate: true,
      sessionIndex: true,
      timeEntries: {
        select: {
          startedAt: true,
          endedAt: true,
          pauses: { select: { pausedAt: true, resumedAt: true } },
        },
      },
    },
  });

  const byParent = new Map<string, typeof sittings>();
  for (const s of sittings) {
    const list = byParent.get(s.parentTaskId!) ?? [];
    list.push(s);
    byParent.set(s.parentTaskId!, list);
  }

  for (const parentId of parentIds) {
    const list = byParent.get(parentId) ?? [];
    out.set(
      parentId,
      rollUp(
        list.map((s) => ({
          id: s.id,
          status: s.status,
          estimatedMinutes: s.estimatedMinutes,
          elapsedSeconds: elapsedSeconds(s.timeEntries),
          scheduledDate: s.scheduledDate ? dateKey(s.scheduledDate) : null,
          sessionIndex: s.sessionIndex ?? 0,
        })),
      ),
    );
  }

  return out;
}

/**
 * The last sitting is finished, so the job is. Nothing is written but the
 * parent's status -- progress and elapsed time are derived, so there is no
 * counter to keep in step.
 */
export async function closeParentIfComplete(
  sessionId: string,
): Promise<{ closed: boolean }> {
  const sitting = await prisma.task.findUnique({
    where: { id: sessionId },
    select: { parentTaskId: true },
  });
  if (!sitting?.parentTaskId) return { closed: false };

  const siblings = await prisma.task.findMany({
    where: { parentTaskId: sitting.parentTaskId },
    select: { status: true },
  });

  const settled = siblings.every((s) => ["DONE", "CANCELLED"].includes(s.status));
  const anyDone = siblings.some((s) => s.status === "DONE");
  if (!settled || !anyDone) return { closed: false };

  await prisma.task.update({
    where: { id: sitting.parentTaskId },
    data: { status: "DONE" },
  });
  return { closed: true };
}

/**
 * "I have finished the whole job" -- in three sittings instead of four.
 *
 * The normal case, and worth an explicit action: leaving the fourth sitting on
 * Friday would be work nobody knows was abandoned, and it would hold time in
 * the day that is actually free.
 *
 * No record of "it took less than planned" is needed. The parent ends DONE
 * with its original estimate and the rolled-up time actually tracked, and the
 * estimate-drift figure on /me reads exactly that.
 */
export async function finishSplitJob(
  sessionId: string,
): Promise<{ cancelled: number; parentId: string | null }> {
  const sitting = await prisma.task.findUnique({
    where: { id: sessionId },
    select: { parentTaskId: true },
  });
  if (!sitting?.parentTaskId) return { cancelled: 0, parentId: null };

  const parentId = sitting.parentTaskId;

  const rest = await prisma.task.updateMany({
    where: {
      parentTaskId: parentId,
      id: { not: sessionId },
      // Anything with a running or paused timer is somebody's current work and
      // is settled by them, not swept up from here.
      status: { notIn: ["DONE", "IN_PROGRESS", "PAUSED", "CANCELLED"] },
    },
    data: {
      status: "CANCELLED",
      // Give the days back.
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
    },
  });

  await prisma.task.update({ where: { id: parentId }, data: { status: "DONE" } });
  return { cancelled: rest.count, parentId };
}

/** What a day's list needs to know about a sitting it is showing. */
export type SessionInfo = {
  parentId: string;
  /** 1-based. */
  index: number;
  total: number;
  /** Minutes of the whole job still owed, this sitting included. */
  remainingMinutes: number;
};

/**
 * Label the sittings in a day's worth of tasks.
 *
 * One extra query, and only when the day actually contains one -- most days
 * do not, and My Day and the now-bar are the two heaviest read paths in the
 * app. Shared by both so the two cannot drift apart.
 */
export async function sessionInfoFor(
  tasks: { id: string; parentTaskId: string | null }[],
): Promise<Map<string, SessionInfo>> {
  const out = new Map<string, SessionInfo>();
  const parentIds = [
    ...new Set(tasks.map((t) => t.parentTaskId).filter((id): id is string => !!id)),
  ];
  if (parentIds.length === 0) return out;

  const [progress, sittings] = await Promise.all([
    sessionProgress(parentIds),
    prisma.task.findMany({
      where: { parentTaskId: { in: parentIds } },
      select: { id: true, parentTaskId: true, sessionIndex: true, status: true },
      orderBy: { sessionIndex: "asc" },
    }),
  ]);

  /**
   * The number shown counts live sittings only, so a job whose fourth was
   * cancelled reads "3 of 3" rather than "3 of 4" -- the fourth is not
   * something anybody is still waiting for.
   */
  const liveByParent = new Map<string, string[]>();
  for (const s of sittings) {
    if (s.status === "CANCELLED") continue;
    const list = liveByParent.get(s.parentTaskId!) ?? [];
    list.push(s.id);
    liveByParent.set(s.parentTaskId!, list);
  }

  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const live = liveByParent.get(task.parentTaskId) ?? [];
    const index = live.indexOf(task.id);
    if (index < 0) continue;
    out.set(task.id, {
      parentId: task.parentTaskId,
      index: index + 1,
      total: live.length,
      remainingMinutes: progress.get(task.parentTaskId)?.remainingMinutes ?? 0,
    });
  }

  return out;
}

/** Every split job of this person's with a sitting that never found a slot. */
export async function parentsNeedingSpread(
  departmentId?: string,
): Promise<string[]> {
  const stranded = await prisma.task.findMany({
    where: {
      parentTaskId: { not: null },
      status: "ASSIGNED",
      scheduledDate: null,
      ...(departmentId ? { departmentId } : {}),
    },
    select: { parentTaskId: true },
    distinct: ["parentTaskId"],
  });
  return stranded.map((s) => s.parentTaskId!).filter(Boolean);
}

/** True when this task is one sitting of a longer job. */
export function isSession(task: Pick<Task, "parentTaskId">): boolean {
  return task.parentTaskId !== null;
}
