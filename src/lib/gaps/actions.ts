"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { findSlot, type Window } from "@/lib/scheduling/availability";
import { claimTemplate } from "@/lib/plan/claim";
import { placeOnDay } from "@/lib/plan/place";
import { getNowState } from "@/lib/tasks/now-db";
import { nowMinutesIn } from "@/lib/tasks/pace";
import { scheduleZone, today, toDateOnly } from "@/lib/time";
import { openGap, type Gap } from "./gap";
import { isOfferable } from "./eligible";
import { fillerOffers, type Offer } from "./offer-db";

/**
 * Taking work for the time you have.
 *
 * Nothing here moves on its own -- the gap is offered, the person accepts, and
 * only then is anything written. What the person accepted, though, was worked
 * out when the dialog opened, and a colleague may have taken it since. So the
 * gap is recomputed and the fit re-checked at the moment of the click, and each
 * of the four paths writes through a guard that only one of two racing people
 * can pass. Same reasoning as the re-check in triage/actions.ts.
 */

export type FillerState = { error?: string; ok?: boolean };

const Take = z.object({
  taskId: z.string().optional(),
  templateId: z.string().optional(),
  source: z.enum(["unassigned", "orphaned", "pullForward", "spare"]),
  /** Set when the person said how long they have rather than the schedule. */
  minutes: z.coerce.number().int().min(1).max(12 * 60).optional(),
});

const Ask = z.object({
  minutes: z.coerce.number().int().min(1).max(12 * 60).optional(),
  excludeIds: z.array(z.string()).default([]),
});

/** Take the first `minutes` of working time out of a gap's stretches. */
function shrink(gap: Gap, minutes: number): Gap {
  const segments: Window[] = [];
  let left = minutes;
  for (const w of gap.segments) {
    if (left <= 0) break;
    const take = Math.min(left, w.end - w.start);
    segments.push({ start: w.start, end: w.start + take });
    left -= take;
  }
  const total = minutes - Math.max(0, left);
  return {
    start: gap.start,
    end: segments[segments.length - 1]?.end ?? gap.start,
    minutes: total,
    segments,
  };
}

/**
 * The gap as it stands right now, not as the browser last saw it.
 *
 * A person saying "I have forty minutes" knows something the schedule does
 * not, so their number is honoured -- but only downwards. They do not get to
 * extend their own shift, and the ordering rule still decides whether there is
 * a gap at all: offering work while something earlier is owed would be
 * offering something startTask() would refuse.
 */
async function liveGap(userId: string, minutes?: number): Promise<Gap | null> {
  const state = await getNowState(userId);
  const gap = openGap(
    state.windows,
    state.tasks,
    nowMinutesIn(scheduleZone()),
  );
  if (!gap || state.closed) return null;
  return minutes == null ? gap : shrink(gap, Math.min(minutes, gap.minutes));
}

/** What could fill the gap open right now. Read-only. */
export async function offerFillers(input: {
  minutes?: number;
  excludeIds?: string[];
}): Promise<{ gap: Gap | null; offers: Offer[] }> {
  const user = await requireUserOrThrow();
  // A nonsense duration means "just tell me what the schedule thinks", not an
  // exception thrown across the wire into a transition nobody is catching.
  const parsed = Ask.safeParse(input);
  const ask = parsed.success ? parsed.data : { minutes: undefined, excludeIds: [] };

  const gap = await liveGap(user.id, ask.minutes);
  if (!gap) return { gap: null, offers: [] };

  const offers = await fillerOffers(
    user.id,
    user.departmentId,
    gap,
    today(),
    ask.excludeIds,
  );
  return { gap, offers };
}

function revalidate() {
  revalidatePath("/my-day");
  revalidatePath("/plan");
  revalidatePath("/triage");
}

