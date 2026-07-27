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

function total(windows: Window[]): number {
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
      const before = total(windows);
      windows = subtract(windows, absence.startMinutes, absence.endMinutes);
      if (total(windows) !== before) hitByAbsence = true;
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
    availableMinutes: total(windows),
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
