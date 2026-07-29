/**
 * Time actually worked on a task: the time entries, minus the stretches spent
 * paused. Pure, so it can be tested without a database and reused by the
 * client-side stopwatch.
 */

/**
 * How long an unfinished entry may keep counting.
 *
 * A timer nobody closed used to run for ever: an entry is open until the
 * person starts something else, completes it, or defers it, so a task started
 * on Friday at 17:00 and abandoned reported about 72 hours by Monday. That
 * went straight into the estimate-drift figure on /me and the booked totals
 * on /team.
 *
 * The real fix is sweepOpenDays() in lib/attendance, which closes the entry at
 * the end of the person's rostered day. This ceiling is the safety net for
 * entries it has not reached yet, and for the bad rows already in the table.
 * Sixteen hours is comfortably longer than any shift here -- the longest split
 * day ends at 20:00 -- so it never truncates real work, and it stops a
 * runaway before it can cross into a second day.
 */
export const MAX_OPEN_SECONDS = 16 * 60 * 60;

export function elapsedSeconds(
  entries: {
    startedAt: Date;
    endedAt: Date | null;
    pauses: { pausedAt: Date; resumedAt: Date | null }[];
  }[],
  now: Date = new Date(),
  maxOpenSeconds: number = MAX_OPEN_SECONDS,
): number {
  let total = 0;

  for (const entry of entries) {
    // An open entry counts up to now, but only so far.
    const end =
      entry.endedAt ??
      new Date(
        Math.min(now.getTime(), entry.startedAt.getTime() + maxOpenSeconds * 1000),
      );
    let span = (end.getTime() - entry.startedAt.getTime()) / 1000;

    for (const pause of entry.pauses) {
      // A pause is capped the same way, and never past the entry's own end --
      // otherwise an open pause on a capped entry subtracts more than the
      // entry contains and quietly eats another task's time.
      const pauseEnd = pause.resumedAt ?? end;
      span -=
        (Math.min(pauseEnd.getTime(), end.getTime()) - pause.pausedAt.getTime()) /
        1000;
    }

    // An entry can never contribute negative time, whatever the data says.
    total += Math.max(0, span);
  }

  return Math.round(total);
}