export async function takeFiller(
  _prev: FillerState,
  formData: FormData,
): Promise<FillerState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();

    const parsed = Take.safeParse({
      taskId: formData.get("taskId") || undefined,
      templateId: formData.get("templateId") || undefined,
      source: formData.get("source"),
      minutes: formData.get("minutes") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const gap = await liveGap(user.id, parsed.data.minutes);
    if (!gap) return { error: t("errors.gapGone") };

    const day = toDateOnly(today());

    // --------------------------------------------- spare-time catalogue work
    if (parsed.data.source === "spare") {
      if (!parsed.data.templateId) return { error: t("errors.nothingToAdd") };

      const template = await prisma.taskTemplate.findUnique({
        where: { id: parsed.data.templateId },
        select: {
          estimatedMinutes: true,
          isMeeting: true,
          recurringRules: {
            where: { active: true, fixedStartMinutes: { not: null } },
            select: { fixedStartMinutes: true },
            take: 1,
          },
        },
      });
      if (!template) return { error: t("errors.notInCatalogue") };
      if (template.isMeeting || template.recurringRules.length > 0) {
        return { error: t("errors.notForFreeTime") };
      }
      if (!findSlot(gap.segments, template.estimatedMinutes)) {
        return { error: t("errors.noLongerFits") };
      }

      const claim = await claimTemplate(
        parsed.data.templateId,
        user.id,
        user.departmentId,
        day,
      );
      if (claim.outcome === "taken") {
        return {
          error: claim.by
            ? t("errors.tookItFirst", claim.by)
            : t("errors.somebodyTookIt"),
        };
      }

      await placeOnDay(claim.taskId, user.id, day, gap.start);
      revalidate();
      return { ok: true };
    }

    // ------------------------------------------------------ an existing task
    if (!parsed.data.taskId) return { error: t("errors.nothingToAdd") };

    const task = await prisma.task.findUnique({
      where: { id: parsed.data.taskId },
      include: {
        followsTask: { select: { status: true } },
        template: {
          select: {
            isMeeting: true,
            recurringRules: {
              where: { active: true, fixedStartMinutes: { not: null } },
              select: { fixedStartMinutes: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!task) return { error: t("errors.taskGone") };
    if (task.departmentId !== user.departmentId) {
      return { error: t("errors.taskOtherDepartment") };
    }

    /**
     * The dialog may have been open a while, and a task can acquire an anchor
     * or slip past its day in the meantime. Checked with the same function the
     * pools use, so a stale offer cannot smuggle in work that belongs to a
     * particular hour.
     */
    if (
      !isOfferable(
        {
          anchor: task.anchor,
          isMeeting: task.template?.isMeeting ?? false,
          hasFixedTime: (task.template?.recurringRules.length ?? 0) > 0,
          origin: task.origin,
          dueDate: task.dueDate,
          waitingOnLeader:
            task.followsTask != null && task.followsTask.status !== "DONE",
          shiftHalf: task.shiftHalf,
        },
        parsed.data.source,
        day,
        gap,
      )
    ) {
      return { error: t("errors.notForFreeTime") };
    }

    // What is left of it, which for a part-done repeatable is not the estimate.
    const minutes =
      task.unitMinutes != null && task.quantity > 1
        ? Math.max(0, task.quantity - task.doneCount) * task.unitMinutes
        : task.estimatedMinutes;
    if (!findSlot(gap.segments, minutes)) {
      return { error: t("errors.noLongerFits") };
    }

    if (parsed.data.source === "unassigned") {
      /**
       * Two shapes of the same tier: work nobody has, and work that is mine
       * already but that the engine never found a slot for. The guard differs
       * -- one is "still going spare", the other "still mine and still
       * unplaced" -- but either way losing it means somebody got there first.
       */
      const { count } = task.assigneeId
        ? await prisma.task.updateMany({
            where: {
              id: task.id,
              assigneeId: user.id,
              scheduledStart: null,
              status: "ASSIGNED",
            },
            data: { scheduledDate: day },
          })
        : await prisma.task.updateMany({
            where: { id: task.id, assigneeId: null },
            data: {
              assigneeId: user.id,
              status: "ASSIGNED",
              scheduledDate: day,
            },
          });
      if (count === 0) return { error: t("errors.somebodyTookIt") };
    }

    if (parsed.data.source === "orphaned") {
      /**
       * An orphan leaving the queue without a manager touching it is new, so
       * it still gets a TriageAction. The queue is how a manager knows work
       * was dropped; it must also be how they know it was picked back up.
       */
      const { count } = await prisma.task.updateMany({
        where: { id: task.id, status: "ORPHANED" },
        data: {
          assigneeId: user.id,
          status: "ASSIGNED",
          scheduledDate: day,
          orphanedAt: null,
          orphanReason: null,
        },
      });
      if (count === 0) return { error: t("errors.noLongerInTriage") };

      await prisma.triageAction.create({
        data: {
          taskId: task.id,
          resolvedById: user.id,
          resolution: "REASSIGNED",
          detail: "self-served from a gap",
        },
      });
    }

    if (parsed.data.source === "pullForward") {
      if (task.assigneeId !== user.id) return { error: t("errors.notYourTask") };

      const { count } = await prisma.task.updateMany({
        where: { id: task.id, assigneeId: user.id, status: "ASSIGNED" },
        data: { scheduledDate: day },
      });
      if (count === 0) return { error: t("errors.taskUnavailable") };

      /**
       * The due date does not move: the commitment has not changed, only when
       * it is being done. Recorded all the same, so "why is this not on
       * Thursday any more" has an answer -- the same record a slip writes,
       * pointing the other way.
       */
      if (task.scheduledDate) {
        await prisma.taskDeferral.create({
          data: {
            taskId: task.id,
            userId: user.id,
            reason: "gap-fill",
            fromDate: task.scheduledDate,
            toDate: day,
          },
        });
      }
    }

    await placeOnDay(task.id, user.id, day, gap.start);
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSaveThat") };
  }
}
