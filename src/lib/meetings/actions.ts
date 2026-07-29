"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { toDateOnly } from "@/lib/time";

/**
 * A meeting is a draft until it is finalised. Action items create nothing
 * while it is a draft, so an abandoned meeting leaves no phantom tasks --
 * finalising is the single commit point.
 */

export type MeetingState = { error?: string; ok?: boolean };

const NewMeeting = z.object({
  title: z.string().trim().min(1, "errors.giveMeetingATitle"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.pickADate"),
});

export async function createMeeting(
  _prev: MeetingState,
  formData: FormData,
): Promise<MeetingState> {
  let id: string;
  try {
    const user = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const parsed = NewMeeting.safeParse({
      title: formData.get("title"),
      date: formData.get("date"),
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const meeting = await prisma.meeting.create({
      data: {
        title: parsed.data.title,
        date: toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`)),
        departmentId: user.departmentId,
        createdById: user.id,
        // Everyone in the department is an attendee by default; it is easier
        // to remove the one person who missed it than to add the other eight.
        attendees: {
          connect: (
            await prisma.user.findMany({
              where: { departmentId: user.departmentId, active: true },
              select: { id: true },
            })
          ).map((u) => ({ id: u.id })),
        },
      },
    });
    id = meeting.id;
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotCreateIt"),
    };
  }

  redirect(`/meetings/${id}`);
}

export async function saveNotes(
  _prev: MeetingState,
  formData: FormData,
): Promise<MeetingState> {
  try {
    const user = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const meetingId = String(formData.get("meetingId") ?? "");
    const notes = String(formData.get("notes") ?? "");

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return { error: t("errors.meetingGone") };
    if (meeting.status === "FINALISED") {
      return { error: t("errors.notesLocked") };
    }
    if (meeting.departmentId !== user.departmentId && user.role !== "ADMIN") {
      return { error: t("errors.meetingOtherDepartment") };
    }

    await prisma.meeting.update({ where: { id: meetingId }, data: { notes } });
    revalidatePath(`/meetings/${meetingId}`);
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

const NewItem = z.object({
  meetingId: z.string().min(1),
  title: z.string().trim().min(1, "errors.whatNeedsDoing"),
  // No catalogue entry to inherit from, so this is always entered by hand.
  estimatedMinutes: z.coerce
    .number()
    .int()
    // The catalogue has tasks as short as 2 minutes, so no artificial floor.
    .min(1, "errors.howLong")
    .max(12 * 60, "errors.longerThanADay"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.pickADueDate"),
  pinnedAssigneeId: z.string().optional(),
});

export async function addActionItem(
  _prev: MeetingState,
  formData: FormData,
): Promise<MeetingState> {
  try {
    const user = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const parsed = NewItem.safeParse({
      meetingId: formData.get("meetingId"),
      title: formData.get("title"),
      estimatedMinutes: formData.get("estimatedMinutes"),
      dueDate: formData.get("dueDate"),
      pinnedAssigneeId: formData.get("pinnedAssigneeId") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const meeting = await prisma.meeting.findUnique({
      where: { id: parsed.data.meetingId },
    });
    if (!meeting) return { error: t("errors.meetingGone") };
    if (meeting.status === "FINALISED") {
      return { error: t("errors.addTaskDirectly") };
    }

    await prisma.actionItem.create({
      data: {
        meetingId: parsed.data.meetingId,
        title: parsed.data.title,
        estimatedMinutes: parsed.data.estimatedMinutes,
        dueDate: toDateOnly(new Date(`${parsed.data.dueDate}T00:00:00Z`)),
        departmentId: meeting.departmentId ?? user.departmentId,
        pinnedAssigneeId: parsed.data.pinnedAssigneeId || null,
      },
    });

    revalidatePath(`/meetings/${parsed.data.meetingId}`);
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotAddIt") };
  }
}

export async function removeActionItem(
  _prev: MeetingState,
  formData: FormData,
): Promise<MeetingState> {
  try {
    await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const id = String(formData.get("itemId") ?? "");

    const item = await prisma.actionItem.findUnique({
      where: { id },
      include: { meeting: true },
    });
    if (!item) return { error: t("errors.itemGone") };
    if (item.meeting.status === "FINALISED") {
      return { error: t("errors.cancelTaskInstead") };
    }

    await prisma.actionItem.delete({ where: { id } });
    revalidatePath(`/meetings/${item.meetingId}`);
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotRemove") };
  }
}

/**
 * The commit point. Every action item becomes a real task, linked back to the
 * item it came from. Pinned items keep their person; the rest go through the
 * engine's one-off fairness fallback on the next scheduling run.
 */
export async function finaliseMeeting(
  _prev: MeetingState,
  formData: FormData,
): Promise<MeetingState> {
  try {
    const user = await requireUserOrThrow("MANAGER");
    const { t } = await getT();
    const meetingId = String(formData.get("meetingId") ?? "");

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { actionItems: true },
    });
    if (!meeting) return { error: t("errors.meetingGone") };
    if (meeting.status === "FINALISED") {
      return { error: t("errors.alreadyFinalised") };
    }
    if (meeting.actionItems.length === 0) {
      return {
        error: t("errors.nothingDecided"),
      };
    }

    await prisma.$transaction(async (tx) => {
      for (const item of meeting.actionItems) {
        const task = await tx.task.create({
          data: {
            title: item.title,
            description: item.description,
            estimatedMinutes: item.estimatedMinutes,
            dueDate: item.dueDate,
            departmentId: item.departmentId,
            meetingId: meeting.id,
            origin: "MEETING",
            status: "UNASSIGNED",
            externalKey: `meeting-item:${item.id}`,
          },
        });
        await tx.actionItem.update({
          where: { id: item.id },
          data: { taskId: task.id },
        });
      }

      await tx.meeting.update({
        where: { id: meeting.id },
        data: { status: "FINALISED", finalisedAt: new Date() },
      });
    });

    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/meetings");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not finalise",
    };
  }
}
