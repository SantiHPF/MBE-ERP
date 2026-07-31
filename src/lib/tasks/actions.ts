"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText, fail, message } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import type { TaskStatus } from "@prisma/client";
import { dateKey, toDateOnly } from "@/lib/time";
import { placeOnDay } from "@/lib/plan/place";
import { isUniqueViolation } from "@/lib/plan/claim";
import { followersOf } from "@/lib/plan/follow-db";
import {
  closeParentIfComplete,
  finishSplitJob,
  respreadSessions,
} from "@/lib/plan/sessions-db";
import { computeAvailability, findSlot } from "@/lib/scheduling/availability";
import { markActivity, markArrival } from "@/lib/attendance/attendance-db";

/** Work with tracked time attached: it keeps its slot. */
const STARTED = ["IN_PROGRESS", "PAUSED", "DONE"];

/**
 * The timer. One task runs at a time per person -- starting something else
 * pauses whatever was running, rather than quietly double-counting time.
 */

const TaskId = z.object({ taskId: z.string().min(1) });

const PauseInput = z.object({
  taskId: z.string().min(1),
  reasonCode: z.enum([
    "BREAK",
    "WAITING_CLIENT",
    "WAITING_INTERNAL",
    "MEETING",
    "INTERRUPTION",
    "OTHER",
  ]),
  // Required, and not satisfied by whitespace. This is the whole point of the
  // pause flow: a stalled task must say why.
  reasonText: z.string().trim().min(3, "errors.sayWhatIsHoldingItUp"),
});

export type BlockingTask = {
  id: string;
  title: string;
  start: number | null;
  status: string;
};

export type ActionState = {
  error?: string;
  ok?: boolean;
  /** Set when the day's order stops you: the task you owe first. */
  blockedBy?: BlockingTask;
};

/**
 * Work that holds up the day. Read only by blockingTask().
 *
 * SET_ASIDE is deliberately absent. Somebody has said they cannot do it and
 * chosen to keep it anyway; making it go on blocking everything after it would
 * be the exact problem setting it aside exists to solve. It is still owed --
 * it stays on the day, and the manager sees it in triage -- it just no longer
 * stands in the way.
 */
const OUTSTANDING = [
  "ASSIGNED",
  "IN_PROGRESS",
  "PAUSED",
  "ORPHANED",
] satisfies TaskStatus[];

/**
 * The day runs in order. You cannot skip ahead to a later task while an
 * earlier one is still outstanding -- including one you paused, since
 * otherwise pausing everything would be a way round the rule.
 *
 * Returns the earliest task still owed, or null when the way is clear.
 */
async function blockingTask(
  userId: string,
  task: {
    id: string;
    scheduledDate: Date | null;
    scheduledStart: number | null;
    followsTaskId?: string | null;
  },
) {
  /**
   * A pair is a pair whatever the clock says.
   *
   * The rule below already catches the usual case, because a follower is placed
   * after its leader and therefore sorts later. That stops being true the
   * moment either of them ends up without a slot -- an unplaced task sorts last
   * and blocks nothing -- so the link is checked directly rather than inferred
   * from where the two happened to land.
   */
  if (task.followsTaskId) {
    const leader = await prisma.task.findUnique({
      where: { id: task.followsTaskId },
      select: {
        id: true,
        title: true,
        status: true,
        scheduledStart: true,
      },
    });
    if (leader && leader.status !== "DONE" && leader.status !== "CANCELLED") {
      return {
        id: leader.id,
        title: leader.title,
        start: leader.scheduledStart,
        status: leader.status,
      };
    }
  }

  if (!task.scheduledDate) return null;

  const earlier = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      scheduledDate: task.scheduledDate,
      id: { not: task.id },
      status: { in: OUTSTANDING },
    },
    orderBy: [{ scheduledStart: "asc" }, { title: "asc" }],
  });

  // Unplaced work sorts last, so it never blocks something with a real slot.
  const mine = task.scheduledStart ?? Number.MAX_SAFE_INTEGER;
  const owed = earlier.find(
    (t) => (t.scheduledStart ?? Number.MAX_SAFE_INTEGER) < mine,
  );

  return owed
    ? { id: owed.id, title: owed.title, start: owed.scheduledStart, status: owed.status }
    : null;
}

async function ownedTask(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) fail("errors.taskGone");
  if (task.assigneeId !== userId) fail("errors.notYourTask");
  return task;
}

