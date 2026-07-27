/**
 * Time actually worked on a task: the time entries, minus the stretches spent
 * paused. Pure, so it can be tested without a database and reused by the
 * client-side stopwatch.
 */
export function elapsedSeconds(
  entries: {
    startedAt: Date;
    endedAt: Date | null;
    pauses: { pausedAt: Date; resumedAt: Date | null }[];
  }[],
  now: Date = new Date(),
): number {
  let total = 0;

  for (const entry of entries) {
    const end = entry.endedAt ?? now;
    let span = (end.getTime() - entry.startedAt.getTime()) / 1000;

    for (const pause of entry.pauses) {
      const pauseEnd = pause.resumedAt ?? now;
      span -= (pauseEnd.getTime() - pause.pausedAt.getTime()) / 1000;
    }

    // An entry can never contribute negative time, whatever the data says.
    total += Math.max(0, span);
  }

  return Math.round(total);
}
