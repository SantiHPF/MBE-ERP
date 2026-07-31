import type { Window } from "@/lib/scheduling/availability";
import { instantAt, scheduleZone } from "@/lib/time";

/**
 * The rules for turning raw signals into "this person worked from X to Y".
 *
 * Pure and database-free, the same split onboarding.ts / onboarding-db.ts
 * uses: the decisions are here and testable, the writes are in
 * attendance-db.ts.
 *
 * The guiding rule is that the record must never claim more than the signals
 * support. An inferred end is marked as inferred; a day with no evidence at
 * all stays empty rather than being filled in from the rota.
 */

export type AttendanceSource =
  | "LOGIN"
  | "TASK_START"
  | "TASK_END"
  | "LOGOUT"
  | "DAY_CLOSED"
  | "AUTO_CLOSE"
  | "MANUAL";

export type AttendanceStatus = "OPEN" | "CLOSED" | "NEEDS_REVIEW";

/** The signals collected over a day, in whatever order they arrived. */
export type Signals = {
  firstLoginAt: Date | null;
  firstTaskStartAt: Date | null;
  lastTaskEndAt: Date | null;
  logoutAt: Date | null;
  lastActivityAt: Date | null;
};

export const NO_SIGNALS: Signals = {
  firstLoginAt: null,
  firstTaskStartAt: null,
  lastTaskEndAt: null,
  logoutAt: null,
  lastActivityAt: null,
};

function earliest(...dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d != null);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a <= b ? a : b));
}

function latest(...dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d != null);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a >= b ? a : b));
}

/**
 * When the day began, and from which signal.
 *
 * Earliest wins, so logging in again after lunch never rewrites the morning,
 * and a person still signed in from yesterday -- whose session cookie means
 * no login fires at all today -- is clocked in by their first task instead.
 */
export function resolveArrival(
  signals: Signals,
): { at: Date; source: AttendanceSource } | null {
  const at = earliest(signals.firstLoginAt, signals.firstTaskStartAt);
  if (!at) return null;

  // A tie goes to LOGIN: it is the earlier event in practice, and the more
  // literal answer to "when did you get here".
  const source: AttendanceSource =
    signals.firstLoginAt != null && signals.firstLoginAt.getTime() === at.getTime()
      ? "LOGIN"
      : "TASK_START";

  return { at, source };
}

/**
 * When the day ended, when there is a real signal for it.
 *
 * Only a deliberate act closes a day: signing out, or pressing "close the
 * day". Finishing a task does not -- there is usually another one after it,
 * and treating every completion as a possible departure would make the record
 * a guess all day long. Returns null when nobody said they were leaving; that
 * is what closeAbandoned() is for.
 */
export function resolveDeparture(
  signals: Signals,
  closedAt: Date | null = null,
): { at: Date; source: AttendanceSource } | null {
  const at = latest(signals.logoutAt, closedAt);
  if (!at) return null;

  const source: AttendanceSource =
    closedAt != null && closedAt.getTime() === at.getTime()
      ? "DAY_CLOSED"
      : "LOGOUT";

  return { at, source };
}

/** The end of the last stretch they were rostered for, in minutes. */
export function rosteredEndMinutes(windows: Window[]): number | null {
  if (windows.length === 0) return null;
  return windows[windows.length - 1].end;
}

/**
 * A minutes-from-midnight time on a given calendar day, as a real instant.
 *
 * Delegates to instantAt() so that "18:00" means 18:00 on the company's
 * clock. Reading it as 18:00 UTC put the cap two hours past the shift in
 * Madrid, which the attendance table showed as a day ending at 20:00.
 */
export function atMinutes(
  date: Date,
  minutes: number,
  zone: string = scheduleZone(),
): Date {
  return instantAt(date, minutes, zone);
}

export type Closure = {
  endedAt: Date;
  endSource: AttendanceSource;
  status: AttendanceStatus;
};

/**
 * Close a day nobody closed.
 *
 * Two caps, and both matter:
 *
 *   - the last real signal, so the clock never runs past the point the person
 *     demonstrably stopped doing anything;
 *   - the end of their rostered day, so a timer left running overnight cannot
 *     claim the evening.
 *
 * The result is marked AUTO_CLOSE and NEEDS_REVIEW, because it is a guess and
 * should look like one. Returns null when there is nothing to go on at all --
 * an empty day is better than an invented one.
 */