/** Prisma client or an interactive transaction -- both can run this query. */
type Db = Pick<typeof prisma, "timeEntry">;

/** The one open time entry for this person, if any. */
function openEntry(userId: string, db: Db = prisma) {
  return db.timeEntry.findFirst({
    where: { userId, endedAt: null },
    include: { pauses: { where: { resumedAt: null } } },
  });
}

export async function startTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const { taskId } = TaskId.parse({ taskId: formData.get("taskId") });
    const task = await ownedTask(taskId, user.id);

    if (task.status === "DONE") return { error: t("errors.taskAlreadyDone") };

    // Resuming your own paused task is always allowed -- it is the task you
    // were told to finish.
    if (task.status !== "PAUSED") {
      const owed = await blockingTask(user.id, task);
      if (owed) {
        return {
          error: t("errors.blockedBy", owed.title),
          blockedBy: owed,
        };
      }
    }

    await prisma.$transaction(async (tx) => {
      // Read what is running *inside* the transaction. Reading it outside let
      // two concurrent starts both see nothing and both open an entry, which
      // double-counted the elapsed time.
      const running = await openEntry(user.id, tx);

      // Stand down whatever else was running, so two timers never overlap.
      if (running && running.taskId !== taskId) {
        await tx.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: new Date() },
        });
        await tx.task.update({
          where: { id: running.taskId },
          data: { status: "ASSIGNED" },
        });
      }

      // Resuming a paused task closes the open pause rather than starting a
      // second entry, so elapsed time stays continuous.
      if (running && running.taskId === taskId) {
        const open = running.pauses[0];
        if (open) {
          await tx.pauseEvent.update({
            where: { id: open.id },
            data: { resumedAt: new Date() },
          });
        }
      } else {
        await tx.timeEntry.create({ data: { taskId, userId: user.id } });
      }

      await tx.task.update({
        where: { id: taskId },
        data: { status: "IN_PROGRESS" },
      });
    });

    // Starting work is a clock-in for anybody whose session survived from
    // yesterday, so no login fired today. It also reopens a day that was
    // closed -- see markArrival.
    await markArrival(user.id, "TASK_START");

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    // Under READ COMMITTED the in-transaction read is not enough on its own;
    // the partial unique index on TimeEntry is what actually stops the second
    // start, and this is how it surfaces.
    // Expected under contention rather than a fault, so it is not logged.
    if (isUniqueViolation(error)) {
      return { error: await message("errors.somethingElseRunning") };
    }
    return { error: await errorText(error, "errors.couldNotStart") };
  }
}

export async function pauseTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = PauseInput.safeParse({
      taskId: formData.get("taskId"),
      reasonCode: formData.get("reasonCode"),
      reasonText: formData.get("reasonText"),
    });

    if (!parsed.success) {
      return { error: t(parsed.error.issues[0].message) };
    }

    await ownedTask(parsed.data.taskId, user.id);

    const running = await openEntry(user.id);
    if (!running || running.taskId !== parsed.data.taskId) {
      return { error: t("errors.notRunning") };
    }
    if (running.pauses.length > 0) return { error: t("errors.alreadyPaused") };

    await prisma.$transaction([
      prisma.pauseEvent.create({
        data: {
          timeEntryId: running.id,
          reasonCode: parsed.data.reasonCode,
          reasonText: parsed.data.reasonText,
        },
      }),
      prisma.task.update({
        where: { id: parsed.data.taskId },
        data: { status: "PAUSED" },
      }),
    ]);

    await markActivity(user.id);

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotPause") };
  }
}

export async function completeTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const { taskId } = TaskId.parse({ taskId: formData.get("taskId") });
    await ownedTask(taskId, user.id);

    const running = await openEntry(user.id);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      if (running && running.taskId === taskId) {
        // Close an open pause first, or the paused stretch never ends.
        const open = running.pauses[0];
        if (open) {
          await tx.pauseEvent.update({
            where: { id: open.id },
            data: { resumedAt: now },
          });
        }
        await tx.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: now },
        });
      }

      await tx.task.update({ where: { id: taskId }, data: { status: "DONE" } });
    });

    // The last sitting of a long job finishes the job. A no-op for anything
    // that is not one.
    await closeParentIfComplete(taskId);

    // Recorded, but deliberately not treated as leaving: there is usually
    // another task after this one. Only signing out or closing the day ends it.
    await markActivity(user.id, now, { taskEnded: true });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotComplete"),
    };
  }
}


