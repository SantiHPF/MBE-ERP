import type { DayAnchor, Window } from "./availability";
import { clipWindows } from "./availability";

/**
 * Which part of the day a piece of work is allowed in.
 *
 * Two features need this and they mean subtly different things, so both live
 * here where the difference is visible:
 *
 *   A catalogue preference -- "this one belongs in the morning" -- is a
 *   statement about the company, so it splits at one clock time for everybody.
 *
 *   An anchor's fallback is a statement about *that person's* break. "After the
 *   break" means after theirs, so it follows their own windows rather than a
 *   company-wide hour.
 *
 * For everyone here the two coincide, because the working patterns all put the
 * break at 14:00. They only diverge for somebody on unusual hours, and then
 * each does the right thing for its own meaning.
 *
 * Pure, like the rest of the scheduling rules.
 */

export type ShiftHalf = "MORNING" | "AFTERNOON";

/**
 * The company's dividing line, 14:00.
 *
 * Deliberately one number rather than each person's own break: a manager
 * ticking "morning" in the catalogue is saying something about the business,
 * and it should not mean a different thing for each person who picks the task
 * up. The working patterns happen to break here too.
 */
export const SHIFT_SPLIT_MINUTES = 840;

/**
 * Where a catalogue preference may be placed.
 *
 * Morning is everything that can finish by the split; afternoon everything
 * that can start at or after it. A day with no break is divided just the same,
 * which is the point of using a clock time rather than the break.
 */
export function halfWindows(windows: Window[], half: ShiftHalf): Window[] {
  return half === "MORNING"
    ? clipWindows(windows, 0, SHIFT_SPLIT_MINUTES)
    : clipWindows(windows, SHIFT_SPLIT_MINUTES, Infinity);
}

/** Which half an anchor belongs to. */
export function anchorHalf(anchor: DayAnchor): ShiftHalf {
  return anchor === "ARRIVAL" || anchor === "BEFORE_BREAK"
    ? "MORNING"
    : "AFTERNOON";
}

/**
 * Where an anchor that could not be honoured is allowed to fall back to.
 *
 * Not "anywhere". Falling back without a bound is how a task called "antes de
 * salir" ended up at 10:00 -- the end of the shift was full, first-fit found
 * the morning, and the day then said something that contradicted the task's own
 * name. Better to leave it unplaced and let the day read as over.
 *
 * Uses the person's own windows rather than the clock split, because that is
 * what the anchor is about. A day with a single window has no second half, so
 * an afternoon anchor falls back within that one window -- there is nowhere
 * else, and refusing outright would drop work for no reason.
 */
export function anchorFallbackWindows(
  windows: Window[],
  anchor: DayAnchor,
): Window[] {
  if (windows.length <= 1) return windows;
  return anchorHalf(anchor) === "MORNING"
    ? [windows[0]]
    : windows.slice(1);
}

/** The parts of `windows` that also fall inside `allowed`. */
export function intersect(windows: Window[], allowed: Window[]): Window[] {
  const out: Window[] = [];
  for (const a of allowed) {
    for (const w of clipWindows(windows, a.start, a.end)) out.push(w);
  }
  return out.sort((x, y) => x.start - y.start);
}
