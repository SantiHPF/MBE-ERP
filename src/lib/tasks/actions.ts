"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import type { TaskStatus } from "@prisma/client";
import { dateKey, toDateOnly } from "@/lib/time";
import { placeOnDay } from "@/lib/plan/place";

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
  reasonText: z.string().trim().min(3, "Say what is holding it up"),
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
  task: { id: string; scheduledDate: Date | null; scheduledStart: number | null },
) {
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
  if (!task) throw new Error("That task no longer exists");
  if (task.assigneeId !== userId) throw new Error("That is not your task");
  return task;
}

/** The one open time entry for this person, if any. */
function openEntry(userId: string) {
  return prisma.timeEntry.findFirst({
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
    const { taskId } = TaskId.parse({ taskId: formData.get("taskId") });
    const task = await ownedTask(taskId, user.id);

    if (task.status === "DONE") return { error: "That task is already done" };

    // Resuming your own paused task is always allowed -- it is the task you
    // were told to finish.
    if (task.status !== "PAUSED") {
      const owed = await blockingTask(user.id, task);
      if (owed) {
        return {
          error: `Finish ${owed.title} first, or say why you could not.`,
          blockedBy: owed,
        };
      }
    }

    const running = await openEntry(user.id);

    await prisma.$transaction(async (tx) => {
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

    revalidatePath("/my-day");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start" };
  }
}

export async function pauseTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const parsed = PauseInput.safeParse({
      taskId: formData.get("taskId"),
      reasonCode: formData.get("reasonCode"),
      reasonText: formData.get("reasonText"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0].message };
    }

    await ownedTask(parsed.data.taskId, user.id);

    const running = await openEntry(user.id);
    if (!running || running.taskId !== parsed.data.taskId) {
      return { error: "That task is not running" };
    }
    if (running.pauses.length > 0) return { error: "It is already paused" };

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

    revalidatePath("/my-day");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not pause" };
  }
}

export async function completeTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
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

    revalidatePath("/my-day");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not complete",
    };
  }
}


const Defer = z.object({
  taskId: z.string().min(1),
  reason: z.string().trim().min(3, "Say why you could not do it"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Say when you will do it"),
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
    const parsed = Defer.safeParse({
      taskId: formData.get("taskId"),
      reason: formData.get("reason"),
      date: formData.get("date"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const task = await ownedTask(parsed.data.taskId, user.id);
    if (task.status === "DONE") return { error: "That one is already done" };

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

    revalidatePath("/my-day");
    revalidatePath("/plan");
    revalidatePath("/triage");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not move it" };
  }
}
