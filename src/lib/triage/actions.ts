"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText, fail } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { getAvailability } from "@/lib/scheduling/availability-db";
import { findSlot } from "@/lib/scheduling/availability";
import { toDateOnly } from "@/lib/time";

/** Every resolution is recorded, so "why did this task move" stays answerable. */

export type TriageState = { error?: string; ok?: boolean };

const Reassign = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
  /** Optional word about why they are getting it. Sent on as a message. */
  note: z.string().trim().max(2000).optional(),
});

const Push = z.object({
  taskId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.pickADate"),
});

/**
 * Work waiting for a manager's decision.
 *
 * ORPHANED is the classic case -- an absence displaced it. SET_ASIDE is the
 * newer one: somebody said they could not do it and kept it, or asked for it
 * to be cancelled. Both sit in the queue and take the same three answers.
 */
const FOR_MANAGER = ["ORPHANED", "SET_ASIDE"];

/**
 * Close off whatever somebody said about this task.
 *
 * Any of the three answers settles it: the account has been read and acted on,
 * so it stops being a thing waiting for attention. The row itself is kept --
 * "why did this move" has to stay answerable long after the queue is empty.
 */
function resolveBlocks(taskId: string) {
  return prisma.taskBlock.updateMany({
    where: { taskId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

async function orphanForManager(taskId: string, departmentId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) fail("errors.taskGone");
  if (!FOR_MANAGER.includes(task.status)) fail("errors.noLongerInTriage");
  if (task.departmentId !== departmentId) {
    fail("errors.taskOtherDepartment");
  }
  return task;
}

export async function reassignTask(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  try {
    const actor = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const parsed = Reassign.safeParse({
      taskId: formData.get("taskId"),
      userId: formData.get("userId"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const task = await orphanForManager(parsed.data.taskId, actor.departmentId);
    const date = task.scheduledDate ?? task.dueDate;

    // Re-check capacity at the moment of the click. The queue was computed
    // when the page loaded, and somebody else may have taken the slot since.
    const availability = await getAvailability(parsed.data.userId, date);
    const slot = findSlot(availability.windows, task.estimatedMinutes);
    if (!slot) {
      return { error: t("errors.noRoomReload") };
    }

    const newAssignee = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { displayName: true },
    });

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: {
          assigneeId: parsed.data.userId,
          scheduledDate: toDateOnly(date),
          scheduledStart: slot.start,
          scheduledEnd: slot.end,
          status: "ASSIGNED",
          orphanedAt: null,
          orphanReason: null,
        },
      }),
      resolveBlocks(task.id),
      prisma.triageAction.create({
        data: {
          taskId: task.id,
          resolvedById: actor.id,
          resolution: "REASSIGNED",
          detail: `Given to ${newAssignee?.displayName ?? "someone else"}`,
        },
      }),
    ]);

    /**
     * Sent after the task actually moved, not in the same transaction: a
     * message about a handover that failed would be worse than no message,
     * and a handover that worked is not worth undoing over a failed message.
     */
    if (parsed.data.note) {
      await prisma.message.create({
        data: {
          senderId: actor.id,
          recipientId: parsed.data.userId,
          body: parsed.data.note,
          taskId: task.id,
        },
      });
    }

    revalidatePath("/", "layout");
    revalidatePath("/triage");
    revalidatePath("/team");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not reassign",
    };
  }
}

export async function pushTask(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  try {
    const actor = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const parsed = Push.safeParse({
      taskId: formData.get("taskId"),
      date: formData.get("date"),
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const task = await orphanForManager(parsed.data.taskId, actor.departmentId);
    if (!task.assigneeId) return { error: t("errors.nobodyToPushTo") };

    const target = toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`));
    const availability = await getAvailability(task.assigneeId, target);
    const slot = findSlot(availability.windows, task.estimatedMinutes);
    if (!slot) {
      return { error: t("errors.noRoomEither") };
    }

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: {
          scheduledDate: target,
          scheduledStart: slot.start,
          scheduledEnd: slot.end,
          // The due date moves too, or the next scheduling run will treat it
          // as overdue and fight the decision that was just made.
          dueDate: target,
          status: "ASSIGNED",
          orphanedAt: null,
          orphanReason: null,
        },
      }),
      resolveBlocks(task.id),
      prisma.triageAction.create({
        data: {
          taskId: task.id,
          resolvedById: actor.id,
          resolution: "PUSHED",
          detail: `Moved to ${parsed.data.date}`,
        },
      }),
    ]);

    revalidatePath("/triage");
    revalidatePath("/team");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotPush") };
  }
}

export async function cancelTask(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  try {
    const actor = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const taskId = String(formData.get("taskId") ?? "");
    const task = await orphanForManager(taskId, actor.departmentId);

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { status: "CANCELLED", orphanedAt: null },
      }),
      /**
       * Cancelling a long job cancels its sittings too. The foreign key only
       * cascades deletes, not status changes, so without this the job would
       * read as cancelled while four sittings of it stayed on the calendar.
       *
       * Cancelling a single sitting is left alone: that is one afternoon of a
       * job, not the job.
       */
      prisma.task.updateMany({
        where: { parentTaskId: task.id, status: { not: "DONE" } },
        data: {
          status: "CANCELLED",
          scheduledDate: null,
          scheduledStart: null,
          scheduledEnd: null,
        },
      }),
      resolveBlocks(task.id),
      prisma.triageAction.create({
        data: {
          taskId: task.id,
          resolvedById: actor.id,
          resolution: "CANCELLED",
          detail: "Decided it does not need doing",
        },
      }),
    ]);

    revalidatePath("/triage");
    revalidatePath("/team");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotCancel") };
  }
}

/**
 * "Do it anyway."
 *
 * The fourth answer, and the one the other three cannot express: the reason
 * has been read and the task still stands. Puts it back in the person's day
 * where it was, rather than moving it or handing it to somebody else.
 *
 * Only for work they still hold -- something already orphaned has no owner to
 * give it back to, and reassigning is the action for that.
 */
export async function putItBack(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  try {
    const actor = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const taskId = String(formData.get("taskId") ?? "");
    const task = await orphanForManager(taskId, actor.departmentId);
    if (!task.assigneeId) return { error: t("errors.nobodyToPushTo") };

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { status: "ASSIGNED", orphanedAt: null, orphanReason: null },
      }),
      resolveBlocks(task.id),
    ]);

    revalidatePath("/", "layout");
    revalidatePath("/triage");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

/**
 * Read and noted, nothing to change.
 *
 * "The client rang back, it is fine now" needs no decision about the task --
 * but leaving the account sitting in the queue for ever would make the queue
 * useless. Touches only the block row.
 */
export async function dismissBlock(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  try {
    const actor = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const id = String(formData.get("blockId") ?? "");

    const block = await prisma.taskBlock.findUnique({
      where: { id },
      include: { task: { select: { departmentId: true } } },
    });
    if (!block) return { error: t("errors.itemGone") };
    if (block.task.departmentId !== actor.departmentId) {
      return { error: t("errors.taskOtherDepartment") };
    }

    await prisma.taskBlock.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });

    revalidatePath("/triage");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}
