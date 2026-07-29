"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { today, toDateOnly } from "@/lib/time";

/**
 * Meeting mode, started from My Day.
 *
 * A meeting used to be a pause with a reason typed into a box. Now it is the
 * meeting itself: notes get written while it happens and decisions become
 * tasks, so nothing depends on somebody writing it up afterwards.
 *
 * Two ways in:
 *   - starting a task that *is* a meeting (Reunion Semanal, Entrevista...)
 *   - being pulled into an unplanned one, which pauses whatever was running
 */

export type LiveState = { error?: string; ok?: boolean; meetingId?: string };

/** Everyone in the department, so the report says who was there. */
async function departmentAttendees(departmentId: string) {
  const people = await prisma.user.findMany({
    where: { departmentId, active: true },
    select: { id: true },
  });
  return people.map((p) => ({ id: p.id }));
}

export async function startMeetingForTask(
  _prev: LiveState,
  formData: FormData,
): Promise<LiveState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const taskId = String(formData.get("taskId") ?? "");

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { hostedMeeting: true },
    });
    if (!task) return { error: t("errors.taskGone") };
    if (task.assigneeId !== user.id) return { error: t("errors.notYourTask") };

    // Already minuting it -- just reopen.
    if (task.hostedMeeting) {
      return { ok: true, meetingId: task.hostedMeeting.id };
    }

    const meeting = await prisma.meeting.create({
      data: {
        title: task.title,
        date: toDateOnly(task.scheduledDate ?? task.dueDate),
        departmentId: task.departmentId,
        createdById: user.id,
        sourceTaskId: task.id,
        attendees: { connect: await departmentAttendees(task.departmentId) },
      },
    });

    revalidatePath("/my-day");
    return { ok: true, meetingId: meeting.id };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotOpenNotes"),
    };
  }
}

const AdHoc = z.object({
  title: z.string().trim().min(1, "errors.whatIsTheMeetingAbout"),
});

export async function startAdHocMeeting(
  _prev: LiveState,
  formData: FormData,
): Promise<LiveState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = AdHoc.safeParse({ title: formData.get("title") });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    // Being pulled into a meeting stops whatever was running. The reason
    // writes itself -- there is no point making somebody type "meeting".
    const running = await prisma.timeEntry.findFirst({
      where: { userId: user.id, endedAt: null },
      include: { pauses: { where: { resumedAt: null } } },
    });

    if (running && running.pauses.length === 0) {
      await prisma.$transaction([
        prisma.pauseEvent.create({
          data: {
            timeEntryId: running.id,
            reasonCode: "MEETING",
            reasonText: `In a meeting: ${parsed.data.title}`,
          },
        }),
        prisma.task.update({
          where: { id: running.taskId },
          data: { status: "PAUSED" },
        }),
      ]);
    }

    const meeting = await prisma.meeting.create({
      data: {
        title: parsed.data.title,
        date: today(),
        departmentId: user.departmentId,
        createdById: user.id,
        attendees: { connect: await departmentAttendees(user.departmentId) },
      },
    });

    revalidatePath("/my-day");
    return { ok: true, meetingId: meeting.id };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotStartIt"),
    };
  }
}

const Notes = z.object({
  meetingId: z.string().min(1),
  notes: z.string().max(20000),
});

/** Autosaved while the meeting runs, so nothing is lost if the tab closes. */
export async function saveLiveNotes(
  _prev: LiveState,
  formData: FormData,
): Promise<LiveState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Notes.safeParse({
      meetingId: formData.get("meetingId"),
      notes: formData.get("notes"),
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const meeting = await prisma.meeting.findUnique({
      where: { id: parsed.data.meetingId },
    });
    if (!meeting) return { error: t("errors.meetingGone") };
    if (meeting.status === "FINALISED") return { error: t("errors.alreadyClosed") };
    if (meeting.createdById !== user.id && user.role === "WORKER") {
      return { error: t("errors.onlyHostEditsNotes") };
    }

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { notes: parsed.data.notes },
    });
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

const Item = z.object({
  meetingId: z.string().min(1),
  title: z.string().trim().min(1, "errors.whatNeedsDoing"),
  estimatedMinutes: z.coerce.number().int().min(1).max(12 * 60),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.pickADueDate"),
  pinnedAssigneeId: z.string().optional(),
});

export async function addLiveActionItem(
  _prev: LiveState,
  formData: FormData,
): Promise<LiveState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Item.safeParse({
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
    if (meeting.status === "FINALISED") return { error: t("errors.alreadyClosed") };

    await prisma.actionItem.create({
      data: {
        meetingId: meeting.id,
        title: parsed.data.title,
        estimatedMinutes: parsed.data.estimatedMinutes,
        dueDate: toDateOnly(new Date(`${parsed.data.dueDate}T00:00:00Z`)),
        departmentId: meeting.departmentId ?? user.departmentId,
        pinnedAssigneeId: parsed.data.pinnedAssigneeId || null,
      },
    });

    revalidatePath("/my-day");
    return { ok: true, meetingId: meeting.id };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotAddIt") };
  }
}

export async function removeLiveActionItem(
  _prev: LiveState,
  formData: FormData,
): Promise<LiveState> {
  try {
    await requireUserOrThrow();
    const { t } = await getT();
    const id = String(formData.get("itemId") ?? "");
    const item = await prisma.actionItem.findUnique({
      where: { id },
      include: { meeting: true },
    });
    if (!item) return { error: t("errors.itemGone") };
    if (item.meeting.status === "FINALISED") {
      return { error: t("errors.meetingClosed") };
    }

    await prisma.actionItem.delete({ where: { id } });
    revalidatePath("/my-day");
    return { ok: true, meetingId: item.meetingId };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotRemove") };
  }
}

/**
 * Ending the meeting is the commit point: action items become real tasks.
 * Pinned ones go to the person named; the rest go to the pool, where the plan
 * board offers them and the engine assigns anything still spare.
 */
export async function endMeeting(
  _prev: LiveState,
  formData: FormData,
): Promise<LiveState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const meetingId = String(formData.get("meetingId") ?? "");

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { actionItems: true, sourceTask: true },
    });
    if (!meeting) return { error: t("errors.meetingGone") };
    if (meeting.status === "FINALISED") return { ok: true, meetingId };

    await prisma.$transaction(async (tx) => {
      for (const item of meeting.actionItems) {
        const task = await tx.task.create({
          data: {
            title: item.title,
            estimatedMinutes: item.estimatedMinutes,
            dueDate: item.dueDate,
            departmentId: item.departmentId,
            meetingId: meeting.id,
            origin: "MEETING",
            status: item.pinnedAssigneeId ? "ASSIGNED" : "UNASSIGNED",
            assigneeId: item.pinnedAssigneeId,
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

    // An unplanned meeting paused something; put the person back on it.
    if (!meeting.sourceTaskId) {
      const paused = await prisma.pauseEvent.findFirst({
        where: {
          resumedAt: null,
          reasonCode: "MEETING",
          timeEntry: { userId: user.id, endedAt: null },
        },
        include: { timeEntry: true },
      });
      if (paused) {
        await prisma.$transaction([
          prisma.pauseEvent.update({
            where: { id: paused.id },
            data: { resumedAt: new Date() },
          }),
          prisma.task.update({
            where: { id: paused.timeEntry.taskId },
            data: { status: "IN_PROGRESS" },
          }),
        ]);
      }
    }

    revalidatePath("/my-day");
    revalidatePath("/meetings");
    revalidatePath("/plan");
    return { ok: true, meetingId };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotCloseIt") };
  }
}
