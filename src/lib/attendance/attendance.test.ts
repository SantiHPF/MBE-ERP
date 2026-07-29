import { describe, expect, it } from "vitest";
import {
  atMinutes,
  closeAbandoned,
  NO_SIGNALS,
  presentMinutes,
  resolveArrival,
  resolveDeparture,
  rosteredEndMinutes,
  warmUpMinutes,
  type Signals,
} from "./attendance";

const DAY = new Date(Date.UTC(2026, 6, 28));
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 28, h, m, 0));
/** A normal 09:00-18:00 with an hour for lunch. */
const SHIFT = [
  { start: 9 * 60, end: 14 * 60 },
  { start: 15 * 60, end: 18 * 60 },
];

function signals(over: Partial<Signals> = {}): Signals {
  return { ...NO_SIGNALS, ...over };
}

describe("resolveArrival", () => {
  it("takes the earliest signal", () => {
    const result = resolveArrival(
      signals({ firstLoginAt: at(8, 50), firstTaskStartAt: at(9, 40) }),
    );
    expect(result).toEqual({ at: at(8, 50), source: "LOGIN" });
  });

  it("clocks in on the first task when there was no login today", () => {
    // Their session cookie is still valid from yesterday, so login never
    // fires. Without this the day would have no start at all.
    const result = resolveArrival(signals({ firstTaskStartAt: at(9, 5) }));
    expect(result).toEqual({ at: at(9, 5), source: "TASK_START" });
  });

  it("is null when nothing happened", () => {
    expect(resolveArrival(signals())).toBeNull();
  });

  it("does not let a later login rewrite the morning", () => {
    // markArrival only ever fills a blank, so firstLoginAt is already the
    // first one; this pins the rule that earliest wins regardless.
    const result = resolveArrival(
      signals({ firstLoginAt: at(8, 50), firstTaskStartAt: at(8, 30) }),
    );
    expect(result?.at).toEqual(at(8, 30));
    expect(result?.source).toBe("TASK_START");
  });
});

describe("resolveDeparture", () => {
  it("closes on logout", () => {
    const result = resolveDeparture(signals({ logoutAt: at(18, 2) }));
    expect(result).toEqual({ at: at(18, 2), source: "LOGOUT" });
  });

  it("closes when the day is closed by hand", () => {
    const result = resolveDeparture(signals(), at(17, 45));
    expect(result).toEqual({ at: at(17, 45), source: "DAY_CLOSED" });
  });

  it("takes the later of the two, so logging out after closing still counts", () => {
    const result = resolveDeparture(signals({ logoutAt: at(18, 10) }), at(17, 45));
    expect(result).toEqual({ at: at(18, 10), source: "LOGOUT" });
  });

  /**
   * The important negative case. Finishing a task is not leaving -- there is
   * normally another one after it -- so a completion must not close the day.
   */
  it("does not close the day just because a task was finished", () => {
    const result = resolveDeparture(
      signals({ lastTaskEndAt: at(11, 30), lastActivityAt: at(11, 30) }),
    );
    expect(result).toBeNull();
  });
});

