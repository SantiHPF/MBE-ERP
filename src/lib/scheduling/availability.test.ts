import { describe, expect, it } from "vitest";
import {
  anchorPacksBackward,
  computeAvailability,
  findLastSlot,
  findSlot,
  resolveAnchor,
  slotOverlapsAbsence,
  type PatternInput,
} from "./availability";

// 2026-07-27 is a Monday, so these line up with ISO weekdays 1-5.
const MON = new Date(Date.UTC(2026, 6, 27));
const TUE = new Date(Date.UTC(2026, 6, 28));
const THU = new Date(Date.UTC(2026, 6, 30));
const FRI = new Date(Date.UTC(2026, 6, 31));

const at = (h: number, m = 0) => h * 60 + m;

/** Mon-Thu 09:00-18:00 with an hour at 13:00; Friday stops at 14:00. */
const SHORT_FRIDAY: PatternInput[] = [
  { weekday: 1, startMinutes: at(9), endMinutes: at(18), breakMinutes: 60, breakStartMinutes: at(13) },
  { weekday: 2, startMinutes: at(9), endMinutes: at(18), breakMinutes: 60, breakStartMinutes: at(13) },
  { weekday: 3, startMinutes: at(9), endMinutes: at(18), breakMinutes: 60, breakStartMinutes: at(13) },
  { weekday: 4, startMinutes: at(9), endMinutes: at(18), breakMinutes: 60, breakStartMinutes: at(13) },
  { weekday: 5, startMinutes: at(9), endMinutes: at(14), breakMinutes: 0 },
];

describe("computeAvailability", () => {
  it("gives a full day 8 working hours once lunch is carved out", () => {
    const result = computeAvailability({ date: MON, patterns: SHORT_FRIDAY });

    expect(result.rostered).toBe(true);
    expect(result.availableMinutes).toBe(480);
    // Lunch splits the day, so there are two windows, not one.
    expect(result.windows).toEqual([
      { start: at(9), end: at(13) },
      { start: at(14), end: at(18) },
    ]);
  });

  it("gives less on a short Friday than on a normal weekday", () => {
    const monday = computeAvailability({ date: MON, patterns: SHORT_FRIDAY });
    const friday = computeAvailability({ date: FRI, patterns: SHORT_FRIDAY });

    expect(friday.availableMinutes).toBe(300);
    expect(friday.availableMinutes).toBeLessThan(monday.availableMinutes);
    expect(friday.windows).toEqual([{ start: at(9), end: at(14) }]);
  });

  it("treats a weekday with no pattern as not working", () => {
    const threeDayWeek: PatternInput[] = [
      { weekday: 1, startMinutes: at(9), endMinutes: at(15), breakMinutes: 0 },
      { weekday: 3, startMinutes: at(9), endMinutes: at(15), breakMinutes: 0 },
      { weekday: 5, startMinutes: at(9), endMinutes: at(15), breakMinutes: 0 },
    ];

    const tuesday = computeAvailability({ date: TUE, patterns: threeDayWeek });

    expect(tuesday.rostered).toBe(false);
    expect(tuesday.availableMinutes).toBe(0);
    expect(tuesday.windows).toEqual([]);
  });

  it("subtracts an unpositioned break from the end of the day", () => {
    const patterns: PatternInput[] = [
      { weekday: 1, startMinutes: at(9), endMinutes: at(17), breakMinutes: 45 },
    ];

    const result = computeAvailability({ date: MON, patterns });

    expect(result.availableMinutes).toBe(435);
    expect(result.windows).toEqual([{ start: at(9), end: at(16, 15) }]);
  });

  describe("day overrides", () => {
    it("replaces the weekday pattern entirely", () => {
      const result = computeAvailability({
        date: MON,
        patterns: SHORT_FRIDAY,
        overrides: [
          { date: MON, startMinutes: at(11), endMinutes: at(15), breakMinutes: 0 },
        ],
      });

      expect(result.availableMinutes).toBe(240);
      expect(result.windows).toEqual([{ start: at(11), end: at(15) }]);
      expect(result.reducedBy).toBe("override");
    });

    it("only applies on its own date", () => {
      const result = computeAvailability({
        date: TUE,
        patterns: SHORT_FRIDAY,
        overrides: [
          { date: MON, startMinutes: at(11), endMinutes: at(15), breakMinutes: 0 },
        ],
      });

      expect(result.availableMinutes).toBe(480);
      expect(result.reducedBy).toBe("none");
    });
  });

  describe("absences", () => {
    it("a full-day absence leaves no capacity at all", () => {
      const result = computeAvailability({
        date: THU,
        patterns: SHORT_FRIDAY,
        absences: [
          { startDate: THU, endDate: THU, scope: "FULL_DAY" },
        ],
      });

      // Still rostered -- they were meant to be here. They just aren't.
      expect(result.rostered).toBe(true);
      expect(result.availableMinutes).toBe(0);
      expect(result.windows).toEqual([]);
      expect(result.reducedBy).toBe("absence");
    });

    it("a partial absence removes only the hours it covers", () => {
      const result = computeAvailability({
        date: MON,
        patterns: SHORT_FRIDAY,
        absences: [
          {
            startDate: MON,
            endDate: MON,
            scope: "PARTIAL",
            startMinutes: at(14),
            endMinutes: at(18),
          },
        ],
      });

      // Morning survives; the afternoon is gone.
      expect(result.windows).toEqual([{ start: at(9), end: at(13) }]);
      expect(result.availableMinutes).toBe(240);
      expect(result.reducedBy).toBe("absence");
    });

    it("a partial absence in the middle splits the day", () => {
      const patterns: PatternInput[] = [
        { weekday: 1, startMinutes: at(9), endMinutes: at(17), breakMinutes: 0 },
      ];

      const result = computeAvailability({
        date: MON,
        patterns,
        absences: [
          {
            startDate: MON,
            endDate: MON,
            scope: "PARTIAL",
            startMinutes: at(11),
            endMinutes: at(12),
          },
        ],
      });

      expect(result.windows).toEqual([
        { start: at(9), end: at(11) },
        { start: at(12), end: at(17) },
      ]);
      expect(result.availableMinutes).toBe(420);
    });

    it("applies across a multi-day absence range", () => {
      const holiday = {
        startDate: MON,
        endDate: FRI,
        scope: "FULL_DAY" as const,
      };

      for (const day of [MON, TUE, THU, FRI]) {
        const result = computeAvailability({
          date: day,
          patterns: SHORT_FRIDAY,
          absences: [holiday],
        });
        expect(result.availableMinutes).toBe(0);
      }
    });

    it("ignores absences that fall outside the date", () => {
      const result = computeAvailability({
        date: MON,
        patterns: SHORT_FRIDAY,
        absences: [
          { startDate: THU, endDate: THU, scope: "FULL_DAY" },
        ],
      });

      expect(result.availableMinutes).toBe(480);
      expect(result.reducedBy).toBe("none");
    });

    it("reports when both an override and an absence cut the day down", () => {
      const result = computeAvailability({
        date: MON,
        patterns: SHORT_FRIDAY,
        overrides: [
          { date: MON, startMinutes: at(9), endMinutes: at(17), breakMinutes: 0 },
        ],
        absences: [
          {
            startDate: MON,
            endDate: MON,
            scope: "PARTIAL",
            startMinutes: at(15),
            endMinutes: at(17),
          },
        ],
      });

      expect(result.availableMinutes).toBe(360);
      expect(result.reducedBy).toBe("override+absence");
    });
  });
});

