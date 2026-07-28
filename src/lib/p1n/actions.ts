"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hasRole, requireUserOrThrow } from "@/lib/auth/guards";

/**
 * P1N — "pasa 1 vez, no vuelve a pasar".
 *
 * You report your own mistake, say why it happened, and propose what would
 * stop it happening again. The cause matters more than it looks: a lapse of
 * attention and a badly written procedure need completely different fixes,
 * and only one of them is about the person.
 */

export type P1nState = { error?: string; ok?: boolean; message?: string };

const NewP1n = z.object({
  mistake: z.string().trim().min(10, "Describe what happened"),
  cause: z.enum(["ATTENTION", "PROCESS", "OTHER"]),
  solution: z.string().trim().min(10, "What would stop it happening again?"),
  taskId: z.string().optional(),
});

export async function fileP1n(
  _prev: P1nState,
  formData: FormData,
): Promise<P1nState> {
  try {
    const user = await requireUserOrThrow();
    const parsed = NewP1n.safeParse({
      mistake: formData.get("mistake"),
      cause: formData.get("cause"),
      solution: formData.get("solution"),
      taskId: formData.get("taskId") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    // Only your own work can be attached, so a P1N cannot point at somebody
    // else's task.
    let taskId: string | null = null;
    if (parsed.data.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: parsed.data.taskId },
      });
      if (task && task.assigneeId === user.id) taskId = task.id;
    }

    await prisma.p1n.create({
      data: {
        userId: user.id,
        departmentId: user.departmentId,
        mistake: parsed.data.mistake,
        cause: parsed.data.cause,
        solution: parsed.data.solution,
        taskId,
      },
    });

    revalidatePath("/p1n");
    revalidatePath("/me");
    revalidatePath("/my-day");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not send it" };
  }
}

const Applied = z.object({
  p1nId: z.string().min(1),
  note: z.string().trim().max(500).optional(),
});

/**
 * Mark the proposed fix as actually made. Without this a P1N is a suggestion
 * box: the report is only worth filing if something changes because of it.
 */
export async function markApplied(
  _prev: P1nState,
  formData: FormData,
): Promise<P1nState> {
  try {
    const user = await requireUserOrThrow("MANAGER");
    const parsed = Applied.safeParse({
      p1nId: formData.get("p1nId"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const p1n = await prisma.p1n.findUnique({ where: { id: parsed.data.p1nId } });
    if (!p1n) return { error: "That P1N no longer exists" };
    if (p1n.departmentId !== user.departmentId && !hasRole(user, "ADMIN")) {
      return { error: "That belongs to another department" };
    }

    await prisma.p1n.update({
      where: { id: p1n.id },
      data: {
        appliedAt: p1n.appliedAt ? null : new Date(),
        appliedById: p1n.appliedAt ? null : user.id,
        appliedNote: p1n.appliedAt ? null : parsed.data.note,
      },
    });

    revalidatePath("/p1n");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save" };
  }
}
