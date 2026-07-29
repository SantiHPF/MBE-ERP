import { describe, expect, it } from "vitest";
import { elapsedSeconds, MAX_OPEN_SECONDS } from "./elapsed";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 27, h, m, 0));
/** Days later, for the timer nobody closed. */
const LATER = (days: number, h = 9) =>
  new Date(Date.UTC(2026, 6, 27 + days, h, 0, 0));

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

/**
 * A timer nobody closed. Nothing in the app ends an entry unless the person
 * starts something else, completes it or defers it, so an abandoned one used
 * to count for ever -- three days of "tracked time" against one task, which
 * went straight into the estimate drift on /me and the booked hours on /team.
 */
describe("an entry nobody closed", () => {
  it("stops counting instead of running for days", () => {
    const total = elapsedSeconds(
      [{ startedAt: T(17), endedAt: null, pauses: [] }],
      LATER(3),
    );
    expect(total).toBe(MAX_OPEN_SECONDS);
  });

  it("caps well above a real shift, so it never truncates real work", () => {
    // The longest split day here runs 09:00-20:00.
    const total = elapsedSeconds(
      [{ startedAt: T(9), endedAt: null, pauses: [] }],
      T(20),
    );
    expect(total).toBe(11 * 3600);
  });

  it("leaves a running task today alone -- the stopwatch still ticks", () => {
    const total = elapsedSeconds(
      [{ startedAt: T(9), endedAt: null, pauses: [] }],
      T(9, 30),
    );
    expect(total).toBe(1800);
  });

  it("does not let an open pause on a capped entry go negative", () => {
    // Paused an hour in and never resumed, then abandoned for days: the
    // pause must not be measured against `now` while the entry is capped, or
    // it subtracts more than the entry holds.
    const total = elapsedSeconds(
      [
        {
          startedAt: T(9),
          endedAt: null,
          pauses: [{ pausedAt: T(10), resumedAt: null }],
        },
      ],
      LATER(3),
    );
    expect(total).toBe(3600);
  });

  it("closes a finished entry on its own end, cap or no cap", () => {
    const total = elapsedSeconds(
      [{ startedAt: T(9), endedAt: T(11), pauses: [] }],
      LATER(3),
    );
    expect(total).toBe(2 * 3600);
  });
});
