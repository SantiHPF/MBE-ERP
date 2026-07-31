import type { Window } from "@/lib/scheduling/availability";
import {
  clipWindows,
  subtractWindows,
  totalMinutes,
} from "@/lib/scheduling/availability";
import type { DayTask } from "@/lib/tasks/day";
import { stillOwed } from "@/lib/tasks/now";

/**
 * Have you actually got time on your hands?
 *
 * The engine packs the day up front and then the day is frozen, but reality is
 * not: a task finishes early, a meeting is cancelled, an absence leaves a hole.
 * This works out whether the hole is real -- and how much of it can hold work --
 * so something useful can be offered for it.
 *
 * "Free" is a narrower thing than "not currently doing anything". Being behind
 * schedule is not free time, and neither is lunch. Both cases return null here
 * rather than inviting someone to work through them.
 *
 * Pure, so the bar can recompute it on its own tick without a round trip, and
 * so the rules are testable without a database.
 */

/** Below this a gap is not worth interrupting anybody about. */
export const MIN_OFFER_MINUTES = 10;

export type Gap = {
  /** When the gap opens. May sit inside a break, in which case no segment does. */
  start: number;
  end: number;
  /** Working minutes inside the gap, breaks already excluded. */
  minutes: number;
  /**
   * The contiguous stretches. A task has to fit one of these, not the total:
   * forty minutes split by lunch is fifteen and twenty-five, and a thirty-five
   * minute job fits neither.
   */
  segments: Window[];
};

/** The holes between working windows -- lunch, and anything shaped like it. */
export function breaksBetween(windows: Window[]): Window[] {
  const out: Window[] = [];
  for (let i = 1; i < windows.length; i++) {
    out.push({ start: windows[i - 1].end, end: windows[i].start });
  }
  return out;
}

/** Statuses that hold ground in the day. */
const OCCUPIES = ["ASSIGNED", "IN_PROGRESS", "PAUSED", "ORPHANED", "DONE"];

const FINISHED = ["DONE", "CANCELLED"];

type Placed = Pick<DayTask, "status" | "scheduledStart" | "scheduledEnd">;

/**
 * The stretches already spoken for.
 *
 * Two things this gets right that a naive read of the slots does not:
 *
 * Work with no slot holds no ground. That is precisely what makes it
 * invisible, and what the gap-filler exists to surface.
 *
 * Finished work only holds the time it actually took. Pass `asOf` -- the
 * current clock -- and a task booked until 11:00 but finished at 10:40 gives
 * the twenty minutes back, which is the whole point: finishing early has to
 * produce a gap or there is nothing here to fill. Without `asOf` the booking
 * stands, which is what a whole-day view wants.
 */
export function bookedSpans(tasks: Placed[], asOf?: number): Window[] {
  const spans: Window[] = [];
  for (const t of tasks) {
    if (!OCCUPIES.includes(t.status)) continue;
    if (t.scheduledStart == null || t.scheduledEnd == null) continue;

    const end =
      asOf != null && FINISHED.includes(t.status)
        ? Math.min(t.scheduledEnd, asOf)
        : t.scheduledEnd;
    if (end > t.scheduledStart) spans.push({ start: t.scheduledStart, end });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Working windows with the booked stretches carved out. */
export function freeSpans(
  windows: Window[],
  tasks: Placed[],
  asOf?: number,
): Window[] {
  return subtractWindows(windows, bookedSpans(tasks, asOf));
}

/**
 * The gap open right now, or null when there is not one worth filling.
 *
 * The boundary is the next task you are already committed to, so filling the
 * gap can never make you late for it.
 */
export function openGap(
  windows: Window[],
  tasks: DayTask[],
  nowMinutes: number,
): Gap | null {
  // Something on the clock: you are working, not free. A paused task counts,
  // otherwise pausing would be a way of asking for more work.
  if (tasks.some((t) => t.status === "IN_PROGRESS" || t.status === "PAUSED")) {
    return null;
  }

  const dayEnd = windows[windows.length - 1]?.end;
  if (dayEnd == null || nowMinutes >= dayEnd) return null;

  const next = stillOwed(tasks)[0];
  /**
   * Work you should already have started. You are behind, not free, and this
   * is the same judgement blockingTask() makes in tasks/actions.ts -- offering
   * anything else here would be offering something the server would refuse.
   *
   * Work owed but never placed has no start time and so cannot be late. It is
   * exactly what the filler wants to surface, and accepting it is what finally
   * gives it a slot.
   */
  if (next && next.scheduledStart != null && next.scheduledStart <= nowMinutes) {
    return null;
  }

  const end = Math.min(next?.scheduledStart ?? dayEnd, dayEnd);
  if (end <= nowMinutes) return null;

  const segments = clipWindows(
    freeSpans(windows, tasks, nowMinutes),
    nowMinutes,
    end,
  );
  const minutes = totalMinutes(segments);
  if (minutes < MIN_OFFER_MINUTES) return null;

  return { start: nowMinutes, end, minutes, segments };
}
