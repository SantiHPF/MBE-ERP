import { prisma } from "@/lib/db";
import { scheduleZone, today, toDateOnly } from "@/lib/time";
import { computeAvailability, type Window } from "@/lib/scheduling/availability";
import { elapsedSeconds } from "./elapsed";
import { callListFor, type CallList } from "@/lib/crm/sync";
import { dayNeedingReview, todayAttendance } from "@/lib/attendance/attendance-db";
import { sessionInfoFor, type SessionInfo } from "@/lib/plan/sessions-db";

export type { CallList, SessionInfo };

export type DayTask = {
  id: string;
  title: string;
  origin: string;
  status: string;
  estimatedMinutes: number;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  elapsedSeconds: number;
  /**
   * When the clock started, for a task running right now. The bar derives its
   * stopwatch from this rather than from elapsedSeconds, which is only true
   * at the instant it was rendered -- and the bar can sit unrendered on
   * another page for an hour.
   */
  runningSince: string | null;
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
  /**
   * Set when this is one sitting of a job too long to do in one go. Null for
   * ordinary work. The estimate and the stopwatch above still measure *this
   * sitting*, which is what the person is actually doing; this is the context
   * around it.
   */
  session: SessionInfo | null;
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
  /**
   * Who to ring, when the task in hand is a batched CRM call. Resolved live
   * rather than snapshotted -- see callListFor().
   */
  callList: { taskId: string; list: CallList } | null;
  colleagues: { id: string; displayName: string }[];
  /** Attendance, for the bar and the morning review prompt. */
  attendance: {
    /** Set once the day has been closed on purpose. */
    closedAt: string | null;
    /**
     * A past day the sweep guessed at, still waiting to be confirmed. The
     * clock time is formatted here, in the company's zone -- letting the
     * browser do it would show a different hour to anybody travelling, and
     * mismatch what the server rendered.
     */
    review: { id: string; date: string; endClock: string } | null;
  };
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

// The English ORIGIN_LABEL map that used to live here has moved into the
// dictionary as origin.*. It was invisible because the badge is uppercased in
// CSS, so "Recurring" and the raw RECURRING looked identical -- and it had no
// entry for CRM, which only passed because the enum name reads as a word.

export async function getDayView(
  userId: string,
  date: Date = today(),
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

  const sessions = await sessionInfoFor(tasks);

  const dayTasks: DayTask[] = tasks.map((task) => {
    const openPause = task.timeEntries
      .flatMap((e) => e.pauses)
      .find((p) => p.resumedAt === null);

    return {
      id: task.id,
      title: task.title,
      // The raw TaskOrigin. The view translates it with origin.*.
      origin: task.origin,
      status: task.status,
      estimatedMinutes: task.estimatedMinutes,
      scheduledStart: task.scheduledStart,
      scheduledEnd: task.scheduledEnd,
      elapsedSeconds: elapsedSeconds(task.timeEntries, now),
      runningSince:
        task.timeEntries.find((e) => e.endedAt === null) && !openPause
          ? task.timeEntries
              .find((e) => e.endedAt === null)!
              .startedAt.toISOString()
          : null,
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
      session: sessions.get(task.id) ?? null,
    };
  });

  const active = dayTasks.find(
    (t) => t.status === "IN_PROGRESS" || t.status === "PAUSED",
  );

  // The list belongs to whichever call task is in hand. Falling back to one
  // that is merely assigned means the panel is there before they start, which
  // is when people actually look at who they have to ring.
  const callTask =
    tasks.find((t) => t.origin === "CRM" && t.id === active?.id) ??
    tasks.find((t) => t.origin === "CRM" && t.status !== "DONE");
  const callList = callTask
    ? await callListFor(callTask.id).then((list) =>
        list ? { taskId: callTask.id, list } : null,
      )
    : null;

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

  const [attendanceToday, review] = await Promise.all([
    todayAttendance(userId),
    dayNeedingReview(userId),
  ]);

  return {
    attendance: {
      closedAt:
        attendanceToday?.status === "CLOSED" && attendanceToday.endedAt
          ? attendanceToday.endedAt.toISOString()
          : null,
      review:
        review?.endedAt != null
          ? {
              id: review.id,
              date: review.date.toISOString().slice(0, 10),
              endClock: new Intl.DateTimeFormat("en-GB", {
                timeZone: scheduleZone(),
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(review.endedAt),
            }
          : null,
    },
    callList,
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
