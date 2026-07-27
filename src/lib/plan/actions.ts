"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { toDateOnly } from "@/lib/time";

/**
 * Planning actions: taking work, giving it back, adding it, moving it and
 * skipping it.
 *
 * Claiming is first-come-first-served, so every claim is a conditional update
 * rather than read-then-write. Two people pressing the button at the same
 * moment must not both end up owning the task.
 */

export type PlanState = { error?: string; ok?: boolean; message?: string };

const TaskId = z.object({ taskId: z.string().min(1) });

const AddTask = z.object({
  templateId: z.string().min(1, "Pick a task"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day"),
  /** Set once the person has been warned somebody else already has it. */
  confirmDuplicate: z.boolean().optional(),
});

const MoveTask = z.object({
  taskId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day"),
});

function revalidate() {
  revalidatePath("/plan");
  revalidatePath("/my-day");
  revalidatePath("/my-calendar");
  revalidatePath("/team");
}

export async function claimTask(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  try {
    const user = await requireUserOrThrow();
    const { taskId } = TaskId.parse({ taskId: formData.get("taskId") });

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: { select: { displayName: true } } },
    });
    if (!task) return { error: "That task no longer exists" };
    if (task.departmentId !== user.departmentId) {
      return { error: "That task belongs to another department" };
    }

    // Conditional update: only succeeds while the task is genuinely free, so
    // a simultaneous claim by somebody else loses rather than overwrites.
    const { count } = await prisma.task.updateMany({
      where: { id: taskId, assigneeId: null },
      data: { status: "ASSIGNED", assigneeId: user.id },
    });

    if (count === 0) {
      const now = await prisma.task.findUnique({
        where: { id: taskId },
        include: { assignee: { select: { displayName: true } } },
      });
      const who = now?.assignee?.displayName;
      return {
        error: who
          ? `${who} took this one first. Reload to see the day as it stands.`
          : "That task is no longer available",
      };
    }

    revalidate();
    return { ok: true, message: `You took ${task.title}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not claim" };
  }
}

export async function releaseTask(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  try {
    const user = await requireUserOrThrow();
    const { taskId } = TaskId.parse({ taskId: formData.get("taskId") });

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return { error: "That task no longer exists" };
    if (task.assigneeId !== user.id) return { error: "That is not yours to give back" };
    if (["IN_PROGRESS", "PAUSED", "DONE"].includes(task.status)) {
      return { error: "You have already started this — complete it instead" };
    }

    await prisma.task.update({
      where: { id: taskId },
      data: {
        assigneeId: null,
        status: "UNASSIGNED",
        scheduledDate: null,
        scheduledStart: null,
        scheduledEnd: null,
      },
    });

    revalidate();
    return { ok: true, message: `${task.title} is back in the pool.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not release" };
  }
}

export async function addTaskToDay(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  try {
    const user = await requireUserOrThrow();
    const parsed = AddTask.safeParse({
      templateId: formData.get("templateId"),
      date: formData.get("date"),
      confirmDuplicate: formData.get("confirmDuplicate") === "true",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const template = await prisma.taskTemplate.findUnique({
      where: { id: parsed.data.templateId },
    });
    if (!template) return { error: "That task is not in the catalogue" };
    if (template.departmentId !== user.departmentId) {
      return { error: "That task belongs to another department" };
    }

    const date = toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`));

    // Is this template already on that day?
    const existing = await prisma.task.findFirst({
      where: {
        templateId: template.id,
        dueDate: date,
        status: { not: "CANCELLED" },
      },
      include: { assignee: { select: { id: true, displayName: true } } },
    });

    if (existing) {
      if (existing.assigneeId === user.id) {
        return { error: `You already have ${template.name} that day.` };
      }
      // Free: take it rather than making a second copy.
      if (existing.assigneeId === null) {
        await prisma.task.updateMany({
          where: { id: existing.id, assigneeId: null },
          data: { status: "ASSIGNED", assigneeId: user.id },
        });
        revalidate();
        return { ok: true, message: `You took ${template.name}.` };
      }
      // Somebody has it. Several catalogue tasks say "max 1 integrante por
      // dia", so warn before adding a second -- but allow it deliberately.
      if (!parsed.data.confirmDuplicate) {
        return {
          error:
            `${existing.assignee?.displayName} already has ${template.name} ` +
            `that day. Add another anyway?`,
        };
      }
    }

    await prisma.task.create({
      data: {
        title: template.name,
        estimatedMinutes: template.estimatedMinutes,
        dueDate: date,
        departmentId: user.departmentId,
        templateId: template.id,
        origin: "CATALOGUE",
        status: "ASSIGNED",
        assigneeId: user.id,
      },
    });

    revalidate();
    return { ok: true, message: `Added ${template.name}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not add it" };
  }
}

export async function moveTaskToDay(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  try {
    const user = await requireUserOrThrow();
    const parsed = MoveTask.safeParse({
      taskId: formData.get("taskId"),
      date: formData.get("date"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId } });
    if (!task) return { error: "That task no longer exists" };
    if (task.assigneeId !== user.id) return { error: "That is not your task" };
    if (["IN_PROGRESS", "PAUSED", "DONE"].includes(task.status)) {
      return { error: "You have already started this one" };
    }

    const date = toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`));

    await prisma.task.update({
      where: { id: task.id },
      data: {
        dueDate: date,
        // The slot no longer means anything on a different day; the next
        // scheduling run places it again.
        scheduledDate: null,
        scheduledStart: null,
        scheduledEnd: null,
      },
    });

    revalidate();
    return { ok: true, message: `Moved ${task.title}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not move it" };
  }
}

export async function skipTask(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  try {
    const user = await requireUserOrThrow();
    const { taskId } = TaskId.parse({ taskId: formData.get("taskId") });

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return { error: "That task no longer exists" };
    if (task.departmentId !== user.departmentId) {
      return { error: "That task belongs to another department" };
    }
    if (["IN_PROGRESS", "PAUSED", "DONE"].includes(task.status)) {
      return { error: "You have already started this one" };
    }

    // Cancelling this instance only. The recurring rule is untouched, so it
    // comes back next week.
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "CANCELLED", assigneeId: task.assigneeId },
    });

    revalidate();
    return { ok: true, message: `Skipped ${task.title} for that day.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not skip it" };
  }
}
