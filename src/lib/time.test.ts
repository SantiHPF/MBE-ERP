import { describe, expect, it } from "vitest";
import { dateKey, today, todayKey } from "./time";

/**
 * The bug these cover: every "today" used to come from UTC, so between
 * midnight and 02:00 Madrid time the whole app was a day behind -- My Day
 * showed yesterday's tasks and a late shift filed its work against the wrong
 * date.
 */
describe("todayKey", () => {
  it("uses the schedule's zone, not UTC", () => {
    // 23:30 UTC on the 28th is already 01:30 on the 29th in Madrid (CEST).
    const instant = new Date("2026-07-28T23:30:00Z");

    expect(todayKey(instant, "Europe/Madrid")).toBe("2026-07-29");
    expect(todayKey(instant, "UTC")).toBe("2026-07-28");
  });

  it("handles winter, when Madrid is only one hour ahead", () => {
    // 23:30 UTC in January is 00:30 the next day in Madrid (CET).
    const instant = new Date("2026-01-15T23:30:00Z");

    expect(todayKey(instant, "Europe/Madrid")).toBe("2026-01-16");
    expect(todayKey(instant, "UTC")).toBe("2026-01-15");
  });

  it("agrees with UTC during the working day", () => {
    const instant = new Date("2026-07-28T09:00:00Z");

    expect(todayKey(instant, "Europe/Madrid")).toBe("2026-07-28");
    expect(todayKey(instant, "UTC")).toBe("2026-07-28");
  });

  it("works for zones behind UTC too", () => {
    // 02:00 UTC on the 29th is still the evening of the 28th in New York.
    const instant = new Date("2026-07-29T02:00:00Z");

    expect(todayKey(instant, "America/New_York")).toBe("2026-07-28");
  });
});

describe("today", () => {
  it("returns a date-only Date matching todayKey", () => {
    const instant = new Date("2026-07-28T23:30:00Z");
    const day = today(instant, "Europe/Madrid");

    expect(dateKey(day)).toBe("2026-07-29");
    expect(day.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });
});
