import { prisma } from "@/lib/db";
import { addDays, today, toDateOnly } from "@/lib/time";
import { computeAvailability } from "@/lib/scheduling/availability";
import { MAX_OPEN_SECONDS } from "@/lib/tasks/elapsed";
import {
  closeAbandoned,
  resolveArrival,
  resolveDeparture,
  type AttendanceSource,
  type Signals,
} from "./attendance";

/**
 * Writing the attendance record. The decisions live in attendance.ts; this
 * only persists them.
 *
 * Every one of these is called from an action that has already done its real
 * work, so none of them may throw: a failure to record that somebody arrived
 * must never be the reason they cannot start a task. They log and move on.
 */

/** The row is created on first sight of the day and upserted thereafter. */
async function upsertDay(userId: string, date: Date) {
  return prisma.attendanceDay.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date },
    update: {},
  });
}

/**
 * Never let attendance break the thing it is observing.
 *
 * A missing row is a gap in a report. A thrown error here would stop somebody
 * logging in or starting work, which is very much worse.
 */
async function quietly(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`attendance: ${what} failed`, error);
  }
}

/**
 * Somebody is here.
 *
 * Only ever fills a blank -- the earliest signal of the day wins, so signing
 * in again after lunch does not rewrite the morning. Also reopens a day that
 * was closed: if you press "close the day" and then remember one more job,
 * the record should say you were still here, not that you had gone home.
 */
export async function markArrival(
  userId: string,
  source: Extract<AttendanceSource, "LOGIN" | "TASK_START">,
  at: Date = new Date(),
): Promise<void> {
  await quietly("markArrival", async () => {
    const date = today();
    const day = await upsertDay(userId, date);

    const field = source === "LOGIN" ? "firstLoginAt" : "firstTaskStartAt";
    const already = day[field];

    const signals: Signals = {
      firstLoginAt: day.firstLoginAt,
      firstTaskStartAt: day.firstTaskStartAt,
      lastTaskEndAt: day.lastTaskEndAt,
      logoutAt: day.logoutAt,
      lastActivityAt: day.lastActivityAt,
      [field]: already ?? at,
    };

    const arrival = resolveArrival(signals);

    await prisma.attendanceDay.update({
      where: { id: day.id },
      data: {
        ...(already ? {} : { [field]: at }),
        lastActivityAt: at,
        ...(arrival ? { startedAt: arrival.at, startSource: arrival.source } : {}),
        // Back to work: an end that has been overtaken is no longer true.
        ...(day.endedAt && day.endedAt <= at
          ? { endedAt: null, endSource: null, status: "OPEN" as const }
          : {}),
      },
    });
  });
}

/** Proof of life: any start, pause, resume, completion or deferral. */
export async function markActivity(
  userId: string,
  at: Date = new Date(),
  options: { taskEnded?: boolean } = {},
): Promise<void> {
  await quietly("markActivity", async () => {
    const date = today();
    const day = await upsertDay(userId, date);

    await prisma.attendanceDay.update({
      where: { id: day.id },
      data: {
        lastActivityAt: at,
        ...(options.taskEnded ? { lastTaskEndAt: at } : {}),
      },
    });
  });
}

/**
 * They signed out.
 *
 * Must run *before* destroySession(), which deletes the session row -- until
 * now that made signing out leave no trace at all.
 */
export async function markDeparture(
  userId: string,
  at: Date = new Date(),
): Promise<void> {
  await quietly("markDeparture", async () => {
    const date = today();
    const day = await upsertDay(userId, date);

    const departure = resolveDeparture(
      {
        firstLoginAt: day.firstLoginAt,
        firstTaskStartAt: day.firstTaskStartAt,
        lastTaskEndAt: day.lastTaskEndAt,
        logoutAt: at,
        lastActivityAt: day.lastActivityAt,
      },
      day.endSource === "DAY_CLOSED" ? day.endedAt : null,
    );
    if (!departure) return;

    await prisma.attendanceDay.update({
      where: { id: day.id },
      data: {
        logoutAt: at,
        lastActivityAt: at,
        endedAt: departure.at,
        endSource: departure.source,
        // A day with no start cannot be closed -- the CHECK constraint would
        // reject it, and a departure without an arrival is not a reading.
        ...(day.startedAt ? { status: "CLOSED" as const } : {}),
      },
    });
  });
}

