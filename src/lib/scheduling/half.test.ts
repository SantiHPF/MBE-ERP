import { describe, it, expect } from "vitest";
import {
  anchorFallbackWindows,
  anchorHalf,
  halfWindows,
  intersect,
  SHIFT_SPLIT_MINUTES,
} from "./half";

const at = (h: number, m = 0) => h * 60 + m;

/** 09:00-14:00 and 16:00-19:00 -- the shape the working patterns here use. */
const SPLIT = [
  { start: at(9), end: at(14) },
  { start: at(16), end: at(19) },
];

/** 09:00-17:00, nobody's break positioned. */
const UNBROKEN = [{ start: at(9), end: at(17) }];

describe("halfWindows", () => {
  it("splits a broken day at the company's line", () => {
    expect(halfWindows(SPLIT, "MORNING")).toEqual([
      { start: at(9), end: at(14) },
    ]);
    expect(halfWindows(SPLIT, "AFTERNOON")).toEqual([
      { start: at(16), end: at(19) },
    ]);
  });

  it("splits an unbroken day just the same", () => {
    // The whole point of using a clock time rather than the break: somebody
    // who takes no break still has a morning and an afternoon.
    expect(halfWindows(UNBROKEN, "MORNING")).toEqual([
      { start: at(9), end: at(14) },
    ]);
    expect(halfWindows(UNBROKEN, "AFTERNOON")).toEqual([
      { start: at(14), end: at(17) },
    ]);
  });

  it("cuts a window that straddles the line", () => {
    const straddling = [{ start: at(13), end: at(15) }];
    expect(halfWindows(straddling, "MORNING")).toEqual([
      { start: at(13), end: SHIFT_SPLIT_MINUTES },
    ]);
    expect(halfWindows(straddling, "AFTERNOON")).toEqual([
      { start: SHIFT_SPLIT_MINUTES, end: at(15) },
    ]);
  });

  it("gives nothing when the day is entirely the other side", () => {
    const lateShift = [{ start: at(16), end: at(20) }];
    expect(halfWindows(lateShift, "MORNING")).toEqual([]);
  });
});

describe("anchorHalf", () => {
  it("puts arrival and before-the-break in the morning", () => {
    expect(anchorHalf("ARRIVAL")).toBe("MORNING");
    expect(anchorHalf("BEFORE_BREAK")).toBe("MORNING");
  });

  it("puts after-the-break and before-leaving in the afternoon", () => {
    expect(anchorHalf("AFTER_BREAK")).toBe("AFTERNOON");
    expect(anchorHalf("BEFORE_LEAVING")).toBe("AFTERNOON");
  });
});

describe("anchorFallbackWindows", () => {
  it("keeps a missed afternoon anchor out of the morning", () => {
    // The regression: "antes de salir" was landing at 10:00.
    expect(anchorFallbackWindows(SPLIT, "BEFORE_LEAVING")).toEqual([
      { start: at(16), end: at(19) },
    ]);
  });

  it("keeps a missed morning anchor out of the afternoon", () => {
    expect(anchorFallbackWindows(SPLIT, "ARRIVAL")).toEqual([
      { start: at(9), end: at(14) },
    ]);
  });

  it("follows the person's own break, not the clock", () => {
    // An early break at 11:00: "after the break" means after theirs.
    const early = [
      { start: at(8), end: at(11) },
      { start: at(12), end: at(16) },
    ];
    expect(anchorFallbackWindows(early, "AFTER_BREAK")).toEqual([
      { start: at(12), end: at(16) },
    ]);
  });

  it("falls back within the only window when there is no break", () => {
    // Nowhere else to go, and refusing outright would drop work for no reason.
    expect(anchorFallbackWindows(UNBROKEN, "BEFORE_LEAVING")).toEqual(UNBROKEN);
  });

  it("copes with a day that has no windows at all", () => {
    expect(anchorFallbackWindows([], "ARRIVAL")).toEqual([]);
  });
});

describe("intersect", () => {
  it("keeps only what is in both", () => {
    const free = [
      { start: at(9), end: at(10) },
      { start: at(13), end: at(17) },
    ];
    expect(intersect(free, halfWindows(SPLIT, "AFTERNOON"))).toEqual([
      { start: at(16), end: at(17) },
    ]);
  });

  it("gives nothing when they do not overlap", () => {
    expect(intersect([{ start: at(9), end: at(10) }], [{ start: at(16), end: at(19) }]))
      .toEqual([]);
  });
});
