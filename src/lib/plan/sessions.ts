/**
 * Long work, split into sittings.
 *
 * findSlot() wants one contiguous free window, so a ten-hour job can never be
 * placed: nobody has a ten-hour hole in their day. Rather than teach every
 * reader of scheduledStart/scheduledEnd that a task might have several slots,
 * a long job becomes a parent holding a run of ordinary child tasks -- one per
 * sitting -- and each of those is placed the normal way.
 *
 * This half is pure: how many sittings, how long each, and where they land in
 * a span of days. The writing lives in sessions-db.ts.
 */

import { findSlot, subtractWindows, type Window } from "@/lib/scheduling/availability";

/**
 * How long one sitting is when the catalogue does not say.
 *
 * 180 is the afternoon window of the standard pattern (15:00-18:00), the
 * smaller of the two halves a positioned break leaves behind. A sitting that
 * size fits either half of an ordinary day, which is what makes it possible to
 * place four of them in a week without rearranging everything around them.
 */
export const DEFAULT_SESSION_MINUTES = 180;

/**
 * Past this the estimate is wrong, or the thing is a project rather than a
 * task. The sittings grow instead of the count, so a mistyped estimate cannot
 * generate forty rows nobody asked for.
 */
export const MAX_SESSIONS = 8;

/**
 * How far ahead sittings may be spread. Matches runSchedule's own horizon
 * (from .. from+13), so the nightly run always sees every sitting it might
 * have to reconcile.
 */
export const MAX_SPREAD_DAYS = 14;

/**
 * How to cut `totalMinutes` into sittings, or [] to leave it alone.
 *
 * Even lengths rather than greedy full-size chunks: 600 becomes 4x150, not
 * 3x180 + 60. A stub at the end is worse than it looks -- it is a
 * twenty-minute hole in somebody's Friday that the day has to be built around,
 * for no reason other than the arithmetic.
 *
 * The remainder is handed out a minute at a time to the earliest sittings, so
 * the parts always add back up to exactly what was estimated. Losing a minute
 * to rounding would show up later as a job that can never be finished.
 */
export function planSessions(
  totalMinutes: number,
  sessionMinutes: number = DEFAULT_SESSION_MINUTES,
  maxSessions: number = MAX_SESSIONS,
): number[] {
  const size = Math.max(1, Math.floor(sessionMinutes));
  if (!Number.isFinite(totalMinutes) || totalMinutes <= size) return [];

  const count = Math.min(Math.ceil(totalMinutes / size), Math.max(1, maxSessions));
  const base = Math.floor(totalMinutes / count);
  let remainder = totalMinutes - base * count;

  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/**
 * The same, for repeatable work -- "ring 40 candidates" rather than "write the
 * report". Splits by goes, not by minutes, because half a phone call is not a
 * unit of work anybody can do, and the counter on the task counts goes.
 *
 * Forty calls at fifteen minutes is ten hours, and is exactly how this will
 * come up at ATIC.
 */
export function planRepeatableSessions(
  quantity: number,
  unitMinutes: number,
  sessionMinutes: number = DEFAULT_SESSION_MINUTES,
  maxSessions: number = MAX_SESSIONS,
): { goes: number; minutes: number }[] {
  const unit = Math.max(1, Math.floor(unitMinutes));
  const goes = Math.max(0, Math.floor(quantity));
  if (goes * unit <= Math.max(1, sessionMinutes)) return [];

  // How many whole goes fit in one sitting. At least one, or a job whose unit
  // is longer than a sitting would divide by zero rather than simply making
  // each sitting one go.
  const perSitting = Math.max(1, Math.floor(Math.max(1, sessionMinutes) / unit));
  const count = Math.min(Math.ceil(goes / perSitting), Math.max(1, maxSessions));
  if (count <= 1) return [];

  const base = Math.floor(goes / count);
  let remainder = goes - base * count;

  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    const mine = base + extra;
    return { goes: mine, minutes: mine * unit };
  });
}

/** One day of the span a job may be spread over, with the time still free. */
export type DayCapacity = {
  date: Date;
  /** Already has breaks, absences and the person's other bookings removed. */
  free: Window[];
};

