import { DICTIONARIES, translate, type Locale } from "./dictionary";

/**
 * Dates written in the interface's language.
 *
 * Deliberately not Intl: the names live in dictionary.ts so that TypeScript
 * makes Spanish keep up with English, and so a client component and the server
 * that rendered it can never disagree about what "Wed" is called.
 *
 * Pure -- no "server-only" -- because plan-board.tsx and the catalogue list are
 * client components and need the same answers.
 */

/** Only for what Intl genuinely does better: grouping digits. */
export function localeTag(locale: Locale): string {
  return locale === "ES" ? "es-ES" : "en-GB";
}

/** 1 = Monday … 7 = Sunday, matching isoWeekday(). */
export function weekdayLabel(
  locale: Locale,
  isoWeekday: number,
  style: "long" | "short" = "long",
): string {
  const names =
    DICTIONARIES[locale].dates[
      style === "long" ? "weekdaysLong" : "weekdaysShort"
    ];
  return names[isoWeekday - 1] ?? String(isoWeekday);
}

export function monthLabel(locale: Locale, month: number): string {
  return DICTIONARIES[locale].dates.monthsLong[month - 1] ?? String(month);
}

/**
 * Dates in this app are calendar days held at UTC midnight (see time.ts), so
 * every reading below is UTC. Asking the server what day it is locally is the
 * bug this whole module's callers used to have.
 */
function isoWeekdayOf(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** Capitalises the first letter only -- Spanish names are lowercase mid-sentence. */
function leading(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "28 July" · "28 de julio" */
export function formatDayMonth(date: Date, locale: Locale): string {
  return translate(
    DICTIONARIES[locale],
    "dates.dayMonth",
    date.getUTCDate(),
    monthLabel(locale, date.getUTCMonth() + 1),
  );
}

/**
 * "Tuesday, 28 July" · "Martes, 28 de julio"
 *
 * The weekday leads a heading, so it takes a capital even in Spanish. The
 * month never does.
 */
export function formatLongDate(date: Date, locale: Locale): string {
  return translate(
    DICTIONARIES[locale],
    "dates.longDate",
    leading(weekdayLabel(locale, isoWeekdayOf(date))),
    formatDayMonth(date, locale),
  );
}

/** The `YYYY-MM-DD` keys the schedule passes around, as a UTC-midnight Date. */
export function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/** Weekday of a `YYYY-MM-DD` key. 1 = Monday. */
export function weekdayOfKey(key: string): number {
  return isoWeekdayOf(fromDateKey(key));
}