export function closeAbandoned(input: {
  date: Date;
  signals: Signals;
  startedAt: Date | null;
  /** Their rostered stretches for that day, breaks already removed. */
  windows: Window[];
  /** Which clock the shift end is measured on. */
  zone?: string;
}): Closure | null {
  const lastSignal = latest(
    input.signals.lastActivityAt,
    input.signals.lastTaskEndAt,
    input.signals.firstTaskStartAt,
    input.signals.firstLoginAt,
  );
  if (!lastSignal) return null;

  const endMinutes = rosteredEndMinutes(input.windows);
  const rosteredEnd =
    endMinutes != null
      ? atMinutes(input.date, endMinutes, input.zone ?? scheduleZone())
      : null;

  // Whichever came first. Somebody who stopped at 15:00 is not credited to
  // 18:00, and somebody whose timer ran to 23:00 is not credited past their
  // shift.
  let endedAt = rosteredEnd && rosteredEnd < lastSignal ? rosteredEnd : lastSignal;

  // Never before the start: a shift that ended before they arrived is not a
  // reading, and the database CHECK would reject it anyway.
  if (input.startedAt && endedAt < input.startedAt) endedAt = input.startedAt;

  return { endedAt, endSource: "AUTO_CLOSE", status: "NEEDS_REVIEW" };
}

/**
 * Minutes actually present. Null while the day is still open -- an unfinished
 * day has no total, and showing a running one invites reading it as final.
 *
 * Lunch is taken off. It used to be included, which meant a nine-to-six day
 * with an hour for lunch reported nine hours present and everybody's figure
 * was an hour too generous. Pass the clocked lunch when there is one, and the
 * rostered figure otherwise -- an unclocked lunch is assumed to have been
 * taken, because it nearly always was.
 */
export function presentMinutes(
  startedAt: Date | null,
  endedAt: Date | null,
  breakMinutes = 0,
): number | null {
  if (!startedAt || !endedAt) return null;
  const gross = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
  return Math.max(0, gross - Math.max(0, breakMinutes));
}

export type BreakDrift = {
  /** Minutes actually away. Null when nobody clocked it. */
  takenMinutes: number | null;
  /** Negative: left early. Positive: left late. Null when unclocked. */
  startDrift: number | null;
  /** Negative: back early. Positive: back late. Null when not back yet. */
  endDrift: number | null;
  /** Minutes over the rostered length, floored at zero. */
  overBy: number;
  /** True when nothing was clocked and the rostered lunch is being assumed. */
  assumed: boolean;
  /** What present time should be reduced by, clocked or rostered. */
  countedMinutes: number;
};

/**
 * The lunch somebody actually took, against the one on their timetable.
 *
 * The whole point of the feature: a rostered one o'clock lunch and an actual
 * 12:41 are the difference between a timetable and a description of the day.
 *
 * A day with nothing clocked is not an accusation. It reads as lunch taken to
 * the timetable, `assumed` is set so the UI can say so quietly rather than
 * flagging it, and the rostered minutes still come off the total.
 */
export function breakDrift(input: {
  breakStartedAt: Date | null;
  breakEndedAt: Date | null;
  /** Minutes from midnight the break should start, or null when it floats. */
  rosteredStart: number | null;
  rosteredMinutes: number;
  /** The calendar day, for turning rosteredStart into an instant. */
  date: Date;
  zone?: string;
}): BreakDrift {
  const rostered = Math.max(0, input.rosteredMinutes);
  const zone = input.zone ?? scheduleZone();

  if (!input.breakStartedAt) {
    return {
      takenMinutes: null,
      startDrift: null,
      endDrift: null,
      overBy: 0,
      assumed: true,
      countedMinutes: rostered,
    };
  }

  const takenMinutes = input.breakEndedAt
    ? Math.max(
        0,
        Math.round(
          (input.breakEndedAt.getTime() - input.breakStartedAt.getTime()) / 60_000,
        ),
      )
    : null;

  /**
   * A floating break has no time it was supposed to start at, so leaving early
   * is not a thing that can be said about it. Only its length is comparable.
   */
  const expectedStart =
    input.rosteredStart != null
      ? atMinutes(input.date, input.rosteredStart, zone)
      : null;

  const startDrift = expectedStart
    ? Math.round(
        (input.breakStartedAt.getTime() - expectedStart.getTime()) / 60_000,
      )
    : null;

  const expectedEnd =
    expectedStart && rostered > 0
      ? new Date(expectedStart.getTime() + rostered * 60_000)
      : null;

  const endDrift =
    expectedEnd && input.breakEndedAt
      ? Math.round((input.breakEndedAt.getTime() - expectedEnd.getTime()) / 60_000)
      : null;

  return {
    takenMinutes,
    startDrift,
    endDrift,
    overBy: takenMinutes != null ? Math.max(0, takenMinutes - rostered) : 0,
    assumed: false,
    // A break still open counts as the rostered length rather than as nothing:
    // the person is away right now, and crediting them the time would be wrong.
    countedMinutes: takenMinutes ?? rostered,
  };
}

/**
 * The gap between arriving and starting work.
 *
 * Kept visible rather than folded into the total: a consistent hour between
 * logging in and the first task is worth someone noticing, and it is exactly
 * what a single in/out pair would hide.
 */
export function warmUpMinutes(signals: Signals): number | null {
  const { firstLoginAt, firstTaskStartAt } = signals;
  if (!firstLoginAt || !firstTaskStartAt) return null;
  if (firstTaskStartAt <= firstLoginAt) return 0;
  return Math.round((firstTaskStartAt.getTime() - firstLoginAt.getTime()) / 60_000);
}
