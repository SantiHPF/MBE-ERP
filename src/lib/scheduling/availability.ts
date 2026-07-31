import { isoWeekday, dateKey } from "@/lib/time";
import { isEffective } from "@/lib/absence/effective";

/**
 * How much of a given day a person actually has, resolved from three sources
 * in strict precedence:
 *
 *   1. WorkingPattern -- their normal hours for that weekday
 *   2. DayOverride    -- a one-off change, which replaces the pattern entirely
 *   3. Absence        -- subtracted from whatever the first two produced
 *
 * Everything in the system asks this rather than reading those tables, so
 * there is exactly one answer to "can this person take work on Thursday".
 */

export type Window = { start: number; end: number };

export type PatternInput = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  breakStartMinutes?: number | null;
};

export type OverrideInput = {
  date: Date;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  breakStartMinutes?: number | null;
};

export type AbsenceInput = {
  startDate: Date;
  endDate: Date;
  scope: "FULL_DAY" | "PARTIAL";
  startMinutes?: number | null;
  endMinutes?: number | null;
  /// Absences awaiting HR only count when they are sickness -- see
  /// isEffective(). Omitting both fields means "counts", which is what
  /// pre-approval records and test fixtures mean.
  category?: "SICK" | "HOLIDAY" | "PERSONAL" | "OTHER";
  status?: "PENDING" | "APPROVED" | "REJECTED";
};

export type Availability = {
  /** True when they are rostered at all, before absences are applied. */
  rostered: boolean;
  /** Free stretches, in order, with breaks and absences already removed. */
  windows: Window[];
  /** Total free minutes -- the number capacity checks compare against. */
  availableMinutes: number;
  /** Why they have less than their pattern would suggest, if anything. */
  reducedBy: "none" | "override" | "absence" | "override+absence";
};

/** Remove [cutStart, cutEnd) from a window, which may split it in two. */
function subtract(windows: Window[], cutStart: number, cutEnd: number): Window[] {
  if (cutEnd <= cutStart) return windows;
  const out: Window[] = [];

  for (const w of windows) {
    // No overlap: keep as-is.
    if (cutEnd <= w.start || cutStart >= w.end) {
      out.push(w);
      continue;
    }
    // Left remainder.
    if (cutStart > w.start) out.push({ start: w.start, end: cutStart });
    // Right remainder.
    if (cutEnd < w.end) out.push({ start: cutEnd, end: w.end });
    // Fully covered: contributes nothing.
  }

  return out;
}

/**
 * Windows with every one of `cuts` carved out.
 *
 * The same algebra as subtract(), applied repeatedly. It had grown three
 * private copies -- the assignment engine's subtractBusy(), the inline loop in
 * plan/place.ts, and this file -- which is three chances for "free time" to
 * mean three different things.
 */
export function subtractWindows(windows: Window[], cuts: Window[]): Window[] {
  let out = windows;
  for (const cut of cuts) out = subtract(out, cut.start, cut.end);
  return out;
}

/** The part of `windows` falling inside [from, to). */
export function clipWindows(
  windows: Window[],
  from: number,
  to: number,
): Window[] {
  const out: Window[] = [];
  for (const w of windows) {
    const start = Math.max(w.start, from);
    const end = Math.min(w.end, to);
    if (end > start) out.push({ start, end });
  }
  return out;
}

export function totalMinutes(windows: Window[]): number {
  return windows.reduce((sum, w) => sum + (w.end - w.start), 0);
}

function sameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

function coversDate(absence: AbsenceInput, date: Date): boolean {
  const d = dateKey(date);
  return dateKey(absence.startDate) <= d && d <= dateKey(absence.endDate);
}

export function computeAvailability(input: {
  date: Date;
  patterns: PatternInput[];
  overrides?: OverrideInput[];
  absences?: AbsenceInput[];
}): Availability {
  const { date, patterns } = input;
  const overrides = input.overrides ?? [];
  const absences = input.absences ?? [];

  // --- 1 & 2: the day's shape, override winning over pattern.
  const override = overrides.find((o) => sameDay(o.date, date));
  const pattern = patterns.find((p) => p.weekday === isoWeekday(date));
  const shape = override ?? pattern;

  if (!shape || shape.endMinutes <= shape.startMinutes) {
    return {
      rostered: false,
      windows: [],
      availableMinutes: 0,
      reducedBy: "none",
    };
  }

  let windows: Window[] = [{ start: shape.startMinutes, end: shape.endMinutes }];

  // --- breaks
  if (shape.breakMinutes > 0) {
    if (shape.breakStartMinutes != null) {
      // Positioned break: carve it out, which usually splits the day in two.
      windows = subtract(
        windows,
        shape.breakStartMinutes,
        shape.breakStartMinutes + shape.breakMinutes,
      );
    } else {
      // Unpositioned break: it still costs capacity, so take it off the end
      // rather than pretending the person is free for it.
      const last = windows[windows.length - 1];
      last.end = Math.max(last.start, last.end - shape.breakMinutes);
    }
  }

  // --- 3: absences
  let hitByAbsence = false;
  for (const absence of absences) {
    if (!coversDate(absence, date)) continue;
    if (!isEffective(absence)) continue;

    if (absence.scope === "FULL_DAY") {
      hitByAbsence = true;
      windows = [];
      break;
    }

    if (absence.startMinutes != null && absence.endMinutes != null) {
      const before = totalMinutes(windows);
      windows = subtract(windows, absence.startMinutes, absence.endMinutes);
      if (totalMinutes(windows) !== before) hitByAbsence = true;
    }
  }

  const reducedBy: Availability["reducedBy"] =
    override && hitByAbsence
      ? "override+absence"
      : hitByAbsence
        ? "absence"
        : override
          ? "override"
          : "none";

  return {
    rostered: true,
    windows,
    availableMinutes: totalMinutes(windows),
    reducedBy,
  };
}

