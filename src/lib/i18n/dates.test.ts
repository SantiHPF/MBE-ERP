import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "./dictionary";
import {
  formatDayMonth,
  formatLongDate,
  fromDateKey,
  localeTag,
  monthLabel,
  weekdayLabel,
  weekdayOfKey,
} from "./dates";

/** 2026-07-28 is a Tuesday. */
const TUESDAY = fromDateKey("2026-07-28");

describe("weekdayLabel", () => {
  it("starts the week on Monday, matching isoWeekday()", () => {
    expect(weekdayLabel("EN", 1)).toBe("Monday");
    expect(weekdayLabel("ES", 1)).toBe("lunes");
    expect(weekdayLabel("EN", 7)).toBe("Sunday");
    expect(weekdayLabel("ES", 7)).toBe("domingo");
  });

  it("has a short form for table headers", () => {
    expect(weekdayLabel("EN", 3, "short")).toBe("Wed");
    expect(weekdayLabel("ES", 3, "short")).toBe("mié");
  });

  it("does not throw on a weekday out of range", () => {
    expect(weekdayLabel("EN", 0)).toBe("0");
    expect(weekdayLabel("ES", 8)).toBe("8");
  });
});

describe("the name lists", () => {
  // Nothing else notices a missing name until a Sunday column renders blank.
  it.each(["EN", "ES"] as const)("%s has seven days and twelve months", (l) => {
    expect(DICTIONARIES[l].dates.weekdaysLong).toHaveLength(7);
    expect(DICTIONARIES[l].dates.weekdaysShort).toHaveLength(7);
    expect(DICTIONARIES[l].dates.monthsLong).toHaveLength(12);
  });

  it.each(["EN", "ES"] as const)("%s has no blank name", (l) => {
    const all = [
      ...DICTIONARIES[l].dates.weekdaysLong,
      ...DICTIONARIES[l].dates.weekdaysShort,
      ...DICTIONARIES[l].dates.monthsLong,
    ];
    expect(all.filter((name) => name.trim() === "")).toEqual([]);
  });

  it("keeps Spanish lowercase, so it reads correctly mid-sentence", () => {
    for (const name of DICTIONARIES.ES.dates.weekdaysLong) {
      expect(name).toBe(name.toLowerCase());
    }
    for (const name of DICTIONARIES.ES.dates.monthsLong) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe("formatDayMonth", () => {
  it("puts the 'de' in for Spanish and leaves it out of English", () => {
    expect(formatDayMonth(TUESDAY, "EN")).toBe("28 July");
    expect(formatDayMonth(TUESDAY, "ES")).toBe("28 de julio");
  });

  it("reads the date in UTC, where calendar days are stored", () => {
    // 23:30 UTC on the 31st is the 1st in Madrid, but the stored day is the
    // 31st and that is what has to be shown.
    expect(formatDayMonth(new Date("2026-12-31T23:30:00Z"), "EN")).toBe(
      "31 December",
    );
  });
});

describe("formatLongDate", () => {
  it("capitalises the weekday that leads the heading", () => {
    expect(formatLongDate(TUESDAY, "EN")).toBe("Tuesday, 28 July");
    expect(formatLongDate(TUESDAY, "ES")).toBe("Martes, 28 de julio");
  });

  it("does not capitalise the month, which never leads", () => {
    expect(formatLongDate(TUESDAY, "ES")).toContain("de julio");
  });
});

describe("weekdayOfKey", () => {
  it("agrees with the ISO numbering used by the scheduler", () => {
    expect(weekdayOfKey("2026-07-27")).toBe(1); // Monday
    expect(weekdayOfKey("2026-07-28")).toBe(2);
    expect(weekdayOfKey("2026-08-02")).toBe(7); // Sunday
  });
});

describe("localeTag", () => {
  it("is only used for number grouping", () => {
    // Spanish groups from five digits up, not four -- 1234 stays "1234".
    expect((12345).toLocaleString(localeTag("EN"))).toBe("12,345");
    expect((12345).toLocaleString(localeTag("ES"))).toBe("12.345");
  });
});

describe("monthLabel", () => {
  it("is one-based", () => {
    expect(monthLabel("EN", 1)).toBe("January");
    expect(monthLabel("ES", 12)).toBe("diciembre");
  });
});