describe("findSlot", () => {
  const windows = [
    { start: at(9), end: at(13) },
    { start: at(14), end: at(18) },
  ];

  it("returns the earliest window that fits", () => {
    expect(findSlot(windows, 90)).toEqual({ start: at(9), end: at(10, 30) });
  });

  it("skips a window too small and uses the next one", () => {
    const tight = [
      { start: at(9), end: at(9, 30) },
      { start: at(14), end: at(18) },
    ];
    expect(findSlot(tight, 60)).toEqual({ start: at(14), end: at(15) });
  });

  it("returns null when nothing can hold it", () => {
    expect(findSlot(windows, 300)).toBeNull();
  });

  it("respects an earliest-start constraint", () => {
    expect(findSlot(windows, 60, at(11))).toEqual({ start: at(11), end: at(12) });
  });
});

describe("slotOverlapsAbsence", () => {
  const morning = { start: at(9), end: at(11) };
  const afternoon = { start: at(15), end: at(16) };

  it("a full-day absence hits every slot", () => {
    const absence = { startDate: MON, endDate: MON, scope: "FULL_DAY" as const };
    expect(slotOverlapsAbsence(morning, absence, MON)).toBe(true);
    expect(slotOverlapsAbsence(afternoon, absence, MON)).toBe(true);
  });

  it("an afternoon absence leaves the morning alone", () => {
    const absence = {
      startDate: MON,
      endDate: MON,
      scope: "PARTIAL" as const,
      startMinutes: at(14),
      endMinutes: at(18),
    };

    expect(slotOverlapsAbsence(morning, absence, MON)).toBe(false);
    expect(slotOverlapsAbsence(afternoon, absence, MON)).toBe(true);
  });

  it("a slot that merely touches the absence boundary does not overlap", () => {
    const absence = {
      startDate: MON,
      endDate: MON,
      scope: "PARTIAL" as const,
      startMinutes: at(11),
      endMinutes: at(14),
    };

    expect(slotOverlapsAbsence(morning, absence, MON)).toBe(false);
  });
});

