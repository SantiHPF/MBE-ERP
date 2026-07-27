"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";

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

export type ActionState = { error?: string; ok?: boolean };

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
