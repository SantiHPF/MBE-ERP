import { dateKey } from "@/lib/time";
import { SHIFT_SPLIT_MINUTES } from "@/lib/scheduling/half";
import type { FillerSource } from "./score";

/**
 * Is this work actually free to move?
 *
 * The gap-filler offers whatever fits the time you have. That is only honest
 * for work that has no claim on a *particular* time, and two kinds of work do:
 *
 *   An hour. "CRM al llegar" belongs at arrival; "Sucesos" belongs at 09:00; a
 *   meeting belongs when the other people are there. None of those can be
 *   honoured in a random gap, so none is ever offered.
 *
 *   A cadence. A two-monthly interview means *every two months*. Doing March's
 *   in July is not catching up, it is doing the wrong thing -- a missed
 *   occurrence is missed, not owed. So recurring work is only ever offered on
 *   the day it is actually due: never dragged forward, never caught up after.
 *
 * Everything else -- an ad-hoc job, a sheet row, a meeting action -- has a real
 * deadline rather than a rhythm, so being late is genuine debt and it keeps
 * behaving that way.
 *
 * Pure, and shared by the pool queries and the accept-time re-check so the two
 * cannot drift apart.
 */

export type Candidate = {
  /** A point in the working day: ARRIVAL, BEFORE_BREAK, and so on. */
  anchor: string | null;
  isMeeting: boolean;
  /** The task's rule pins it to a clock time. */
  hasFixedTime: boolean;
  origin: string;
  dueDate: Date;
  /**
   * True when this is the second half of a pair and the first half is not done
   * yet. Not free work: it is owed to another task rather than to a clock.
   */
  waitingOnLeader?: boolean;
  /** Kept to one half of the day by the catalogue. Null means anywhere. */
  shiftHalf?: "MORNING" | "AFTERNOON" | null;
};

/**
 * Origins whose date is the meaning rather than a deadline.
 *
 * RECURRING covers both rule instances and onboarding interviews -- they share
 * the origin. CRM work is one dated batch of calls per day, and tomorrow's list
 * is recomputed anyway, so yesterday's batch is never the thing to do now.
 */
const CADENCE = ["RECURRING", "CRM"];

/** Owed to a clock, so no gap can honour it. */
export function isHourBound(c: Candidate): boolean {
  return c.anchor != null || c.hasFixedTime || c.isMeeting;
}

/** Owed to a rhythm, so only its own occurrence counts. */
export function isCadence(c: Candidate): boolean {
  return CADENCE.includes(c.origin);
}

/** Does the gap fall in the half of the day this task belongs to? */
function fitsHalf(c: Candidate, gapStart: number, gapEnd: number): boolean {
  if (!c.shiftHalf) return true;
  return c.shiftHalf === "MORNING"
    ? gapStart < SHIFT_SPLIT_MINUTES
    : gapEnd > SHIFT_SPLIT_MINUTES;
}

/**
 * May this be offered for free time?
 *
 * Orphans are exempt from the cadence rule and only from that one. An absence
 * means the occurrence is lost entirely unless somebody picks it up, and
 * rescuing it is the whole point of triage -- which is a different thing from
 * pulling a cadence forward for the sake of a spare half hour. They still obey
 * the hour rule: an anchored orphan goes back to the manager, who can give it
 * to somebody whose day can hold it at the right time.
 *
 * A shift preference is softer than either: a morning task is not refused
 * outright, only refused for an afternoon gap.
 */
export function isOfferable(
  c: Candidate,
  source: FillerSource,
  today: Date,
  gap?: { start: number; end: number },
): boolean {
  if (isHourBound(c)) return false;
  // The second half of a pair, offered on its own, is work you would not be
  // allowed to start. Its leader is what free time should be spent on.
  if (c.waitingOnLeader) return false;
  if (gap && !fitsHalf(c, gap.start, gap.end)) return false;
  if (source === "orphaned") return true;
  if (!isCadence(c)) return true;
  return dateKey(c.dueDate) === dateKey(today);
}
