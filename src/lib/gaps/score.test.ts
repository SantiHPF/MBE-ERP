import { describe, it, expect } from "vitest";
import type { Gap } from "./gap";
import {
  fitWeight,
  pickOffers,
  rankFillers,
  urgencyWeight,
  type Filler,
} from "./score";

const TODAY = new Date("2026-07-29T00:00:00Z");

function day(offset: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

/** One unbroken hour. */
const HOUR: Gap = {
  start: 600,
  end: 660,
  minutes: 60,
  segments: [{ start: 600, end: 660 }],
};

function filler(over: Partial<Filler> = {}): Filler {
  return {
    taskId: over.taskId ?? `task-${over.title ?? "x"}`,
    templateId: null,
    title: "Something",
    estimatedMinutes: 30,
    priority: "NORMAL",
    dueDate: TODAY,
    source: "unassigned",
    ...over,
  };
}

describe("urgencyWeight", () => {
  it("puts overdue work above anything a priority can say", () => {
    // 120 beats the 100 a MUST is worth, so overdue always surfaces.
    expect(urgencyWeight(day(-1), TODAY)).toBe(130);
    expect(urgencyWeight(day(-1), TODAY)).toBeGreaterThan(100);
  });

  it("gets worse by the day so nothing rots at the bottom of the list", () => {
    expect(urgencyWeight(day(-5), TODAY)).toBeGreaterThan(
      urgencyWeight(day(-2), TODAY),
    );
  });

  it("caps, because past a fortnight late the exact number says nothing", () => {
    expect(urgencyWeight(day(-30), TODAY)).toBe(200);
    expect(urgencyWeight(day(-90), TODAY)).toBe(200);
  });

  it("decreases monotonically across the coming week", () => {
    const week = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((d) =>
      urgencyWeight(day(d), TODAY),
    );
    for (let i = 1; i < week.length; i++) {
      expect(week[i]).toBeLessThanOrEqual(week[i - 1]);
    }
    expect(week[8]).toBe(0);
  });
});

describe("fitWeight", () => {
  it("rewards using the gap up rather than leaving a stub", () => {
    const segments = [{ start: 0, end: 60 }];
    expect(fitWeight(55, segments)).toBeGreaterThan(fitWeight(10, segments));
  });

  it("is never negative -- a small task is still a fine answer", () => {
    expect(fitWeight(1, [{ start: 0, end: 600 }])).toBe(0);
  });

  it("measures against the tightest stretch that can hold the job", () => {
    // 25 minutes fits both, but it fills the 30-minute stretch nearly exactly.
    const segments = [
      { start: 0, end: 240 },
      { start: 300, end: 330 },
    ];
    expect(fitWeight(25, segments)).toBe(30);
  });

  it("scores nothing when no stretch can hold it", () => {
    expect(fitWeight(90, [{ start: 0, end: 60 }])).toBe(0);
  });
});

describe("rankFillers", () => {
  it("drops anything that does not fit a contiguous stretch", () => {
    // 40 minutes free in total, but split into 20 and 20.
    const split: Gap = {
      start: 600,
      end: 700,
      minutes: 40,
      segments: [
        { start: 600, end: 620 },
        { start: 680, end: 700 },
      ],
    };
    const ranked = rankFillers(
      [filler({ taskId: "big", estimatedMinutes: 35 })],
      split,
      TODAY,
    );
    expect(ranked).toEqual([]);
  });

  it("clears today's debt before borrowing from tomorrow", () => {
    // The whole point of the tiers: tier beats score, every time.
    const ranked = rankFillers(
      [
        filler({ taskId: "mine", source: "pullForward", priority: "MUST" }),
        filler({ taskId: "owed", source: "unassigned", priority: "NORMAL" }),
      ],
      HOUR,
      TODAY,
    );
    expect(ranked.map((f) => f.taskId)).toEqual(["owed", "mine"]);
  });

  it("never offers filler while real work is unplaced", () => {
    const ranked = rankFillers(
      [
        filler({ taskId: "spare", source: "spare", priority: "SPARE_TIME" }),
        filler({ taskId: "orphan", source: "orphaned" }),
        filler({ taskId: "owed", source: "unassigned" }),
        filler({ taskId: "tomorrow", source: "pullForward" }),
      ],
      HOUR,
      TODAY,
    );
    expect(ranked.map((f) => f.taskId)).toEqual([
      "owed",
      "orphan",
      "tomorrow",
      "spare",
    ]);
  });

  it("puts a late NORMAL above a MUST due next week, inside a tier", () => {
    // What the Priority enum on its own cannot express.
    const ranked = rankFillers(
      [
        filler({ taskId: "later", priority: "MUST", dueDate: day(7) }),
        filler({ taskId: "late", priority: "NORMAL", dueDate: day(-1) }),
      ],
      HOUR,
      TODAY,
    );
    expect(ranked.map((f) => f.taskId)).toEqual(["late", "later"]);
  });

  it("still prefers a MUST to a NORMAL when both are due the same day", () => {
    const ranked = rankFillers(
      [
        filler({ taskId: "normal", priority: "NORMAL" }),
        filler({ taskId: "must", priority: "MUST" }),
      ],
      HOUR,
      TODAY,
    );
    expect(ranked.map((f) => f.taskId)).toEqual(["must", "normal"]);
  });

  it("takes the bigger bite when everything else is equal", () => {
    const ranked = rankFillers(
      [
        filler({ taskId: "small", estimatedMinutes: 15 }),
        filler({ taskId: "large", estimatedMinutes: 55 }),
      ],
      HOUR,
      TODAY,
    );
    expect(ranked[0].taskId).toBe("large");
  });

  it("is stable, so re-opening the dialog offers the same task", () => {
    const fillers = [
      filler({ taskId: "c" }),
      filler({ taskId: "a" }),
      filler({ taskId: "b" }),
    ];
    const first = rankFillers(fillers, HOUR, TODAY).map((f) => f.taskId);
    const again = rankFillers([...fillers].reverse(), HOUR, TODAY).map(
      (f) => f.taskId,
    );
    expect(again).toEqual(first);
  });
});

describe("pickOffers", () => {
  /** Ten things owed today, plus one of everything else. */
  const crowded = [
    ...Array.from({ length: 10 }, (_, i) =>
      filler({ taskId: `owed-${i}`, source: "unassigned" }),
    ),
    filler({ taskId: "orphan", source: "orphaned" }),
    filler({ taskId: "tomorrow", source: "pullForward" }),
    filler({ taskId: "spare", source: "spare" }),
  ];

  it("never lets a busy tier starve the others", () => {
    // The bug this exists for: a wall of tier-1 work hid everything in triage.
    const picked = pickOffers(crowded, 6).map((f) => f.taskId);
    expect(picked).toContain("orphan");
    expect(picked).toContain("tomorrow");
    expect(picked).toContain("spare");
  });

  it("still leads with the best overall", () => {
    expect(pickOffers(crowded, 6)[0].taskId).toBe("owed-0");
  });

  it("spends what is left on the best of the rest", () => {
    const picked = pickOffers(crowded, 6).map((f) => f.taskId);
    expect(picked).toEqual([
      "owed-0",
      "orphan",
      "tomorrow",
      "spare",
      "owed-1",
      "owed-2",
    ]);
  });

  it("respects the limit", () => {
    expect(pickOffers(crowded, 2)).toHaveLength(2);
    expect(pickOffers(crowded, 99)).toHaveLength(crowded.length);
  });

  it("copes with a single tier", () => {
    const only = [filler({ taskId: "a" }), filler({ taskId: "b" })];
    expect(pickOffers(only, 6).map((f) => f.taskId)).toEqual(["a", "b"]);
  });

  it("copes with nothing at all", () => {
    expect(pickOffers([], 6)).toEqual([]);
  });
});

describe("rankFillers stability", () => {
  it("is stable, so re-opening the dialog offers the same task", () => {
    const fillers = [
      filler({ taskId: "c" }),
      filler({ taskId: "a" }),
      filler({ taskId: "b" }),
    ];
    const first = rankFillers(fillers, HOUR, TODAY).map((f) => f.taskId);
    const again = rankFillers([...fillers].reverse(), HOUR, TODAY).map(
      (f) => f.taskId,
    );
    expect(again).toEqual(first);
  });
});
