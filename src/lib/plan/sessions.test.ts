import { describe, it, expect } from "vitest";
import {
  DEFAULT_SESSION_MINUTES,
  MAX_SESSIONS,
  planRepeatableSessions,
  planSessions,
  rollUp,
  spreadSessions,
  type DayCapacity,
  type SessionRow,
} from "./sessions";

const at = (h: number, m = 0) => h * 60 + m;

/** A standard day: 09:00-13:00 and 15:00-18:00 around a positioned break. */
function day(date: Date, ...free: [number, number][]): DayCapacity {
  return {
    date,
    free: free.length
      ? free.map(([start, end]) => ({ start, end }))
      : [
          { start: at(9), end: at(13) },
          { start: at(15), end: at(18) },
        ],
  };
}

const MON = new Date(Date.UTC(2026, 6, 27));
const TUE = new Date(Date.UTC(2026, 6, 28));
const WED = new Date(Date.UTC(2026, 6, 29));

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s",
    status: "ASSIGNED",
    estimatedMinutes: 150,
    elapsedSeconds: 0,
    scheduledDate: "2026-07-27",
    sessionIndex: 1,
    ...over,
  };
}

describe("planSessions", () => {
  it("leaves a task that fits one sitting alone", () => {
    expect(planSessions(90)).toEqual([]);
  });

  it("does not split a task exactly one sitting long", () => {
    expect(planSessions(DEFAULT_SESSION_MINUTES)).toEqual([]);
  });

  it("splits ten hours into four sittings of the same length", () => {
    expect(planSessions(600)).toEqual([150, 150, 150, 150]);
  });

  it("spreads the remainder rather than leaving a stub at the end", () => {
    // Greedy chunking would give [180, 20], and that 20 is a hole somebody's
    // day has to be built around for no reason.
    expect(planSessions(200)).toEqual([100, 100]);
  });

  it("always adds up to exactly the original estimate", () => {
    for (const total of [601, 437, 1000, 181, 999]) {
      const parts = planSessions(total);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("gives the odd minutes to the earliest sittings", () => {
    expect(planSessions(601)).toEqual([151, 150, 150, 150]);
  });

  it("stops at the cap rather than filling a day with ten-minute rows", () => {
    const parts = planSessions(3000);
    expect(parts).toHaveLength(MAX_SESSIONS);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(3000);
  });

  it("honours a chunk size set on the catalogue entry", () => {
    expect(planSessions(600, 120)).toEqual([120, 120, 120, 120, 120]);
  });
});

describe("planRepeatableSessions", () => {
  it("leaves a batch that fits one sitting alone", () => {
    expect(planRepeatableSessions(8, 15)).toEqual([]);
  });

  it("never cuts a single go in half", () => {
    // 40 calls at 15 minutes is 10 hours. Every sitting is whole calls.
    const parts = planRepeatableSessions(40, 15);
    expect(parts).toEqual([
      { goes: 10, minutes: 150 },
      { goes: 10, minutes: 150 },
      { goes: 10, minutes: 150 },
      { goes: 10, minutes: 150 },
    ]);
  });

  it("gives the odd goes to the earliest sittings", () => {
    const parts = planRepeatableSessions(41, 15);
    expect(parts.map((p) => p.goes)).toEqual([11, 10, 10, 10]);
    expect(parts.reduce((sum, p) => sum + p.goes, 0)).toBe(41);
  });

  it("makes each sitting one go when a single go is longer than a sitting", () => {
    const parts = planRepeatableSessions(3, 200);
    expect(parts.map((p) => p.goes)).toEqual([1, 1, 1]);
  });
});

describe("spreadSessions", () => {
  it("puts the first sitting in the first free window", () => {
    const [first] = spreadSessions({ sessions: [150], days: [day(MON)] });
    expect(first.date).toBe(MON);
    expect(first.start).toBe(at(9));
    expect(first.end).toBe(at(11, 30));
  });

  it("puts a second sitting after the first on the same day when there is room", () => {
    const out = spreadSessions({ sessions: [120, 60], days: [day(MON)] });
    expect(out.map((s) => s.start)).toEqual([at(9), at(11)]);
    expect(out.every((s) => s.date === MON)).toBe(true);
  });

  it("carries on to the next day once the day is full", () => {
    // 4h + 3h fills Monday exactly; the third sitting has to go to Tuesday.
    const out = spreadSessions({
      sessions: [240, 180, 60],
      days: [day(MON), day(TUE)],
    });
    expect(out.map((s) => s.date)).toEqual([MON, MON, TUE]);
  });

  it("never places a sitting earlier than the one before it", () => {
    // Monday has a late hole the cursor has already passed by the time the
    // second sitting is placed. Using it would make the day read 1, 3, 2, and
    // blockingTask() would then refuse to let anyone start any of it.
    const out = spreadSessions({
      sessions: [200, 30],
      days: [day(MON, [at(9), at(13)], [at(15), at(18)])],
    });
    expect(out[0].start).toBe(at(9));
    expect(out[1].start).toBeGreaterThanOrEqual(out[0].end!);
  });

  it("skips a day with no working hours", () => {
    // A weekend, or a full-day absence: no windows at all.
    const off: DayCapacity = { date: MON, free: [] };
    const out = spreadSessions({ sessions: [150], days: [off, day(TUE)] });
    expect(out[0].date).toBe(TUE);
  });

  it("leaves a sitting unplaced rather than pushing it past the due date", () => {
    // One day, and two sittings that cannot both fit in it.
    const out = spreadSessions({
      sessions: [240, 180, 240],
      days: [day(MON)],
    });
    expect(out[2].date).toBeNull();
    expect(out[2].start).toBeNull();
  });

  it("keeps looking for a later, shorter sitting after one that would not fit", () => {
    // The 300 fits nowhere; the 60 after it still should.
    const out = spreadSessions({ sessions: [300, 60], days: [day(MON)] });
    expect(out[0].date).toBeNull();
    expect(out[1].date).toBe(MON);
  });

  it("starts no earlier than notBefore on the first day", () => {
    const out = spreadSessions({
      sessions: [60],
      days: [day(MON)],
      notBefore: at(11),
    });
    expect(out[0].start).toBe(at(11));
  });

  it("does not use time the caller has already booked", () => {
    // The morning is gone; only the afternoon window is offered.
    const out = spreadSessions({
      sessions: [120],
      days: [day(MON, [at(15), at(18)])],
    });
    expect(out[0].start).toBe(at(15));
  });

  it("does not shorten the windows it was handed", () => {
    const days = [day(MON)];
    const before = JSON.stringify(days[0].free);
    spreadSessions({ sessions: [150, 150], days });
    expect(JSON.stringify(days[0].free)).toBe(before);
  });

  it("spreads a ten-hour job across three days", () => {
    const out = spreadSessions({
      sessions: [150, 150, 150, 150],
      days: [day(MON), day(TUE), day(WED)],
    });
    expect(out.every((s) => s.date !== null)).toBe(true);
    expect(new Set(out.map((s) => s.date)).size).toBeLessThanOrEqual(3);
  });
});

describe("rollUp", () => {
  it("counts a finished sitting as done", () => {
    const p = rollUp([
      session({ id: "1", sessionIndex: 1, status: "DONE" }),
      session({ id: "2", sessionIndex: 2 }),
    ]);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
  });

  it("counts a sitting that has overrun as zero left, not as negative", () => {
    const p = rollUp([
      session({ estimatedMinutes: 150, elapsedSeconds: 200 * 60 }),
    ]);
    expect(p.remainingMinutes).toBe(0);
  });

  it("takes tracked time off what is still owed", () => {
    const p = rollUp([
      session({ estimatedMinutes: 150, elapsedSeconds: 30 * 60 }),
    ]);
    expect(p.remainingMinutes).toBe(120);
  });

  it("adds the elapsed time of every sitting", () => {
    const p = rollUp([
      session({ id: "1", sessionIndex: 1, status: "DONE", elapsedSeconds: 600 }),
      session({ id: "2", sessionIndex: 2, elapsedSeconds: 300 }),
    ]);
    expect(p.elapsedSeconds).toBe(900);
  });

  it("reports the day of the next unfinished sitting", () => {
    const p = rollUp([
      session({
        id: "1",
        sessionIndex: 1,
        status: "DONE",
        scheduledDate: "2026-07-27",
      }),
      session({ id: "2", sessionIndex: 2, scheduledDate: "2026-07-28" }),
      session({ id: "3", sessionIndex: 3, scheduledDate: "2026-07-29" }),
    ]);
    expect(p.nextDate).toBe("2026-07-28");
  });

  it("says the job is done only when every sitting is", () => {
    const two = [
      session({ id: "1", sessionIndex: 1, status: "DONE" }),
      session({ id: "2", sessionIndex: 2, status: "DONE" }),
    ];
    expect(rollUp(two).allDone).toBe(true);
    expect(rollUp([...two, session({ id: "3", sessionIndex: 3 })]).allDone).toBe(
      false,
    );
  });

  it("treats a cancelled sitting as settled rather than owed", () => {
    // Finishing the whole job in three sittings cancels the fourth. The job is
    // done, and the fourth is not still owed.
    const p = rollUp([
      session({ id: "1", sessionIndex: 1, status: "DONE" }),
      session({ id: "2", sessionIndex: 2, status: "DONE" }),
      session({ id: "3", sessionIndex: 3, status: "CANCELLED" }),
    ]);
    expect(p.allDone).toBe(true);
    expect(p.total).toBe(2);
    expect(p.remainingMinutes).toBe(0);
  });

  it("does not call a job with nothing left in it done", () => {
    expect(rollUp([]).allDone).toBe(false);
  });
});
