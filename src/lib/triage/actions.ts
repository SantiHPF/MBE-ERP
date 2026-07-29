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
});

const Push = z.object({
  taskId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.pickADate"),
});

async function orphanForManager(taskId: string, departmentId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) fail("errors.taskGone");
  if (task.status !== "ORPHANED") fail("errors.noLongerInTriage");
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
      prisma.triageAction.create({
        data: {
          taskId: task.id,
          resolvedById: actor.id,
          resolution: "REASSIGNED",
          detail: `Given to ${newAssignee?.displayName ?? "someone else"}`,
        },
      }),
    ]);

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
