"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { parseClock, today } from "@/lib/time";
import { atMinutes } from "./attendance";
import {
  closeDay,
  correctDay,
  endBreak,
  markArrival,
  startBreak,
} from "./attendance-db";

export type AttendanceState = {
  error?: string;
  ok?: boolean;
  /** How much was still unfinished when the day was closed. */
  leftUnfinished?: number;
};

/**
 * "Cerrar el día".
 *
 * Stops the clock and closes the record. Deliberately does not touch the
 * tasks: whatever is left is rescheduled by the dialog through deferTask, so
 * nothing is ever quietly marked as done on somebody's behalf.
 */
export async function endDay(
  _prev: AttendanceState,
  _formData: FormData,
): Promise<AttendanceState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();

    const result = await closeDay(user.id);
    if (!result.closed) return { error: t("errors.noDayToClose") };

    revalidatePath("/", "layout");
    revalidatePath("/me");
    return { ok: true, leftUnfinished: result.leftUnfinished };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotCloseDay") };
  }
}

/**
 * Going to lunch, and coming back from it.
 *
 * Two halves of the same gesture, so the bar can be one button that changes
 * its mind. Neither ever fails loudly: attendance observes the work and must
 * never be the thing that stops it.
 */
export async function startLunch(
  _prev: AttendanceState,
  _formData: FormData,
): Promise<AttendanceState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();

    const result = await startBreak(user.id);
    if (!result.started) return { error: t("errors.alreadyAtLunch") };

    revalidatePath("/", "layout");
    revalidatePath("/me");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

export async function endLunch(
  _prev: AttendanceState,
  _formData: FormData,
): Promise<AttendanceState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();

    const result = await endBreak(user.id);
    if (!result.ended) return { error: t("errors.notAtLunch") };

    revalidatePath("/", "layout");
    revalidatePath("/me");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

/** Changed their mind, or came back to one more job. */
export async function reopenDay(
  _prev: AttendanceState,
  _formData: FormData,
): Promise<AttendanceState> {
  try {
    const user = await requireUserOrThrow();
    // Reusing markArrival keeps one definition of "back at work": it clears
    // the end and returns the day to OPEN.
    await markArrival(user.id, "TASK_START");

    revalidatePath("/", "layout");
    revalidatePath("/me");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

const Correction = z.object({
  dayId: z.string().min(1),
  // Empty means "the guess was right", which is a real answer and not a
  // validation failure.
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "errors.notATime")
    .optional()
    .or(z.literal("")),
});

/**
 * Confirming or correcting a day the sweep guessed at.
 *
 * Either way it stops being marked NEEDS_REVIEW -- the point of the flag is
 * that somebody has not looked at it yet, not that it is wrong.
 */
export async function confirmDay(
  _prev: AttendanceState,
  formData: FormData,
): Promise<AttendanceState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();

    const parsed = Correction.safeParse({
      dayId: formData.get("dayId"),
      endTime: formData.get("endTime") ?? "",
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const { prisma } = await import("@/lib/db");
    const day = await prisma.attendanceDay.findUnique({
      where: { id: parsed.data.dayId },
    });
    if (!day || day.userId !== user.id) return { error: t("errors.itemGone") };

    const endedAt = parsed.data.endTime
      ? atMinutes(day.date, parseClock(parsed.data.endTime))
      : null;

    await correctDay(user.id, parsed.data.dayId, endedAt);

    revalidatePath("/", "layout");
    revalidatePath("/me");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

/** The date to offer as "tomorrow" when rescheduling leftovers. */
export async function tomorrowKey(): Promise<string> {
  const t = today();
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
