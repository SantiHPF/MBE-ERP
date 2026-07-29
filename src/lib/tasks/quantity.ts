"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { placeOnDay } from "@/lib/plan/place";
import type { ActionState } from "./actions";

/**
 * How many times a task is being done.
 *
 * Some catalogue estimates are per go -- a candidate call is seven minutes,
 * and nobody makes one call. Rather than ten identical rows, the task carries
 * a quantity and the total minutes follow from it, so everything that reasons
 * about capacity keeps working unchanged.
 */

const SetQuantity = z.object({
  taskId: z.string().min(1),
  quantity: z.coerce.number().int().min(1, "errors.atLeastOne").max(200, "errors.thatIsALot"),
});

export async function setTaskQuantity(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = SetQuantity.safeParse({
      taskId: formData.get("taskId"),
      quantity: formData.get("quantity"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const task = await prisma.task.findUnique({
      where: { id: parsed.data.taskId },
      include: { template: { select: { estimatedMinutes: true } } },
    });
    if (!task) return { error: t("errors.taskGone") };
    if (task.assigneeId !== user.id) return { error: t("errors.notYourTask") };
    if (task.status === "DONE") return { error: t("errors.alreadyDone") };

    // Work out the per-go cost once, then keep it on the task so later edits
    // do not compound against an already-multiplied total.
    const unit =
      task.unitMinutes ??
      task.template?.estimatedMinutes ??
      Math.round(task.estimatedMinutes / Math.max(1, task.quantity));

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        unitMinutes: unit,
        quantity: parsed.data.quantity,
        estimatedMinutes: Math.max(1, unit * parsed.data.quantity),
        // Never claim more done than planned.
        doneCount: Math.min(task.doneCount, parsed.data.quantity),
      },
    });

    // The block is a different length now, so it needs re-placing. Started
    // work keeps its slot: there is tracked time against it.
    if (task.scheduledDate && !["IN_PROGRESS", "PAUSED", "DONE"].includes(task.status)) {
      await placeOnDay(updated.id, user.id, task.scheduledDate);
    }

    revalidatePath("/", "layout");
    revalidatePath("/plan");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

const Count = z.object({
  taskId: z.string().min(1),
  delta: z.coerce.number().int().min(-1).max(1),
});

/** The live counter: one more done, or one fewer if you miscounted. */
export async function countOne(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Count.safeParse({
      taskId: formData.get("taskId"),
      delta: formData.get("delta"),
    });
    if (!parsed.success) return { error: t("errors.couldNotCountThat") };

    const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId } });
    if (!task) return { error: t("errors.taskGone") };
    if (task.assigneeId !== user.id) return { error: t("errors.notYourTask") };

    const next = Math.max(0, task.doneCount + parsed.data.delta);

    await prisma.task.update({
      where: { id: task.id },
      data: {
        doneCount: next,
        // Doing more than planned is normal -- the day just reads as over.
        ...(next > task.quantity
          ? {
              quantity: next,
              estimatedMinutes: Math.max(
                1,
                (task.unitMinutes ??
                  Math.round(task.estimatedMinutes / Math.max(1, task.quantity))) *
                  next,
              ),
            }
          : {}),
      },
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotCount") };
  }
}
