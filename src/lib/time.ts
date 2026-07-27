/// Helpers for the minutes-from-midnight representation used throughout the
/// schedule. Storing wall-clock minutes rather than timestamps keeps working
/// hours, absences and task slots free of DST arithmetic.

export const MINUTES_PER_DAY = 24 * 60;

/** "09:30" -> 570 */
export function parseClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Not a HH:MM time: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Out of range: ${value}`);
  return hours * 60 + minutes;
}

/** 570 -> "09:30" */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 90 -> "1h 30m", 45 -> "45m", 120 -> "2h" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Dates in this system are calendar days, stored in Postgres `date` columns.
 * Normalising to UTC midnight keeps a day from drifting when the server's
 * local zone differs from SCHEDULE_TIMEZONE.
 */
export function toDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function dateKey(date: Date): string {
  return toDateOnly(date).toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = toDateOnly(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cursor = toDateOnly(start);
  const last = toDateOnly(end);
  while (cursor <= last) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? `Day ${weekday}`;
}