/**
 * Does a scheduled slot overlap the hours an absence removed? Used when an
 * absence is saved, to decide which of that person's tasks need a decision.
 */
export function slotOverlapsAbsence(
  slot: { start: number; end: number },
  absence: AbsenceInput,
  date: Date,
): boolean {
  if (!coversDate(absence, date)) return false;
  if (!isEffective(absence)) return false;
  if (absence.scope === "FULL_DAY") return true;
  if (absence.startMinutes == null || absence.endMinutes == null) return false;
  return slot.start < absence.endMinutes && slot.end > absence.startMinutes;
}

export type DayAnchor =
  | "ARRIVAL"
  | "BEFORE_BREAK"
  | "AFTER_BREAK"
  | "BEFORE_LEAVING";

/**
 * The order anchors happen in, for sorting before anyone is chosen. Their real
 * clock times are not known until a candidate's windows are in hand.
 */
export const ANCHOR_ORDER: Record<DayAnchor, number> = {
  ARRIVAL: 0,
  BEFORE_BREAK: 1,
  AFTER_BREAK: 2,
  BEFORE_LEAVING: 3,
};

/**
 * Where an anchor lands in one person's day.
 *
 * The windows already have breaks and absences removed, so the first window is
 * the morning and the second -- when there is one -- is the afternoon.
 *
 * "Before" anchors are backed off by the task's own length so the work finishes
 * by the break or the end of the shift rather than starting then and running
 * over. Returns null when the day has no such point: somebody whose break is
 * unpositioned has one window and therefore no "after the break", and the
 * caller places that task flexibly rather than dropping it.
 */
export function resolveAnchor(
  anchor: DayAnchor,
  windows: Window[],
  minutes: number,
): number | null {
  if (windows.length === 0) return null;

  const first = windows[0];
  const last = windows[windows.length - 1];

  switch (anchor) {
    case "ARRIVAL":
      return first.start;

    case "BEFORE_BREAK": {
      // With no break there is nothing to be before; that is what leaving is.
      if (windows.length < 2) return null;
      return Math.max(first.start, first.end - minutes);
    }

    case "AFTER_BREAK":
      return windows.length < 2 ? null : windows[1].start;

    case "BEFORE_LEAVING":
      return Math.max(last.start, last.end - minutes);
  }
}

/** First window that can hold `minutes`, or null if none can. */
export function findSlot(
  windows: Window[],
  minutes: number,
  notBefore = 0,
): Window | null {
  for (const w of windows) {
    const start = Math.max(w.start, notBefore);
    if (w.end - start >= minutes) {
      return { start, end: start + minutes };
    }
  }
  return null;
}

/**
 * The mirror of findSlot: the *latest* slot that can hold `minutes`.
 *
 * "Antes del descanso" does not mean "somewhere in the morning", it means up
 * against the break. Placing such work with findSlot puts the first one right
 * -- resolveAnchor aims it at the end of the window -- and then packs every
 * other one forward from 09:00, because first-fit is the only thing findSlot
 * knows how to do. A day with three of them read 10:00, 10:40, 13:30, and the
 * first two contradicted their own names.
 *
 * `notBefore` is still honoured, so work pushed later in the day cannot be
 * packed backwards past the point it was pushed to.
 */
export function findLastSlot(
  windows: Window[],
  minutes: number,
  notAfter = Infinity,
  notBefore = 0,
): Window | null {
  for (let i = windows.length - 1; i >= 0; i -= 1) {
    const w = windows[i];
    const end = Math.min(w.end, notAfter);
    const start = Math.max(w.start, notBefore);
    if (end - start >= minutes) {
      return { start: end - minutes, end };
    }
  }
  return null;
}

/**
 * Does this anchor mean "as late as possible" rather than "as early as"?
 *
 * The four anchors are two pairs. ARRIVAL and AFTER_BREAK are starting guns:
 * the sooner the better. BEFORE_BREAK and BEFORE_LEAVING are deadlines -- the
 * work wants to sit against the boundary, and anything earlier is a day that
 * disagrees with the catalogue.
 */
export function anchorPacksBackward(anchor: DayAnchor): boolean {
  return anchor === "BEFORE_BREAK" || anchor === "BEFORE_LEAVING";
}

/** Does this day have a break in the middle of it, rather than none at all? */
export function dayHasBreak(windows: Window[]): boolean {
  return windows.length >= 2;
}

/**
 * What an anchor means on a day with no break in it.
 *
 * The four points are really "when I arrive", "before I stop", "when I come
 * back" and "before I leave". Take the break away and the middle two have
 * nothing to refer to: they fold onto the two ends of the day.
 *
 * This is what stops a routine that runs four times around a break from
 * running four times on a day that has none. Folded onto an anchor a sibling
 * already occupies, the repetition is dropped -- checking WhatsApp twice on a
 * short day is the point. Folded somewhere free, it survives with the new
 * anchor, so work whose only anchor is break-relative still gets done.
 */
export function collapseAnchor(anchor: DayAnchor): DayAnchor {
  switch (anchor) {
    case "BEFORE_BREAK":
      return "BEFORE_LEAVING";
    case "AFTER_BREAK":
      return "ARRIVAL";
    default:
      return anchor;
  }
}