/**
 * Closing an open time entry, wherever the day is being ended from.
 *
 * Shared by the button and the sweep so they can never disagree about what
 * "stop the clock" means.
 */
export async function stopRunningEntry(
  userId: string,
  at: Date,
): Promise<boolean> {
  const running = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null },
    include: { pauses: { where: { resumedAt: null } } },
  });
  if (!running) return false;

  // Never before it started: a cap can land earlier than the entry itself when
  // somebody starts something after their shift has finished.
  const endedAt = at < running.startedAt ? running.startedAt : at;

  await prisma.$transaction([
    // Close an open pause first, or the paused stretch never ends and the
    // entry reads as zero work.
    ...(running.pauses[0]
      ? [
          prisma.pauseEvent.update({
            where: { id: running.pauses[0].id },
            data: { resumedAt: endedAt },
          }),
        ]
      : []),
    prisma.timeEntry.update({ where: { id: running.id }, data: { endedAt } }),
  ]);

  return true;
}

export type CloseResult = { closed: boolean; leftUnfinished: number };

/**
 * "Cerrar el día": the deliberate end of a workday.
 *
 * Stops the clock and closes the record. It does not touch the tasks -- the
 * dialog offers to reschedule whatever is left, through the existing
 * deferTask, so nothing is ever quietly marked done.
 */
export async function closeDay(
  userId: string,
  at: Date = new Date(),
): Promise<CloseResult> {
  const date = today();
  const day = await upsertDay(userId, date);

  await stopRunningEntry(userId, at);

  const leftUnfinished = await prisma.task.count({
    where: {
      assigneeId: userId,
      scheduledDate: date,
      status: { in: ["ASSIGNED", "IN_PROGRESS", "PAUSED", "ORPHANED"] },
    },
  });

  // Nothing to close if they were never here. Recording an end without a
  // start would be rejected by the CHECK constraint, and rightly.
  const startedAt = day.startedAt ?? day.firstLoginAt ?? day.firstTaskStartAt;
  if (!startedAt) return { closed: false, leftUnfinished };

  const endedAt = at < startedAt ? startedAt : at;

  await prisma.attendanceDay.update({
    where: { id: day.id },
    data: {
      startedAt,
      startSource: day.startSource ?? (day.firstLoginAt ? "LOGIN" : "TASK_START"),
      endedAt,
      endSource: "DAY_CLOSED",
      lastActivityAt: at,
      status: "CLOSED",
    },
  });

  return { closed: true, leftUnfinished };
}

export type SweepSummary = {
  daysClosed: number;
  entriesClosed: number;
};

/**
 * The backstop for days nobody closed.
 *
 * People forget, so every past day still OPEN is closed at the last real
 * signal, capped at the end of their rostered day, and marked NEEDS_REVIEW so
 * the guess is visible as a guess. Runs from the scheduling run, beside
 * syncOnboarding and syncCrmCalls.
 *
 * This is also what finally ends abandoned time entries. Until now nothing
 * did, so an unfinished task counted until somebody happened to start another
 * one -- the 72-hour rows that were quietly inflating tracked totals.
 */
