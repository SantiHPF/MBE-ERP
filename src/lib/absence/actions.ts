"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { slotOverlapsAbsence } from "@/lib/scheduling/availability";
import { isEffective } from "./effective";
import { eachDay, parseClock, toDateOnly } from "@/lib/time";

/**
 * Recording an absence does exactly two things, and deliberately no more:
 *
 *   1. Capacity for the covered dates drops, so future scheduling runs skip
 *      the person automatically.
 *   2. Work already scheduled inside the missing hours is marked ORPHANED.
 *
 * Nothing is reassigned or pushed. A manager decides each one -- that was an
 * explicit product decision, not an omission.
 */

const AbsenceInput = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
    scope: z.enum(["FULL_DAY", "PARTIAL"]),
    category: z.enum(["SICK", "HOLIDAY", "PERSONAL", "OTHER"]),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    note: z.string().trim().max(500).optional(),
    userId: z.string().optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "The end date cannot be before the start date",
  })
  .refine(
    (v) => v.scope === "FULL_DAY" || (v.startTime && v.endTime),
    { message: "Give the hours you will be away" },
  );

export type AbsenceState = { error?: string; ok?: boolean; orphaned?: number };

export async function recordAbsence(
  _prev: AbsenceState,
  formData: FormData,
): Promise<AbsenceState> {
  try {
    const actor = await requireUserOrThrow();

    const parsed = AbsenceInput.safeParse({
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      scope: formData.get("scope"),
      category: formData.get("category"),
      startTime: formData.get("startTime") || undefined,
      endTime: formData.get("endTime") || undefined,
      note: formData.get("note") || undefined,
      userId: formData.get("userId") || undefined,
    });

    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const input = parsed.data;

    // Workers may only record their own; managers may record for their team.
    const subjectId = input.userId ?? actor.id;
    if (subjectId !== actor.id) {
      const subject = await prisma.user.findUnique({ where: { id: subjectId } });
      if (!subject) return { error: "That person no longer exists" };
      if (
        actor.role === "WORKER" ||
        (actor.role === "MANAGER" && subject.departmentId !== actor.departmentId)
      ) {
        return { error: "You cannot record an absence for that person" };
      }
    }

    const startDate = toDateOnly(new Date(`${input.startDate}T00:00:00Z`));
    const endDate = toDateOnly(new Date(`${input.endDate}T00:00:00Z`));

    const startMinutes =
      input.scope === "PARTIAL" && input.startTime
        ? parseClock(input.startTime)
        : null;
    const endMinutes =
      input.scope === "PARTIAL" && input.endTime ? parseClock(input.endTime) : null;

    if (
      startMinutes != null &&
      endMinutes != null &&
      endMinutes <= startMinutes
    ) {
      return { error: "The end time must be after the start time" };
    }

    // Everything starts as a request for HR. Sickness still takes effect
    // straight away -- see isEffective() -- so the schedule is never wrong
    // about who is actually at work.
    await prisma.absence.create({
      data: {
        userId: subjectId,
        startDate,
        endDate,
        scope: input.scope,
        startMinutes,
        endMinutes,
        category: input.category,
        note: input.note,
        createdById: actor.id,
        status: "PENDING",
      },
    });

    const orphaned = isEffective({ category: input.category, status: "PENDING" })
      ? await orphanAffectedTasks(subjectId, {
          startDate,
          endDate,
          scope: input.scope,
          startMinutes,
          endMinutes,
          category: input.category,
          status: "PENDING",
        })
      : 0;

    revalidatePath("/my-calendar");
    revalidatePath("/my-day");
    revalidatePath("/team");
    revalidatePath("/triage");

    return { ok: true, orphaned };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not record the absence",
    };
  }
}

/**
 * Flag the work that the absence just made impossible. Only tasks whose
 * scheduled slot actually overlaps the missing hours are touched, so an
 * afternoon absence leaves the morning's work alone. Finished tasks are left
 * as they are -- they already happened.
 */
export async function orphanAffectedTasks(
  userId: string,
  absence: {
    startDate: Date;
    endDate: Date;
    scope: "FULL_DAY" | "PARTIAL";
    startMinutes: number | null;
    endMinutes: number | null;
    category?: "SICK" | "HOLIDAY" | "PERSONAL" | "OTHER";
    status?: "PENDING" | "APPROVED" | "REJECTED";
  },
): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      scheduledDate: { gte: absence.startDate, lte: absence.endDate },
      status: { in: ["ASSIGNED", "IN_PROGRESS", "PAUSED"] },
    },
  });

  const reasonFor = (category: string) =>
    `Assignee away (${category.toLowerCase()})`;

  const affected = tasks.filter((task) => {
    if (!task.scheduledDate) return false;
    return slotOverlapsAbsence(
      { start: task.scheduledStart ?? 0, end: task.scheduledEnd ?? 24 * 60 },
      absence,
      task.scheduledDate,
    );
  });

  if (affected.length === 0) return 0;

  await prisma.task.updateMany({
    where: { id: { in: affected.map((t) => t.id) } },
    data: {
      status: "ORPHANED",
      orphanedAt: new Date(),
      orphanReason: reasonFor(absence.scope === "FULL_DAY" ? "away" : "partly away"),
    },
  });

  return affected.length;
}

