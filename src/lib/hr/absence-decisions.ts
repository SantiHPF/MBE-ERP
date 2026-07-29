"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText, fail } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { canDecideAbsences } from "@/lib/auth/guards";
import { orphanAffectedTasks } from "@/lib/absence/actions";
import { isEffective } from "@/lib/absence/effective";
import { eachDay } from "@/lib/time";

/**
 * HR's decision on an absence request.
 *
 * Approving matters most for holiday and personal leave, which do nothing
 * until somebody signs them off -- approval is the moment their work gets
 * flagged. Sickness was already in effect, so approving it changes only the
 * record; rejecting it is what puts the person back on the schedule.
 */

export type DecisionState = { error?: string; ok?: boolean; orphaned?: number };

const Decision = z.object({
  absenceId: z.string().min(1),
  note: z.string().trim().max(500).optional(),
});

async function loadForDecision(absenceId: string) {
  const absence = await prisma.absence.findUnique({ where: { id: absenceId } });
  if (!absence) fail("errors.requestGone");
  if (absence.status !== "PENDING") {
    fail("errors.alreadyDecided");
  }
  return absence;
}

export async function approveAbsence(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  try {
    const actor = await requireUserOrThrow();
    const { t } = await getT();
    if (!canDecideAbsences(actor)) {
      return { error: t("errors.onlyHrDecides") };
    }

    const parsed = Decision.safeParse({
      absenceId: formData.get("absenceId"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const absence = await loadForDecision(parsed.data.absenceId);
    const wasAlreadyCounting = isEffective(absence);

    await prisma.absence.update({
      where: { id: absence.id },
      data: {
        status: "APPROVED",
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: parsed.data.note,
      },
    });

    // Sickness was already flagged when it was reported. Leave was not, so
    // this is the point its work needs rehoming.
    const orphaned = wasAlreadyCounting
      ? 0
      : await orphanAffectedTasks(absence.userId, {
          startDate: absence.startDate,
          endDate: absence.endDate,
          scope: absence.scope,
          startMinutes: absence.startMinutes,
          endMinutes: absence.endMinutes,
          category: absence.category,
          status: "APPROVED",
        });

    revalidateEverything();
    return { ok: true, orphaned };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotApprove"),
    };
  }
}

export async function rejectAbsence(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  try {
    const actor = await requireUserOrThrow();
    const { t } = await getT();
    if (!canDecideAbsences(actor)) {
      return { error: t("errors.onlyHrDecides") };
    }

    const parsed = Decision.safeParse({
      absenceId: formData.get("absenceId"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    // Rejecting somebody's sick day is a consequential thing to do silently,
    // so it needs a written reason.
    if (!parsed.data.note) {
      return { error: t("errors.giveAReason") };
    }

    const absence = await loadForDecision(parsed.data.absenceId);
    const wasCounting = isEffective(absence);

    await prisma.absence.update({
      where: { id: absence.id },
      data: {
        status: "REJECTED",
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: parsed.data.note,
      },
    });

    // A rejected sick day means they are expected in after all, so hand back
    // any work that was flagged because of it.
    if (wasCounting) {
      await prisma.task.updateMany({
        where: {
          assigneeId: absence.userId,
          status: "ORPHANED",
          scheduledDate: { in: eachDay(absence.startDate, absence.endDate) },
        },
        data: { status: "ASSIGNED", orphanedAt: null, orphanReason: null },
      });
    }

    revalidateEverything();
    return { ok: true };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotReject"),
    };
  }
}

function revalidateEverything() {
  revalidatePath("/hr/absences");
  revalidatePath("/my-calendar");
  revalidatePath("/my-day");
  revalidatePath("/team");
  revalidatePath("/triage");
}
