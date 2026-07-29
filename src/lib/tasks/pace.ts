import type { Window } from "@/lib/scheduling/availability";

/**
 * Is the day still reachable?
 *
 * Not "is this task over its estimate" -- that is the progress bar, and it
 * keeps saying you are late long after you have caught up. This compares what
 * is left to do against the time actually left to do it in, so finishing one
 * job early genuinely buys back the slip from the one before.
 *
 * Pure, like elapsed.ts, so it can be tested without a database and recomputed
 * client-side every second without a round trip.
 */

export type PaceTask = {
  status: string;
  estimatedMinutes: number;
  /** Time already tracked against it. */
  elapsedSeconds: number;
};

export type PaceBand = "ahead" | "onTime" | "behind";

export type Pace = {
  /** Free minutes left over once the remaining work is done. Negative overruns. */
  slackMinutes: number;
  minutesLeft: number;
  remainingMinutes: number;
  band: PaceBand;
};

/** Comfortably ahead rather than merely not behind. */
const AHEAD_FROM = 15;

const FINISHED = ["DONE", "CANCELLED"];

/**
 * Working minutes still ahead of you today.
 *
 * Taken from the windows rather than end-minus-now, so breaks are already
 * excluded -- an hour for lunch is not an hour you can put a task in.
 */
export function minutesLeftInDay(windows: Window[], nowMinutes: number): number {
  let total = 0;
  for (const w of windows) {
    total += Math.max(0, w.end - Math.max(w.start, nowMinutes));
  }
  return total;
}

/**
 * Work still owed today.
 *
 * The running task counts only what is left of its estimate, so time already
 * spent is not demanded twice. A task that has overrun contributes zero rather
 * than a negative, which would otherwise credit you for being late.
 */
export function remainingWorkMinutes(tasks: PaceTask[]): number {
  let total = 0;
  for (const task of tasks) {
    if (FINISHED.includes(task.status)) continue;
    const spent = Math.floor(task.elapsedSeconds / 60);
    total += Math.max(0, task.estimatedMinutes - spent);
  }
  return total;
}

export function pace(
  windows: Window[],
  tasks: PaceTask[],
  nowMinutes: number,
): Pace {
  const minutesLeft = minutesLeftInDay(windows, nowMinutes);
  const remainingMinutes = remainingWorkMinutes(tasks);
  const slackMinutes = minutesLeft - remainingMinutes;

  return {
    slackMinutes,
    minutesLeft,
    remainingMinutes,
    // Nothing left to do is never "behind", however little of the day is left.
    band:
      remainingMinutes === 0
        ? "ahead"
        : slackMinutes < 0
          ? "behind"
          : slackMinutes >= AHEAD_FROM
            ? "ahead"
            : "onTime",
  };
}

/** Minutes from midnight, in the schedule's zone, for a wall-clock instant. */
export function nowMinutesIn(zone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  // "24:00" is midnight at the start of the day in some ICU builds.
  return (hour % 24) * 60 + minute;
}