const EditInput = z
  .object({
    absenceId: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
    scope: z.enum(["FULL_DAY", "PARTIAL"]),
    category: z.enum(["SICK", "HOLIDAY", "PERSONAL", "OTHER"]),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "The end date cannot be before the start date",
  })
  .refine((v) => v.scope === "FULL_DAY" || (v.startTime && v.endTime), {
    message: "Give the hours you will be away",
  });

/** Who may touch this request at all. */
async function absenceForEdit(absenceId: string, actor: { id: string; role: string; departmentId: string }) {
  const absence = await prisma.absence.findUnique({
    where: { id: absenceId },
    include: { user: { select: { departmentId: true } } },
  });
  if (!absence) throw new Error("That request no longer exists");

  const isOwn = absence.userId === actor.id;
  const isHr = actor.role === "HR" || actor.role === "ADMIN";
  const isTheirManager =
    actor.role === "MANAGER" && absence.user.departmentId === actor.departmentId;

  if (!isOwn && !isHr && !isTheirManager) {
    throw new Error("That is not yours to change");
  }

  // Once HR has decided, changing it is HR's call -- otherwise somebody could
  // quietly rewrite an approved holiday into something else.
  if (absence.status !== "PENDING" && !isHr) {
    throw new Error("HR has already decided this one — ask them to change it");
  }

  return absence;
}

/**
 * Change a request. Editing anything about the dates or hours sends it back
 * to HR, because the thing they approved is no longer the thing on record.
 */
export async function updateAbsence(
  _prev: AbsenceState,
  formData: FormData,
): Promise<AbsenceState> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = EditInput.safeParse({
      absenceId: formData.get("absenceId"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      scope: formData.get("scope"),
      category: formData.get("category"),
      startTime: formData.get("startTime") || undefined,
      endTime: formData.get("endTime") || undefined,
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const absence = await absenceForEdit(parsed.data.absenceId, actor);
    const input = parsed.data;

    const startDate = toDateOnly(new Date(`${input.startDate}T00:00:00Z`));
    const endDate = toDateOnly(new Date(`${input.endDate}T00:00:00Z`));
    const startMinutes =
      input.scope === "PARTIAL" && input.startTime ? parseClock(input.startTime) : null;
    const endMinutes =
      input.scope === "PARTIAL" && input.endTime ? parseClock(input.endTime) : null;

    if (startMinutes != null && endMinutes != null && endMinutes <= startMinutes) {
      return { error: "The end time must be after the start time" };
    }

    // Hand back work the old dates had flagged; the new dates re-flag below.
    await releaseOrphans(absence.userId, absence.startDate, absence.endDate);

    await prisma.absence.update({
      where: { id: absence.id },
      data: {
        startDate,
        endDate,
        scope: input.scope,
        startMinutes,
        endMinutes,
        category: input.category,
        note: input.note,
        status: "PENDING",
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
      },
    });

    const orphaned = isEffective({ category: input.category, status: "PENDING" })
      ? await orphanAffectedTasks(absence.userId, {
          startDate,
          endDate,
          scope: input.scope,
          startMinutes,
          endMinutes,
          category: input.category,
          status: "PENDING",
        })
      : 0;

    revalidateAll();
    return { ok: true, orphaned };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not change it",
    };
  }
}

/** Give back anything this absence had taken out of somebody's day. */
async function releaseOrphans(userId: string, from: Date, to: Date) {
  await prisma.task.updateMany({
    where: {
      assigneeId: userId,
      status: "ORPHANED",
      scheduledDate: { in: eachDay(from, to) },
    },
    data: { status: "ASSIGNED", orphanedAt: null, orphanReason: null },
  });
}

function revalidateAll() {
  revalidatePath("/my-calendar");
  revalidatePath("/my-day");
  revalidatePath("/team");
  revalidatePath("/triage");
  revalidatePath("/hr/absences");
}

export async function cancelAbsence(
  _prev: AbsenceState,
  formData: FormData,
): Promise<AbsenceState> {
  try {
    const actor = await requireUserOrThrow();
    const absence = await absenceForEdit(
      String(formData.get("absenceId") ?? ""),
      actor,
    );

    await prisma.absence.delete({ where: { id: absence.id } });

    // Give back any task still orphaned by it, so withdrawing a mistaken sick
    // day does not leave the work stranded in triage.
    await releaseOrphans(absence.userId, absence.startDate, absence.endDate);

    revalidateAll();
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not cancel",
    };
  }
}