export async function sweepOpenDays(now: Date = new Date()): Promise<SweepSummary> {
  const cutoff = today(now);

  const open = await prisma.attendanceDay.findMany({
    where: { status: "OPEN", date: { lt: cutoff } },
    include: {
      user: {
        select: {
          id: true,
          workingPatterns: true,
        },
      },
    },
  });

  const summary: SweepSummary = { daysClosed: 0, entriesClosed: 0 };

  for (const day of open) {
    const [overrides, absences] = await Promise.all([
      prisma.dayOverride.findMany({ where: { userId: day.userId, date: day.date } }),
      prisma.absence.findMany({
        where: {
          userId: day.userId,
          startDate: { lte: day.date },
          endDate: { gte: day.date },
        },
      }),
    ]);

    const availability = computeAvailability({
      date: day.date,
      patterns: day.user.workingPatterns,
      overrides,
      absences,
    });

    const closure = closeAbandoned({
      date: day.date,
      startedAt: day.startedAt,
      signals: {
        firstLoginAt: day.firstLoginAt,
        firstTaskStartAt: day.firstTaskStartAt,
        lastTaskEndAt: day.lastTaskEndAt,
        logoutAt: day.logoutAt,
        lastActivityAt: day.lastActivityAt,
      },
      windows: availability.windows,
    });

    // No signals at all: nothing happened, so there is nothing to record.
    // Deleting keeps empty rows from piling up on days off.
    if (!closure) {
      await prisma.attendanceDay.delete({ where: { id: day.id } });
      continue;
    }

    const startedAt =
      day.startedAt ?? resolveArrival({
        firstLoginAt: day.firstLoginAt,
        firstTaskStartAt: day.firstTaskStartAt,
        lastTaskEndAt: day.lastTaskEndAt,
        logoutAt: day.logoutAt,
        lastActivityAt: day.lastActivityAt,
      })?.at ?? null;

    if (!startedAt) {
      await prisma.attendanceDay.delete({ where: { id: day.id } });
      continue;
    }

    await prisma.attendanceDay.update({
      where: { id: day.id },
      data: {
        startedAt,
        endedAt: closure.endedAt,
        endSource: closure.endSource,
        status: closure.status,
      },
    });
    summary.daysClosed += 1;
  }

  summary.entriesClosed = await closeAbandonedEntries(now);
  return summary;
}

/**
 * Time entries left running past any plausible shift.
 *
 * Separate from the day sweep because an entry can outlive its attendance row
 * -- and because entries from before attendance existed are already in the
 * table. The cap matches the one elapsedSeconds() applies when reading, so the
 * stored value and the displayed value agree.
 */
export async function closeAbandonedEntries(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MAX_OPEN_SECONDS * 1000);

  const stale = await prisma.timeEntry.findMany({
    where: { endedAt: null, startedAt: { lt: cutoff } },
    include: { pauses: { where: { resumedAt: null } } },
  });

  for (const entry of stale) {
    const endedAt = new Date(entry.startedAt.getTime() + MAX_OPEN_SECONDS * 1000);
    await prisma.$transaction([
      ...(entry.pauses[0]
        ? [
            prisma.pauseEvent.update({
              where: { id: entry.pauses[0].id },
              data: { resumedAt: endedAt },
            }),
          ]
        : []),
      prisma.timeEntry.update({ where: { id: entry.id }, data: { endedAt } }),
    ]);
  }

  return stale.length;
}

/** Somebody's own record, most recent first. */
export async function recentAttendance(userId: string, days = 28) {
  const from = addDays(today(), -days);
  return prisma.attendanceDay.findMany({
    where: { userId, date: { gte: from } },
    orderBy: { date: "desc" },
  });
}

/**
 * A day the sweep guessed at, still waiting to be confirmed. Shown in My Day
 * the next morning rather than left to be discovered in a report.
 */
export async function dayNeedingReview(userId: string) {
  return prisma.attendanceDay.findFirst({
    where: { userId, status: "NEEDS_REVIEW", date: { lt: today() } },
    orderBy: { date: "desc" },
  });
}

/** Today's record, for the My Day bar. */
export async function todayAttendance(userId: string) {
  return prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: today() } },
  });
}

/** A correction, or confirmation, of a day the sweep guessed at. */
export async function correctDay(
  userId: string,
  dayId: string,
  endedAt: Date | null,
): Promise<void> {
  const day = await prisma.attendanceDay.findUnique({ where: { id: dayId } });
  if (!day || day.userId !== userId) return;

  // Confirming the guess is as valid an answer as changing it; either way the
  // day stops being a guess.
  const resolved = endedAt ?? day.endedAt;
  if (!resolved) return;

  await prisma.attendanceDay.update({
    where: { id: dayId },
    data: {
      endedAt: day.startedAt && resolved < day.startedAt ? day.startedAt : resolved,
      endSource: "MANUAL",
      status: "CLOSED",
    },
  });
}

/** Only used by tests and the verify script. */
export const _internal = { toDateOnly };
