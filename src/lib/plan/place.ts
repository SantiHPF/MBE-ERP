import { prisma } from "@/lib/db";
import { toDateOnly } from "@/lib/time";
import {
  computeAvailability,
  findSlot,
  resolveAnchor,
} from "@/lib/scheduling/availability";

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
  let free = availability.windows;
  for (const other of sameDay) {
    if (other.scheduledStart == null || other.scheduledEnd == null) continue;
    const next: typeof free = [];
    for (const w of free) {
      if (other.scheduledEnd <= w.start || other.scheduledStart >= w.end) {
        next.push(w);
        continue;
      }
      if (other.scheduledStart > w.start) {
        next.push({ start: w.start, end: other.scheduledStart });
      }
      if (other.scheduledEnd < w.end) {
        next.push({ start: other.scheduledEnd, end: w.end });
      }
    }
    free = next;
  }

  const earliest = Math.max(notBefore, pinnedStart ?? 0);
  let slot = findSlot(free, task.estimatedMinutes, earliest);

  // If its hour has already gone, fall back to anywhere that still fits
  // rather than refusing to place it at all.
  if (!slot && pinnedStart != null) {
    slot = findSlot(free, task.estimatedMinutes, notBefore);
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