describe("closeAbandoned", () => {
  it("closes at the last real signal when that is inside the shift", () => {
    const result = closeAbandoned({
      date: DAY,
      startedAt: at(9),
      signals: signals({ firstLoginAt: at(9), lastActivityAt: at(15, 20) }),
      windows: SHIFT,
      zone: "UTC",
    });
    expect(result?.endedAt).toEqual(at(15, 20));
    expect(result?.endSource).toBe("AUTO_CLOSE");
    expect(result?.status).toBe("NEEDS_REVIEW");
  });

  it("caps a runaway timer at the end of the rostered day", () => {
    // Started something at 17:00 and never came back. Without the cap the
    // record would credit them until whenever the sweep happened to run.
    const result = closeAbandoned({
      date: DAY,
      startedAt: at(9),
      signals: signals({
        firstLoginAt: at(9),
        lastActivityAt: new Date(Date.UTC(2026, 6, 31, 9, 0, 0)),
      }),
      windows: SHIFT,
      zone: "UTC",
    });
    expect(result?.endedAt).toEqual(at(18));
  });

  it("never invents time when there is nothing to go on", () => {
    const result = closeAbandoned({
      date: DAY,
      startedAt: null,
      signals: signals(),
      windows: SHIFT,
      zone: "UTC",
    });
    expect(result).toBeNull();
  });

  it("falls back to the last signal when they were not rostered at all", () => {
    // Came in on a day off. There is no shift to cap against, so the only
    // honest answer is the last thing they actually did.
    const result = closeAbandoned({
      date: DAY,
      startedAt: at(10),
      signals: signals({ firstLoginAt: at(10), lastActivityAt: at(12, 30) }),
      windows: [],
      zone: "UTC",
    });
    expect(result?.endedAt).toEqual(at(12, 30));
  });

  it("never ends before it starts", () => {
    // Logged in after their shift had already finished. The cap would put the
    // end before the start, which the database CHECK rejects outright.
    const result = closeAbandoned({
      date: DAY,
      startedAt: at(19),
      signals: signals({ firstLoginAt: at(19), lastActivityAt: at(19, 30) }),
      windows: SHIFT,
      zone: "UTC",
    });
    expect(result?.endedAt).toEqual(at(19));
  });

  it("uses the login when it is the only signal there is", () => {
    const result = closeAbandoned({
      date: DAY,
      startedAt: at(9),
      signals: signals({ firstLoginAt: at(9) }),
      windows: SHIFT,
      zone: "UTC",
    });
    expect(result?.endedAt).toEqual(at(9));
  });
});

describe("rosteredEndMinutes", () => {
  it("is the end of the last stretch, not the first", () => {
    expect(rosteredEndMinutes(SHIFT)).toBe(18 * 60);
  });

  it("is null on a day off", () => {
    expect(rosteredEndMinutes([])).toBeNull();
  });
});

describe("atMinutes", () => {
  it("puts a minutes-from-midnight time on the right day", () => {
    expect(atMinutes(DAY, 9 * 60 + 30, "UTC")).toEqual(at(9, 30));
  });

  it("ignores any time already on the date it is given", () => {
    expect(atMinutes(at(23, 59), 9 * 60, "UTC")).toEqual(at(9));
  });

  /**
   * The bug the attendance table showed: a shift ending at 18:00 was read as
   * 18:00 UTC, so in Madrid the cap landed at 20:00 -- two hours after the
   * shift it was meant to enforce.
   */
  it("reads the time on the company's clock, not on UTC", () => {
    // Madrid is UTC+2 in July, so 18:00 there is 16:00 UTC.
    expect(atMinutes(DAY, 18 * 60, "Europe/Madrid").toISOString()).toBe(
      "2026-07-28T16:00:00.000Z",
    );
  });

  it("follows the zone across a DST change", () => {
    // Madrid is UTC+1 in January.
    const winter = new Date(Date.UTC(2026, 0, 14));
    expect(atMinutes(winter, 18 * 60, "Europe/Madrid").toISOString()).toBe(
      "2026-01-14T17:00:00.000Z",
    );
  });
});

describe("closeAbandoned across zones", () => {
  it("caps at the shift end on the company's clock", () => {
    const result = closeAbandoned({
      date: DAY,
      startedAt: at(7),
      signals: signals({ firstLoginAt: at(7), lastActivityAt: at(22) }),
      windows: SHIFT,
      zone: "Europe/Madrid",
    });
    // 18:00 Madrid, which is 16:00 UTC -- not 18:00 UTC.
    expect(result?.endedAt.toISOString()).toBe("2026-07-28T16:00:00.000Z");
  });
});

describe("presentMinutes", () => {
  it("measures the whole span, breaks included", () => {
    // Time present is not time worked; the lunch hour is still time here.
    expect(presentMinutes(at(9), at(18))).toBe(9 * 60);
  });

  it("has no answer while the day is still open", () => {
    expect(presentMinutes(at(9), null)).toBeNull();
  });
});

describe("warmUpMinutes", () => {
  it("shows the gap between arriving and starting work", () => {
    expect(warmUpMinutes(signals({ firstLoginAt: at(9), firstTaskStartAt: at(9, 40) }))).toBe(40);
  });

  it("is zero when work started first", () => {
    expect(warmUpMinutes(signals({ firstLoginAt: at(9, 5), firstTaskStartAt: at(9) }))).toBe(0);
  });

  it("is null without both ends", () => {
    expect(warmUpMinutes(signals({ firstLoginAt: at(9) }))).toBeNull();
  });
});