export type SessionPlacement = {
  /** Index into the `sessions` array this came from. */
  index: number;
  minutes: number;
  /** Null when nowhere in the span would take it. */
  date: Date | null;
  start: number | null;
  end: number | null;
};

/**
 * Lay a job's sittings across a span of days.
 *
 * Walks a cursor forward over (day, minute) and never lets it go backwards.
 * That monotonicity is the whole point: blockingTask() runs the day in
 * scheduled order and refuses to start anything below an unfinished task
 * above it, so a job whose sittings read 1, 3, 2 is a day that looks busy with
 * something impossible. The same failure placeAll() already fixes for
 * follow-on pairs.
 *
 * A sitting that will not fit anywhere is emitted unplaced *without* moving
 * the cursor. A later sitting is sometimes shorter -- repeatable work hands
 * the odd goes to the earliest ones -- and there is no reason to punish it for
 * a gap its predecessor could not use.
 */
export function spreadSessions(input: {
  /** Minutes each, in the order they have to happen. */
  sessions: number[];
  /** Ordered, earliest first. */
  days: DayCapacity[];
  /** Earliest minute usable on the first day. */
  notBefore?: number;
}): SessionPlacement[] {
  const { sessions, days } = input;
  // Local copies: the caller's windows are not ours to shorten.
  const free = days.map((d) => [...d.free]);

  let dayIndex = 0;
  let notBefore = input.notBefore ?? 0;

  return sessions.map((minutes, index) => {
    for (let i = dayIndex; i < days.length; i += 1) {
      const from = i === dayIndex ? notBefore : 0;
      const slot = findSlot(free[i], minutes, from);
      if (!slot) continue;

      free[i] = subtractWindows(free[i], [slot]);
      dayIndex = i;
      notBefore = slot.end;
      return {
        index,
        minutes,
        date: days[i].date,
        start: slot.start,
        end: slot.end,
      };
    }

    return { index, minutes, date: null, start: null, end: null };
  });
}

export type SessionRow = {
  id: string;
  status: string;
  estimatedMinutes: number;
  elapsedSeconds: number;
  /** YYYY-MM-DD, or null when the sitting has no slot yet. */
  scheduledDate: string | null;
  sessionIndex: number;
};

export type SessionProgress = {
  /** Sittings that still count -- cancelled ones are not owed and not owed for. */
  total: number;
  done: number;
  /** Minutes of the whole job still to do. */
  remainingMinutes: number;
  /** Tracked time across every sitting, including cancelled ones: it happened. */
  elapsedSeconds: number;
  /** The day of the next unfinished sitting, or null when none is placed. */
  nextDate: string | null;
  allDone: boolean;
};

/**
 * Where a split job has got to.
 *
 * Derived rather than stored. A counter on the parent would be one more thing
 * to keep in step with six actions that can change a sitting, and it would be
 * wrong the first time one of them forgot.
 */
export function rollUp(sessions: SessionRow[]): SessionProgress {
  const live = sessions.filter((s) => s.status !== "CANCELLED");
  const done = live.filter((s) => s.status === "DONE");

  const remainingMinutes = live.reduce((sum, s) => {
    if (s.status === "DONE") return sum;
    // Overrunning does not add work back: a sitting that has taken longer than
    // its estimate still has exactly the rest of the job left after it.
    return sum + Math.max(0, s.estimatedMinutes - Math.floor(s.elapsedSeconds / 60));
  }, 0);

  const next = live
    .filter((s) => s.status !== "DONE" && s.scheduledDate)
    .sort((a, b) => a.sessionIndex - b.sessionIndex)[0];

  return {
    total: live.length,
    done: done.length,
    remainingMinutes,
    elapsedSeconds: sessions.reduce((sum, s) => sum + s.elapsedSeconds, 0),
    nextDate: next?.scheduledDate ?? null,
    // An empty run is not a finished job -- it is a job whose sittings have
    // all been cancelled, and saying "done" would close it silently.
    allDone: live.length > 0 && done.length === live.length,
  };
}
