import { describe, expect, it } from "vitest";
import { elapsedSeconds } from "./elapsed";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 27, h, m, 0));

describe("elapsedSeconds", () => {
  it("counts a finished stretch", () => {
    const total = elapsedSeconds([
      { startedAt: T(9), endedAt: T(10), pauses: [] },
    ]);
    expect(total).toBe(3600);
  });

  it("counts a running stretch up to now", () => {
    const total = elapsedSeconds(
      [{ startedAt: T(9), endedAt: null, pauses: [] }],
      T(9, 30),
    );
    expect(total).toBe(1800);
  });

  it("does not count time spent paused", () => {
    const total = elapsedSeconds([
      {
        startedAt: T(9),
        endedAt: T(12),
        pauses: [{ pausedAt: T(10), resumedAt: T(11) }],
      },
    ]);
    // Three hours wall clock, one of them paused.
    expect(total).toBe(2 * 3600);
  });

  it("stops the clock while still paused", () => {
    const total = elapsedSeconds(
      [
        {
          startedAt: T(9),
          endedAt: null,
          pauses: [{ pausedAt: T(10), resumedAt: null }],
        },
      ],
      T(14),
    );
    // Paused at 10:00 and never resumed, so it is stuck at one hour.
    expect(total).toBe(3600);
  });

  it("subtracts several pauses", () => {
    const total = elapsedSeconds([
      {
        startedAt: T(9),
        endedAt: T(17),
        pauses: [
          { pausedAt: T(10), resumedAt: T(10, 30) },
          { pausedAt: T(13), resumedAt: T(14) },
        ],
      },
    ]);
    expect(total).toBe(8 * 3600 - 90 * 60);
  });

  it("adds up work split across sittings", () => {
    const total = elapsedSeconds([
      { startedAt: T(9), endedAt: T(10), pauses: [] },
      { startedAt: T(14), endedAt: T(15, 30), pauses: [] },
    ]);
    expect(total).toBe(2.5 * 3600);
  });

  it("never goes negative on odd data", () => {
    const total = elapsedSeconds([
      {
        startedAt: T(9),
        endedAt: T(10),
        // A pause longer than the entry itself should floor at zero, not
        // subtract from other tasks' totals.
        pauses: [{ pausedAt: T(9), resumedAt: T(14) }],
      },
    ]);
    expect(total).toBe(0);
  });

  it("is zero for a task never started", () => {
    expect(elapsedSeconds([])).toBe(0);
  });
});
