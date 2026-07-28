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
  /** This task is a meeting: starting it opens the notes pane. */
  isMeeting: boolean;
  /** The estimate is per go, so several can be planned as one block. */
  repeatable: boolean;
  quantity: number;
  doneCount: number;
  unitMinutes: number | null;
  /** The meeting being minuted, once started. */
  meetingId: string | null;
};

export type DayView = {
  date: string;
  rostered: boolean;
  windows: Window[];
  availableMinutes: number;
  reducedBy: string;
  tasks: DayTask[];
  activeTaskId: string | null;
  /** A meeting in progress, whether or not it came from a task. */
  liveMeeting: LiveMeeting | null;
  colleagues: { id: string; displayName: string }[];
};

export type LiveMeeting = {
  id: string;
  title: string;
  notes: string;
  fromTaskId: string | null;
  items: {
    id: string;
    title: string;
    estimatedMinutes: number;
    dueDate: string;
    pinnedTo: string | null;
  }[];
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

  // Any meeting this person is currently running -- one started from a task,
  // or an unplanned one that interrupted them.
  const draft = await prisma.meeting.findFirst({
    where: { createdById: userId, status: "DRAFT" },
    include: {
      actionItems: {
        include: { pinnedAssignee: { select: { displayName: true } } },
        orderBy: { dueDate: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { departmentId: true },
  });
  const colleagues = await prisma.user.findMany({
    where: { departmentId: me.departmentId, active: true },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });

  return {
    liveMeeting: draft
      ? {
          id: draft.id,
          title: draft.title,
          notes: draft.notes,
          fromTaskId: draft.sourceTaskId,
          items: draft.actionItems.map((i) => ({
            id: i.id,
            title: i.title,
            estimatedMinutes: i.estimatedMinutes,
            dueDate: i.dueDate.toISOString().slice(0, 10),
            pinnedTo: i.pinnedAssignee?.displayName ?? null,
          })),
        }
      : null,
    colleagues,
    date: day.toISOString().slice(0, 10),
    rostered: availability.rostered,
    windows: availability.windows,
    availableMinutes: availability.availableMinutes,
    reducedBy: availability.reducedBy,
    tasks: dayTasks,
    activeTaskId: active?.id ?? null,
  };
}