const Defer = z.object({
  taskId: z.string().min(1),
  reason: z.string().trim().min(3, "errors.sayWhyYouCouldNot"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.sayWhenYouWill"),
});

/**
 * Overriding the day's order: you could not do a task, so you say why and
 * when you will. The task moves to that date and the reason is recorded --
 * the point is not to stop people, it is to know why the plan slipped.
 */
export async function deferTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Defer.safeParse({
      taskId: formData.get("taskId"),
      reason: formData.get("reason"),
      date: formData.get("date"),
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const task = await ownedTask(parsed.data.taskId, user.id);
    if (task.status === "DONE") return { error: t("errors.alreadyDone") };

    const from = task.scheduledDate ?? task.dueDate;
    const to = toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`));

    // A running or paused task has to be stood down before it moves.
    const running = await openEntry(user.id);
    if (running && running.taskId === task.id) {
      const now = new Date();
      const open = running.pauses[0];
      await prisma.$transaction([
        ...(open
          ? [
              prisma.pauseEvent.update({
                where: { id: open.id },
                data: { resumedAt: now },
              }),
            ]
          : []),
        prisma.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: now },
        }),
      ]);
    }

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: {
          dueDate: to,
          scheduledDate: null,
          scheduledStart: null,
          scheduledEnd: null,
          status: "ASSIGNED",
        },
      }),
      prisma.taskDeferral.create({
        data: {
          taskId: task.id,
          userId: user.id,
          reason: parsed.data.reason,
          fromDate: from,
          toDate: to,
        },
      }),
    ]);

    // Give it a slot on the new day. Moving it later today must land after
    // now, or it would reappear above the task you are about to start.
    const notBefore =
      dateKey(to) === dateKey(from)
        ? (task.scheduledEnd ?? 0)
        : 0;
    await placeOnDay(task.id, user.id, to, notBefore);

    /**
     * Whatever goes hand in hand with it moves too.
     *
     * Leaving the report behind on a day whose review has gone would strand
     * work nobody is allowed to start -- blockingTask() would refuse it, and
     * the day would look busy with something impossible.
     */
    const following = await followersOf([task.id]);
    let cursor = (await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { scheduledEnd: true },
    })).scheduledEnd ?? notBefore;

    for (const follower of following) {
      if (STARTED.includes(follower.status)) continue;
      await prisma.task.update({
        where: { id: follower.id },
        data: {
          dueDate: to,
          scheduledDate: null,
          scheduledStart: null,
          scheduledEnd: null,
          status: "ASSIGNED",
        },
      });
      await placeOnDay(follower.id, user.id, to, cursor);
      const placed = await prisma.task.findUniqueOrThrow({
        where: { id: follower.id },
        select: { scheduledEnd: true },
      });
      cursor = placed.scheduledEnd ?? cursor;
    }

    /**
     * Moving one sitting shuffles the rest of the job in after it. Leaving
     * them where they were would put sitting 3 on Wednesday and sitting 2 on
     * Friday, and the day would then refuse to start either.
     */
    if (task.parentTaskId) {
      await respreadSessions(task.parentTaskId, to);
    }

    await markActivity(user.id);

    revalidatePath("/", "layout");
    revalidatePath("/plan");
    revalidatePath("/triage");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotMoveIt") };
  }
}

/**
 * "That is the whole job finished" -- in three sittings instead of four.
 *
 * The ordinary case rather than an exception, and it needs saying out loud:
 * the fourth sitting is holding time on Friday that is actually free, and
 * leaving it there would be work nobody knows was abandoned.
 *
 * Nothing records that it came in under the estimate. The job ends DONE with
 * its original figure and the time actually tracked against its sittings, and
 * the estimate-drift reading on /me is exactly that comparison.
 */
export async function finishWholeJob(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const { taskId } = TaskId.parse({ taskId: formData.get("taskId") });

    const task = await ownedTask(taskId, user.id);
    if (!task.parentTaskId) return { error: t("errors.notPartOfAJob") };

    const running = await openEntry(user.id);
    const now = new Date();

    // The sitting in hand is closed exactly as completeTask closes one.
    await prisma.$transaction(async (tx) => {
      if (running && running.taskId === taskId) {
        const open = running.pauses[0];
        if (open) {
          await tx.pauseEvent.update({
            where: { id: open.id },
            data: { resumedAt: now },
          });
        }
        await tx.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: now },
        });
      }
      await tx.task.update({ where: { id: taskId }, data: { status: "DONE" } });
    });

    // Then the rest of the job is stood down and the days it held come free.
    await finishSplitJob(taskId);

    await markActivity(user.id, now, { taskEnded: true });

    revalidatePath("/", "layout");
    revalidatePath("/plan");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotComplete") };
  }
}


const Blocked = z.object({
  taskId: z.string().min(1),
  reason: z.string().trim().min(3, "errors.sayWhatIsHoldingItUp"),
  outcome: z.enum(["MOVED", "HANDED_BACK", "SET_ASIDE", "CANCEL_REQUESTED"]),
  // Only read for MOVED; the dialog reveals the picker for that one alone.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "errors.sayWhenYouWill")
    .optional()
    .or(z.literal("")),
});

/**
 * "I cannot do this one."
 *
 * The meeting you turned up for and the other person was not in; the job that
 * is waiting on somebody outside. The person writes what happened and chooses
 * what should become of the task, and the manager sees both in triage.
 *
 * Deliberately their choice rather than the manager's. They are the one who
 * knows whether this is a tomorrow problem or a somebody-else problem, and
 * making them wait for an answer would leave the rest of the day stalled
 * behind a task the ordering rule will not let them skip.
 *
 * Cancelling outright is the one thing not on offer: "this does not need
 * doing" is a request, and only a manager settles it.
 */
export async function reportBlocked(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Blocked.safeParse({
      taskId: formData.get("taskId"),
      reason: formData.get("reason"),
      outcome: formData.get("outcome"),
      date: formData.get("date") ?? "",
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const { taskId, reason, outcome } = parsed.data;
    const task = await ownedTask(taskId, user.id);
    if (task.status === "DONE") return { error: t("errors.alreadyDone") };
    if (task.status === "CANCELLED") return { error: t("errors.taskGone") };

    /**
     * Moving it is exactly what deferTask has always done -- the date change,
     * the TaskDeferral, the follower cascade, the re-spread of a split job --
     * so it is delegated rather than reimplemented slightly differently here.
     */
    if (outcome === "MOVED") {
      if (!parsed.data.date) return { error: t("errors.sayWhenYouWill") };
      const moved = new FormData();
      moved.set("taskId", taskId);
      moved.set("reason", reason);
      moved.set("date", parsed.data.date);
      const result = await deferTask({}, moved);
      if (result.error) return result;

      await prisma.taskBlock.create({
        data: {
          taskId,
          userId: user.id,
          reason,
          outcome,
          movedTo: toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`)),
        },
      });

      revalidatePath("/triage");
      return { ok: true };
    }

    // Everything else stands the clock down first: you are not working on it.
    const running = await openEntry(user.id);
    if (running && running.taskId === task.id) {
      const now = new Date();
      const open = running.pauses[0];
      await prisma.$transaction([
        ...(open
          ? [
              prisma.pauseEvent.update({
                where: { id: open.id },
                data: { resumedAt: now },
              }),
            ]
          : []),
        prisma.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: now },
        }),
      ]);
    }

    if (outcome === "HANDED_BACK") {
      /**
       * Given back: orphaned, with the reason on the task, which puts it in
       * the queue getTriageQueue already reads and the manager already knows
       * how to clear. Whatever went hand in hand with it goes too -- the
       * second half of a pair whose first half somebody handed back is work
       * nobody can start.
       */
      const following = await followersOf([task.id]);
      const ids = [task.id, ...following.filter((f) => !STARTED.includes(f.status)).map((f) => f.id)];

      await prisma.$transaction([
        prisma.task.updateMany({
          where: { id: { in: ids } },
          data: {
            status: "ORPHANED",
            orphanedAt: new Date(),
            orphanReason: reason,
            scheduledStart: null,
            scheduledEnd: null,
          },
        }),
        prisma.taskBlock.create({
          data: { taskId: task.id, userId: user.id, reason, outcome },
        }),
      ]);
    } else {
      /**
       * Set aside, or a request to cancel. Both keep the task where it is and
       * stop it holding up the day; the difference is only what the manager is
       * being asked for. Its slot is kept, so the shape of the day does not
       * shift under the person while they carry on with the next thing.
       */
      await prisma.$transaction([
        prisma.task.update({
          where: { id: task.id },
          data: { status: "SET_ASIDE" },
        }),
        prisma.taskBlock.create({
          data: { taskId: task.id, userId: user.id, reason, outcome },
        }),
      ]);
    }

    await markActivity(user.id);

    revalidatePath("/", "layout");
    revalidatePath("/plan");
    revalidatePath("/triage");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