/**
 * Anchors exist because "when I arrive" is a different clock time for every
 * person, so a check done at the start of every shift cannot be a fixed time.
 */
describe("resolveAnchor", () => {
  // 09:00-18:00 with an hour off at 13:00, so two windows.
  const split = [
    { start: at(9), end: at(13) },
    { start: at(14), end: at(18) },
  ];
  // 09:00-17:00 straight through -- an unpositioned break comes off the end.
  const straight = [{ start: at(9), end: at(17) }];

  it("puts arrival at the start of the day", () => {
    expect(resolveAnchor("ARRIVAL", split, 10)).toBe(at(9));
  });

  it("backs the before-break task off so it finishes by the break", () => {
    expect(resolveAnchor("BEFORE_BREAK", split, 10)).toBe(at(12, 50));
  });

  it("puts the after-break task at the moment they are back", () => {
    expect(resolveAnchor("AFTER_BREAK", split, 10)).toBe(at(14));
  });

  it("backs the leaving task off so it finishes by the end of the shift", () => {
    expect(resolveAnchor("BEFORE_LEAVING", split, 10)).toBe(at(17, 50));
  });

  it("has no break anchors for somebody working straight through", () => {
    // The caller places these flexibly rather than dropping the task.
    expect(resolveAnchor("BEFORE_BREAK", straight, 10)).toBeNull();
    expect(resolveAnchor("AFTER_BREAK", straight, 10)).toBeNull();
  });

  it("still has arrival and leaving on a single-window day", () => {
    expect(resolveAnchor("ARRIVAL", straight, 10)).toBe(at(9));
    expect(resolveAnchor("BEFORE_LEAVING", straight, 10)).toBe(at(16, 50));
  });

  it("never backs a task off past the start of its own window", () => {
    // A two-hour task in a one-hour window starts when the window does and
    // simply runs over, rather than being scheduled before they arrive.
    expect(resolveAnchor("BEFORE_LEAVING", [{ start: at(9), end: at(10) }], 120))
      .toBe(at(9));
  });

  it("resolves nothing on a day with no windows at all", () => {
    expect(resolveAnchor("ARRIVAL", [], 10)).toBeNull();
  });

  it("gives two people on different shifts their own arrival", () => {
    const early = [{ start: at(8), end: at(16) }];
    const late = [{ start: at(10), end: at(18) }];

    expect(resolveAnchor("ARRIVAL", early, 10)).toBe(at(8));
    expect(resolveAnchor("ARRIVAL", late, 10)).toBe(at(10));
  });
});

describe("findLastSlot", () => {
  const morning = [{ start: at(9), end: at(14) }];
  const day = [
    { start: at(9), end: at(14) },
    { start: at(16), end: at(19) },
  ];

  it("puts a task up against the end of the window", () => {
    expect(findLastSlot(morning, 30)).toEqual({ start: at(13, 30), end: at(14) });
  });

  it("stacks a second task immediately before the first", () => {
    // 13:30-14:00 is gone, so the next one wants 13:00-13:30 -- not 09:00.
    const left = [{ start: at(9), end: at(13, 30) }];
    expect(findLastSlot(left, 30)).toEqual({ start: at(13), end: at(13, 30) });
  });

  it("uses the latest window, not the first that fits", () => {
    expect(findLastSlot(day, 30)).toEqual({ start: at(18, 30), end: at(19) });
  });

  it("stops at notAfter rather than running past it", () => {
    expect(findLastSlot(day, 30, at(17))).toEqual({
      start: at(16, 30),
      end: at(17),
    });
  });

  it("honours notBefore, so work pushed later is not packed back past it", () => {
    expect(findLastSlot(morning, 30, Infinity, at(13, 45))).toBeNull();
  });

  it("returns null when nothing is long enough", () => {
    expect(findLastSlot([{ start: at(9), end: at(9, 20) }], 30)).toBeNull();
  });

  it("returns null on a day with no windows at all", () => {
    expect(findLastSlot([], 30)).toBeNull();
  });
});

describe("anchorPacksBackward", () => {
  it("treats the two deadline anchors as backwards", () => {
    expect(anchorPacksBackward("BEFORE_BREAK")).toBe(true);
    expect(anchorPacksBackward("BEFORE_LEAVING")).toBe(true);
  });

  it("treats the two starting guns as forwards", () => {
    expect(anchorPacksBackward("ARRIVAL")).toBe(false);
    expect(anchorPacksBackward("AFTER_BREAK")).toBe(false);
  });
});
