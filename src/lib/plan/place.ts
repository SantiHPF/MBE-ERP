import { prisma } from "@/lib/db";
import { toDateOnly } from "@/lib/time";
import {
  anchorPacksBackward,
  computeAvailability,
  findLastSlot,
  findSlot,
  resolveAnchor,
  subtractWindows,
} from "@/lib/scheduling/availability";
import {
  anchorFallbackWindows,
  halfWindows,
  intersect,
} from "@/lib/scheduling/half";

/**
 * Give a task a time slot on the day somebody just took it.
 *
 * Without this a planned task is assigned but unplaced, and My Day -- which
 * reads scheduled slots -- would not show it until the next scheduling run.
 * "I planned it and it vanished" is not a defensible thing for the app to do.
 *
 * Going over capacity is allowed on purpose: people know things the system
 * does not. When nothing fits, the task keeps its owner and simply has no
 * slot, and the day shows as over.
 */
export async function placeOnDay(
  taskId: string,
  userId: string,
  date: Date,
  /** Earliest acceptable start, for work pushed later in the same day. */
  notBefore = 0,
): Promise<{ placed: boolean }> {
  const day = toDateOnly(date);

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      template: {
        select: { recurringRules: { select: { fixedStartMinutes: true } } },
      },
    },
  });
  if (!task) return { placed: false };

  const [patterns, overrides, absences, sameDay] = await Promise.all([
    prisma.workingPattern.findMany({ where: { userId } }),
    prisma.dayOverride.findMany({ where: { userId, date: day } }),
    prisma.absence.findMany({
      where: { userId, startDate: { lte: day }, endDate: { gte: day } },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: userId,
        scheduledDate: day,
        id: { not: taskId },
        status: { notIn: ["CANCELLED"] },
      },
      select: { scheduledStart: true, scheduledEnd: true },
    }),
  ]);

  const availability = computeAvailability({ date: day, patterns, overrides, absences });

  /**
   * A task that belongs somewhere particular in the day keeps that place here
   * too. Without this, claiming "Sucesos at 09:00" from the plan board dropped
   * it wherever there happened to be room, which is not what the catalogue says.
   *
   * The task's own anchor wins over the rule's fixed time: an anchored task
   * belongs at a point in *this person's* shift, which the rule cannot know.
   * Resolved against the full day, not the free time left in it, so "before
   * leaving" still means the end of the shift.
   */
  const pinnedStart = task.anchor
    ? resolveAnchor(task.anchor, availability.windows, task.estimatedMinutes)
    : (task.template?.recurringRules[0]?.fixedStartMinutes ?? null);

  // Carve out what is already booked, so the new task lands after it.
  let free = subtractWindows(
    availability.windows,
    sameDay
      .filter((o) => o.scheduledStart != null && o.scheduledEnd != null)
      .map((o) => ({ start: o.scheduledStart!, end: o.scheduledEnd! })),
  );

  /**
   * An anchor bounds the task to its half of the day, not merely to a starting
   * point: findSlot walks into later windows when the one it starts in is
   * full, which is how "antes del descanso" used to land after the break. A
   * shift preference does the same job for work with no anchor; the anchor
   * wins when both are set, being the more specific statement.
   *
   * Kept in step with allowedFree() in assign.ts, so a deferral or a manual
   * reorder cannot undo what the engine deliberately arranged.
   */
  if (task.anchor) {
    free = intersect(free, anchorFallbackWindows(availability.windows, task.anchor));
  } else if (task.shiftHalf) {
    free = intersect(free, halfWindows(availability.windows, task.shiftHalf));
  }

  /**
   * A deadline anchor searches from the end of its half rather than the start.
   *
   * Kept in step with placeFor() in assign.ts. Without it, claiming a second
   * "antes del descanso" from the plan board found 13:30 taken and first-fit
   * it to 10:00 -- the engine and the board would then disagree about the
   * same task, which is worse than either rule on its own.
   */
  let slot: ReturnType<typeof findSlot>;

  if (task.anchor && anchorPacksBackward(task.anchor)) {
    slot = findLastSlot(free, task.estimatedMinutes, Infinity, notBefore);
  } else {
    const earliest = Math.max(notBefore, pinnedStart ?? 0);
    slot = findSlot(free, task.estimatedMinutes, earliest);

    // If its hour has already gone, fall back -- still within the same bound.
    if (!slot && pinnedStart != null) {
      slot = findSlot(free, task.estimatedMinutes, notBefore);
    }
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      scheduledDate: day,
      scheduledStart: slot?.start ?? null,
      scheduledEnd: slot?.end ?? null,
    },
  });

  return { placed: slot !== null };
}