const Reorder = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  taskIds: z.array(z.string().min(1)).min(1),
});

/**
 * Rearrange today by hand.
 *
 * The engine's order is a proposal, not a verdict -- people know which job is
 * worth doing first. Given the new order, the day is repacked from the top:
 * each task takes the next slot that fits it in the person's free windows.
 *
 * Work already started, paused or finished keeps its slot and is scheduled
 * around, since it has tracked time attached. A task that no longer fits ends
 * up without a slot rather than blocking the reorder.
 */
export async function reorderDay(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Reorder.safeParse({
      date: formData.get("date"),
      taskIds: formData.getAll("taskIds").map(String),
    });
    if (!parsed.success) return { error: t("errors.couldNotReadOrder") };

    const day = toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`));

    const tasks = await prisma.task.findMany({
      where: {
        assigneeId: user.id,
        scheduledDate: day,
        status: { notIn: ["CANCELLED"] },
      },
    });

    const byId = new Map(tasks.map((t) => [t.id, t]));
    // Only reorder what was actually sent, and only this person's tasks.
    const ordered = parsed.data.taskIds
      .map((id) => byId.get(id))
      .filter((t): t is (typeof tasks)[number] => t !== undefined);

    /**
     * A follower cannot be dragged above the thing it follows.
     *
     * Refused rather than quietly re-sorted: silently undoing half a drag looks
     * like the feature is broken, and the person deserves to be told the two
     * jobs go together.
     */
    const positions = new Map(ordered.map((t, i) => [t.id, i]));
    for (const [index, task] of ordered.entries()) {
      if (!task.followsTaskId) continue;
      const leaderAt = positions.get(task.followsTaskId);
      if (leaderAt != null && leaderAt > index) {
        return { error: t("errors.followerBeforeLeader") };
      }
    }

    const [patterns, overrides, absences] = await Promise.all([
      prisma.workingPattern.findMany({ where: { userId: user.id } }),
      prisma.dayOverride.findMany({ where: { userId: user.id, date: day } }),
      prisma.absence.findMany({
        where: { userId: user.id, startDate: { lte: day }, endDate: { gte: day } },
      }),
    ]);

    const availability = computeAvailability({
      date: day,
      patterns,
      overrides,
      absences,
    });

    // Started work keeps its place; everything else is laid out afresh.
    const frozen = ordered.filter((t) => STARTED.includes(t.status));
    let free = availability.windows;
    for (const t of frozen) {
      if (t.scheduledStart == null || t.scheduledEnd == null) continue;
      free = subtractWindow(free, t.scheduledStart, t.scheduledEnd);
    }

    const updates: { id: string; start: number | null; end: number | null }[] = [];

    /**
     * Pack strictly forwards: each task starts at or after the previous one
     * ends. Plain first-fit would keep the sequence but not the clock -- a
     * task too big for the next gap would jump to the afternoon while the
     * ones after it filled the morning, so the list would no longer read in
     * time order, which is the whole point of dragging it.
     */
    let cursor = 0;

    for (const task of ordered) {
      if (STARTED.includes(task.status)) {
        if (task.scheduledEnd != null) cursor = Math.max(cursor, task.scheduledEnd);
        continue;
      }
      const slot = findSlot(free, task.estimatedMinutes, cursor);
      if (slot) {
        free = subtractWindow(free, slot.start, slot.end);
        cursor = slot.end;
      }
      updates.push({
        id: task.id,
        start: slot?.start ?? null,
        end: slot?.end ?? null,
      });
    }

    await prisma.$transaction(
      updates.map((u) =>
        prisma.task.update({
          where: { id: u.id },
          data: { scheduledStart: u.start, scheduledEnd: u.end },
        }),
      ),
    );

    revalidatePath("/", "layout");
    revalidatePath("/my-calendar");
    return { ok: true };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotReorder"),
    };
  }
}

/** Remove [from, to) from a set of windows. */
function subtractWindow(
  windows: { start: number; end: number }[],
  from: number,
  to: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const w of windows) {
    if (to <= w.start || from >= w.end) {
      out.push(w);
      continue;
    }
    if (from > w.start) out.push({ start: w.start, end: from });
    if (to < w.end) out.push({ start: to, end: w.end });
  }
  return out;
}
