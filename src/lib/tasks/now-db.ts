import { prisma } from "@/lib/db";
import { today, toDateOnly } from "@/lib/time";
import { computeAvailability } from "@/lib/scheduling/availability";
import { elapsedSeconds } from "./elapsed";
import type { DayTask } from "./day";
import { currentTask, type NowState } from "./now";

/**
 * The bar's own query: availability, today's tasks, the attendance row.
 *
 * Five queries rather than getDayView's nine, because it runs on every page
 * in the app rather than once on My Day.
 */
export async function getNowState(
  userId: string,
  date: Date = today(),
): Promise<NowState> {
  const day = toDateOnly(date);

  const [patterns, overrides, absences, tasks, attendance] = await Promise.all([
    prisma.workingPattern.findMany({ where: { userId } }),
    prisma.dayOverride.findMany({ where: { userId, date: day } }),
    prisma.absence.findMany({
      where: { userId, startDate: { lte: day }, endDate: { gte: day } },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: userId,
        scheduledDate: day,
        status: { notIn: ["CANCELLED"] },
      },
      include: {
        timeEntries: { include: { pauses: true }, orderBy: { startedAt: "asc" } },
        template: {
          select: {
            notes: true,
            instructions: true,
            isMeeting: true,
            repeatable: true,
            estimatedMinutes: true,
          },
        },
        hostedMeeting: { select: { id: true, status: true } },
      },
      orderBy: [{ scheduledStart: "asc" }, { title: "asc" }],
    }),
    prisma.attendanceDay.findUnique({
      where: { userId_date: { userId, date: day } },
    }),
  ]);

  const availability = computeAvailability({
    date: day,
    patterns,
    overrides,
    absences,
  });

  const now = new Date();

  const dayTasks: DayTask[] = tasks.map((task) => {
    const openPause = task.timeEntries
      .flatMap((e) => e.pauses)
      .find((p) => p.resumedAt === null);
    const openEntry = task.timeEntries.find((e) => e.endedAt === null);

    return {
      id: task.id,
      title: task.title,
      origin: task.origin,
      status: task.status,
      estimatedMinutes: task.estimatedMinutes,
      scheduledStart: task.scheduledStart,
      scheduledEnd: task.scheduledEnd,
      elapsedSeconds: elapsedSeconds(task.timeEntries, now),
      /**
       * The instant the clock started, not a count of seconds.
       *
       * A number goes stale the moment it is rendered, and the bar can sit on
       * a page for an hour without the layout re-rendering. From the instant,
       * the stopwatch and the pace stay right on their own.
       */
      runningSince: openEntry && !openPause ? openEntry.startedAt.toISOString() : null,
      pauseReason: openPause?.reasonCode ?? null,
      pauseText: openPause?.reasonText ?? null,
      notes: task.template?.notes ?? null,
      instructions: task.template?.instructions ?? null,
      isMeeting: task.template?.isMeeting ?? false,
      repeatable: task.template?.repeatable ?? false,
      quantity: task.quantity,
      doneCount: task.doneCount,
      unitMinutes: task.unitMinutes ?? task.template?.estimatedMinutes ?? null,
      meetingId:
        task.hostedMeeting && task.hostedMeeting.status === "DRAFT"
          ? task.hostedMeeting.id
          : null,
    };
  });

  const active = dayTasks.find(
    (t) => t.status === "IN_PROGRESS" || t.status === "PAUSED",
  );
  const current = currentTask(dayTasks);

  return {
    date: day.toISOString().slice(0, 10),
    rostered: availability.rostered,
    windows: availability.windows,
    tasks: dayTasks,
    activeTaskId: active?.id ?? null,
    nextTaskId: active ? null : (current?.id ?? null),
    closed: attendance?.status === "CLOSED",
  };
}
