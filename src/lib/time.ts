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

/**
 * The zone the company works in. Calendar days are decided here, not by
 * whatever the server happens to be set to -- a shift finishing at 01:00 in
 * Madrid belongs to the day it started, and UTC would file it under the next.
 */
export function scheduleZone(): string {
  return process.env.SCHEDULE_TIMEZONE ?? "Europe/Madrid";
}

/** Today as a calendar day in the schedule's zone. "en-CA" formats as YYYY-MM-DD. */
export function todayKey(now: Date = new Date(), zone = scheduleZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
}

/**
 * Today as a date-only Date, matching how days are stored. Use this rather
 * than toDateOnly(new Date()), which asks the server what day it is.
 */
export function today(now: Date = new Date(), zone = scheduleZone()): Date {
  return new Date(`${todayKey(now, zone)}T00:00:00Z`);
}

/**
 * How far ahead of UTC `zone` is at a given instant, in milliseconds.
 *
 * Formatting the instant as if it were in the zone and reading it back as UTC
 * gives the offset, DST included, without a timezone library.
 */
function zoneOffsetMs(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * The instant at which the clock in `zone` reads `minutes` on calendar day
 * `date`.
 *
 * Everywhere else in this system, minutes-from-midnight are compared against
 * other minutes-from-midnight and never become a timestamp -- which is the
 * whole reason the schedule is free of DST arithmetic. Attendance is the first
 * thing that has to cross over: capping an abandoned day at "the end of their
 * shift" means turning 18:00 into a real instant.
 *
 * Doing that naively -- Date.UTC(y, m, d) + minutes -- reads the shift end as
 * 18:00 UTC, which is 20:00 in Madrid, so the cap lands two hours after the
 * shift it was supposed to enforce.
 */
export function instantAt(
  date: Date,
  minutes: number,
  zone: string = scheduleZone(),
): Date {
  const naive =
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) +
    minutes * 60_000;
  // One correction is enough: the offset is read at roughly the right instant,
  // and only the ambiguous hour at a DST change could want a second pass --
  // immaterial for a shift boundary.
  return new Date(naive - zoneOffsetMs(new Date(naive), zone));
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

// Weekday names used to live here, in English. They are interface text, not a
// scheduling primitive, so they moved to lib/i18n/dates.ts -- see weekdayLabel().
