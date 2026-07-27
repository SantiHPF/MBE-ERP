import { prisma } from "@/lib/db";
import { toDateOnly } from "@/lib/time";
import { computeAvailability, type Window } from "@/lib/scheduling/availability";
import { elapsedSeconds } from "./elapsed";

export type DayTask = {
  id: string;
  title: string;
  origin: string;
  status: string;
  estimatedMinutes: number;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  elapsedSeconds: number;
  /** Set while the task is paused, so the reason is visible in the list. */
  pauseReason: string | null;
  pauseText: string | null;
  /** Warnings from the catalogue -- shown before the work, not buried. */
  notes: string | null;
  instructions: string | null;
};

export type DayView = {
  date: string;
  rostered: boolean;
  windows: Window[];
  availableMinutes: number;
  reducedBy: string;
  tasks: DayTask[];
  activeTaskId: string | null;
};

const ORIGIN_LABEL: Record<string, string> = {
  RECURRING: "Recurring",
  CATALOGUE: "Catalogue",
  SHEET: "Sheet",
  MEETING: "Meeting",
  MANUAL: "Added by hand",
};

export async function getDayView(
  userId: string,
  date: Date = new Date(),
): Promise<DayView> {
  const day = toDateOnly(date);

  const [patterns, overrides, absences, tasks] = await Promise.all([
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
        timeEntries: {
          include: { pauses: true },
          orderBy: { startedAt: "asc" },
        },
        template: { select: { notes: true, instructions: true } },
      },
      orderBy: [{ scheduledStart: "asc" }, { title: "asc" }],
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

    return {
      id: task.id,
      title: task.title,
      origin: ORIGIN_LABEL[task.origin] ?? task.origin,
      status: task.status,
      estimatedMinutes: task.estimatedMinutes,
      scheduledStart: task.scheduledStart,
      scheduledEnd: task.scheduledEnd,
      elapsedSeconds: elapsedSeconds(task.timeEntries, now),
      pauseReason: openPause?.reasonCode ?? null,
      pauseText: openPause?.reasonText ?? null,
      notes: task.template?.notes ?? null,
      instructions: task.template?.instructions ?? null,
    };
  });

  const active = dayTasks.find(
    (t) => t.status === "IN_PROGRESS" || t.status === "PAUSED",
  );

  return {
    date: day.toISOString().slice(0, 10),
    rostered: availability.rostered,
    windows: availability.windows,
    availableMinutes: availability.availableMinutes,
    reducedBy: availability.reducedBy,
    tasks: dayTasks,
    activeTaskId: active?.id ?? null,
  };
}
