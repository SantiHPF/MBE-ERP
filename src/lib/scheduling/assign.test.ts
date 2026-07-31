import { describe, expect, it } from "vitest";
import { assignDay, type CandidateInput, type TaskInput } from "./assign";
import { computeAvailability } from "./availability";

const MON = new Date(Date.UTC(2026, 6, 27));
const at = (h: number, m = 0) => h * 60 + m;

/** A person available 09:00-17:00 with no break, unless told otherwise. */
function candidate(
  userId: string,
  over: Partial<CandidateInput> & { start?: number; end?: number } = {},
): CandidateInput {
  const availability = computeAvailability({
    date: MON,
    patterns: [
      {
        weekday: 1,
        startMinutes: over.start ?? at(9),
        endMinutes: over.end ?? at(17),
        breakMinutes: 0,
      },
    ],
  });

  return {
    userId,
    departmentId: "ops",
    availability,
    committedMinutes: 0,
    busy: [],
    ...over,
  };
}

function task(id: string, over: Partial<TaskInput> = {}): TaskInput {
  return {
    id,
    departmentId: "ops",
    estimatedMinutes: 60,
    templateId: "tpl-stock",
    ...over,
  };
}

describe("rotation fairness", () => {
  it("gives the job to whoever has done it least", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1")],
      candidates: [candidate("veteran"), candidate("newcomer")],
      rotation: [
        { templateId: "tpl-stock", userId: "veteran", assignedCount: 4, lastAssignedAt: null },
        { templateId: "tpl-stock", userId: "newcomer", assignedCount: 1, lastAssignedAt: null },
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].userId).toBe("newcomer");
  });

  it("breaks a count tie with whoever had it longest ago", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1")],
      candidates: [candidate("recent"), candidate("stale")],
      rotation: [
        {
          templateId: "tpl-stock",
          userId: "recent",
          assignedCount: 2,
          lastAssignedAt: new Date(Date.UTC(2026, 6, 20)),
        },
        {
          templateId: "tpl-stock",
          userId: "stale",
          assignedCount: 2,
          lastAssignedAt: new Date(Date.UTC(2026, 5, 1)),
        },
      ],
    });

    expect(result.assignments[0].userId).toBe("stale");
  });

  it("treats someone who has never done it as most overdue", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1")],
      candidates: [candidate("done-it"), candidate("never")],
      rotation: [
        {
          templateId: "tpl-stock",
          userId: "done-it",
          assignedCount: 0,
          lastAssignedAt: new Date(Date.UTC(2026, 6, 20)),
        },
      ],
    });

    expect(result.assignments[0].userId).toBe("never");
  });

  it("spreads repeats of the same task rather than stacking one person", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1"), task("t2"), task("t3")],
      candidates: [candidate("a"), candidate("b"), candidate("c")],
    });

    const owners = result.assignments.map((a) => a.userId).sort();
    expect(owners).toEqual(["a", "b", "c"]);
  });

  it("rotation only considers history for the task's own template", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { templateId: "tpl-audit" })],
      candidates: [candidate("a"), candidate("b")],
      rotation: [
        // Heavy history on a *different* template must not matter here.
        { templateId: "tpl-stock", userId: "a", assignedCount: 99, lastAssignedAt: null },
      ],
    });

    // Falls through to the stable id tie-break, not the unrelated history.
    expect(result.assignments[0].userId).toBe("a");
  });
});

describe("capacity is a hard constraint", () => {
  it("never assigns a task larger than the person's remaining day", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("big", { estimatedMinutes: 600 })],
      candidates: [candidate("a")], // 8h day
    });

    expect(result.assignments).toEqual([]);
    // Ten hours against an eight-hour day: no calendar of theirs would ever
    // hold it, so it reads as a job wanting sittings rather than a busy week.
    expect(result.unassigned).toEqual([
      { taskId: "big", reason: "needs-splitting" },
    ]);
  });

  it("says no-capacity when the day would have held it but is spoken for", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { estimatedMinutes: 120 })],
      // An 8h day that could easily take two hours, with only one left.
      candidates: [candidate("a", { committedMinutes: 420 })],
    });

    expect(result.unassigned).toEqual([{ taskId: "t1", reason: "no-capacity" }]);
  });

  it("skips someone at capacity even when rotation says they are next", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { estimatedMinutes: 120 })],
      candidates: [
        // Fairest by rotation, but only 1h left.
        candidate("fair", { committedMinutes: 420 }),
        candidate("busy-but-free"),
      ],
      rotation: [
        { templateId: "tpl-stock", userId: "fair", assignedCount: 0, lastAssignedAt: null },
        { templateId: "tpl-stock", userId: "busy-but-free", assignedCount: 5, lastAssignedAt: null },
      ],
    });

    expect(result.assignments[0].userId).toBe("busy-but-free");
  });

  it("respects a short day", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { estimatedMinutes: 300 })],
      candidates: [candidate("short", { start: at(9), end: at(13) })], // 4h
    });

    expect(result.unassigned).toHaveLength(1);
  });

  it("stops assigning once the day fills up", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("t1", { estimatedMinutes: 300 }),
        task("t2", { estimatedMinutes: 300 }),
      ],
      candidates: [candidate("only")], // 480 minutes total
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.unassigned).toHaveLength(1);
  });

  it("leaves an absent person out entirely", () => {
    const absent = computeAvailability({
      date: MON,
      patterns: [{ weekday: 1, startMinutes: at(9), endMinutes: at(17), breakMinutes: 0 }],
      absences: [{ startDate: MON, endDate: MON, scope: "FULL_DAY" }],
    });

    const result = assignDay({
      date: MON,
      tasks: [task("t1")],
      candidates: [
        { ...candidate("away"), availability: absent },
        candidate("here"),
      ],
      rotation: [
        { templateId: "tpl-stock", userId: "away", assignedCount: 0, lastAssignedAt: null },
        { templateId: "tpl-stock", userId: "here", assignedCount: 9, lastAssignedAt: null },
      ],
    });

    expect(result.assignments[0].userId).toBe("here");
  });
});

describe("placement in the day", () => {
  it("schedules around a lunch break instead of through it", () => {
    const withLunch = computeAvailability({
      date: MON,
      patterns: [
        {
          weekday: 1,
          startMinutes: at(9),
          endMinutes: at(18),
          breakMinutes: 60,
          breakStartMinutes: at(13),
        },
      ],
    });

    const result = assignDay({
      date: MON,
      tasks: [task("t1", { estimatedMinutes: 240 }), task("t2", { estimatedMinutes: 180 })],
      candidates: [{ ...candidate("a"), availability: withLunch }],
    });

    // 09:00-13:00 then 14:00-17:00, never spanning 13:00-14:00.
    expect(result.assignments).toHaveLength(2);
    for (const a of result.assignments) {
      expect(a.start).not.toBeNull();
      expect(a.start! >= at(14) || a.end! <= at(13)).toBe(true);
    }
  });

  it("honours a fixed window", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("report", {
          estimatedMinutes: 120,
          fixedStartMinutes: at(9),
          fixedEndMinutes: at(11),
        }),
      ],
      candidates: [candidate("a")],
    });

    expect(result.assignments[0].start).toBe(at(9));
    expect(result.assignments[0].end).toBe(at(11));
  });

  it("refuses a fixed task that cannot fit its window", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("report", {
          estimatedMinutes: 180,
          fixedStartMinutes: at(9),
          fixedEndMinutes: at(11),
        }),
      ],
      candidates: [candidate("a")],
    });

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reason).toBe("no-slot-fits");
  });

  it("places fixed work before flexible work", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("flex", { estimatedMinutes: 240, templateId: "tpl-a" }),
        task("fixed", {
          estimatedMinutes: 120,
          templateId: "tpl-b",
          fixedStartMinutes: at(9),
          fixedEndMinutes: at(11),
        }),
      ],
      candidates: [candidate("a")],
    });

    const fixed = result.assignments.find((a) => a.taskId === "fixed");
    expect(fixed?.start).toBe(at(9));
    expect(result.assignments).toHaveLength(2);
  });

  it("does not double-book time already taken by immovable work", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { estimatedMinutes: 120 })],
      candidates: [
        candidate("a", {
          busy: [{ start: at(9), end: at(15) }],
          committedMinutes: 360,
        }),
      ],
    });

    expect(result.assignments[0].start).toBeGreaterThanOrEqual(at(15));
  });
});

describe("pinned assignees", () => {
  it("goes to the named person regardless of rotation", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { templateId: null, pinnedAssigneeId: "chosen" })],
      candidates: [candidate("chosen"), candidate("fairer")],
      oneOffLoad: [{ userId: "chosen", count: 20 }],
    });

    expect(result.assignments[0].userId).toBe("chosen");
  });

  it("is left unassigned when the named person has no room", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { estimatedMinutes: 120, pinnedAssigneeId: "chosen" })],
      candidates: [
        candidate("chosen", { committedMinutes: 470 }),
        candidate("free"),
      ],
    });

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reason).toBe("pinned-person-unavailable");
  });
});

describe("one-off tasks without a template", () => {
  it("falls back to who has absorbed fewest one-offs", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { templateId: null })],
      candidates: [candidate("loaded"), candidate("light")],
      oneOffLoad: [
        { userId: "loaded", count: 7 },
        { userId: "light", count: 2 },
      ],
    });

    expect(result.assignments[0].userId).toBe("light");
  });

  it("spreads several one-offs across people", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("t1", { templateId: null }),
        task("t2", { templateId: null }),
      ],
      candidates: [candidate("a"), candidate("b")],
    });

    expect(new Set(result.assignments.map((a) => a.userId)).size).toBe(2);
  });
});

describe("departments", () => {
  it("never crosses department boundaries", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1", { departmentId: "sales" })],
      candidates: [candidate("ops-person", { departmentId: "ops" })],
    });

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reason).toBe("no-one-in-department");
  });
});

describe("determinism", () => {
  const setup = () => ({
    date: MON,
    tasks: [
      task("t1", { estimatedMinutes: 90 }),
      task("t2", { estimatedMinutes: 45, templateId: "tpl-audit" }),
      task("t3", { estimatedMinutes: 120, templateId: null }),
    ],
    candidates: [candidate("a"), candidate("b"), candidate("c")],
    rotation: [
      { templateId: "tpl-stock", userId: "a", assignedCount: 3, lastAssignedAt: null },
      { templateId: "tpl-stock", userId: "b", assignedCount: 1, lastAssignedAt: null },
    ],
  });

  it("produces identical output when run twice", () => {
    const first = assignDay(setup());
    const second = assignDay(setup());

    expect(second.assignments).toEqual(first.assignments);
    expect(second.unassigned).toEqual(first.unassigned);
  });

  it("does not depend on the order tasks arrive in", () => {
    const base = setup();
    const shuffled = { ...base, tasks: [...base.tasks].reverse() };

    expect(assignDay(shuffled).assignments).toEqual(assignDay(base).assignments);
  });

  it("does not depend on the order candidates arrive in", () => {
    const base = setup();
    const shuffled = { ...base, candidates: [...base.candidates].reverse() };

    expect(assignDay(shuffled).assignments).toEqual(assignDay(base).assignments);
  });
});

describe("priority", () => {
  it("places must-do work before normal work", () => {
    const result = assignDay({
      date: MON,
      // Only room for one: 8h day, two 5h tasks.
      tasks: [
        task("normal", { estimatedMinutes: 300, templateId: "tpl-a" }),
        task("must", {
          estimatedMinutes: 300,
          templateId: "tpl-b",
          priority: "MUST",
        }),
      ],
      candidates: [candidate("only")],
    });

    const placed = result.assignments.map((a) => a.taskId);
    expect(placed).toContain("must");
    expect(placed).not.toContain("normal");
  });

  it("leaves spare-time work until everything else has been placed", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("filler", {
          estimatedMinutes: 300,
          templateId: "tpl-a",
          priority: "SPARE_TIME",
        }),
        task("normal", { estimatedMinutes: 300, templateId: "tpl-b" }),
      ],
      candidates: [candidate("only")],
    });

    expect(result.assignments.map((a) => a.taskId)).toEqual(["normal"]);
    expect(result.unassigned[0].taskId).toBe("filler");
  });

  it("fills a quiet day with spare-time work", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("filler", {
          estimatedMinutes: 60,
          templateId: "tpl-a",
          priority: "SPARE_TIME",
        }),
        task("normal", { estimatedMinutes: 60, templateId: "tpl-b" }),
      ],
      candidates: [candidate("only")],
    });

    expect(result.assignments).toHaveLength(2);
  });

  it("assigns a must-do task even when nobody has room", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("must", {
          estimatedMinutes: 120,
          templateId: "tpl-b",
          priority: "MUST",
        }),
      ],
      // Both already full.
      candidates: [
        candidate("a", { committedMinutes: 480 }),
        candidate("b", { committedMinutes: 480 }),
      ],
    });

    expect(result.unassigned).toEqual([]);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].overCapacity).toBe(true);
  });

  it("still drops normal work when nobody has room", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("normal", { estimatedMinutes: 120 })],
      candidates: [candidate("a", { committedMinutes: 480 })],
    });

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reason).toBe("no-capacity");
  });

  it("spreads several must-do tasks rather than piling them on one person", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("m1", { estimatedMinutes: 120, priority: "MUST" }),
        task("m2", { estimatedMinutes: 120, priority: "MUST" }),
        task("m3", { estimatedMinutes: 120, priority: "MUST" }),
      ],
      candidates: [candidate("a"), candidate("b"), candidate("c")],
    });

    expect(new Set(result.assignments.map((a) => a.userId)).size).toBe(3);
  });

  it("does not let priority override a fixed window", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("must", {
          estimatedMinutes: 240,
          templateId: "tpl-a",
          priority: "MUST",
        }),
        task("meeting", {
          estimatedMinutes: 60,
          templateId: "tpl-b",
          fixedStartMinutes: at(9),
          fixedEndMinutes: at(10),
        }),
      ],
      candidates: [candidate("only")],
    });

    // The fixed meeting keeps its hour; the must-do task fits around it.
    const meeting = result.assignments.find((a) => a.taskId === "meeting");
    expect(meeting?.start).toBe(at(9));
    expect(result.assignments).toHaveLength(2);
  });

  it("treats an unset priority as normal", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("t1")],
      candidates: [candidate("a")],
    });
    expect(result.assignments).toHaveLength(1);
  });
});

describe("must-do work is never dropped", () => {
  it("assigns a must-do task too long for any single free window", () => {
    // Lunch splits the day into 4h + 3h, so a 5h task fits neither, even
    // though the day has 7h of capacity.
    const split = computeAvailability({
      date: MON,
      patterns: [
        {
          weekday: 1,
          startMinutes: at(9),
          endMinutes: at(17),
          breakMinutes: 60,
          breakStartMinutes: at(13),
        },
      ],
    });

    const result = assignDay({
      date: MON,
      tasks: [task("big", { estimatedMinutes: 300, priority: "MUST" })],
      candidates: [{ ...candidate("a"), availability: split }],
    });

    expect(result.unassigned).toEqual([]);
    expect(result.assignments[0].userId).toBe("a");
    expect(result.assignments[0].overCapacity).toBe(true);
    expect(result.assignments[0].start).toBeNull();
  });

  it("still drops normal work that fits no window", () => {
    const split = computeAvailability({
      date: MON,
      patterns: [
        {
          weekday: 1,
          startMinutes: at(9),
          endMinutes: at(17),
          breakMinutes: 60,
          breakStartMinutes: at(13),
        },
      ],
    });

    const result = assignDay({
      date: MON,
      tasks: [task("big", { estimatedMinutes: 300 })],
      candidates: [{ ...candidate("a"), availability: split }],
    });

    expect(result.assignments).toEqual([]);
    // Five hours, against a day broken into four and three by lunch. No empty
    // calendar would hold it either, so this is a job wanting sittings rather
    // than a day that happened to be busy -- see the pair of tests below.
    expect(result.unassigned[0].reason).toBe("needs-splitting");
  });
});

describe("telling a full day from a job that is too long", () => {
  it("says needs-splitting when nobody has a stretch long enough", () => {
    // 09:00-13:00 and 14:00-17:00. Nothing is booked; the job simply does not
    // fit in either half, and clearing the calendar would not help.
    const split = computeAvailability({
      date: MON,
      patterns: [
        {
          weekday: 1,
          startMinutes: at(9),
          endMinutes: at(17),
          breakMinutes: 60,
          breakStartMinutes: at(13),
        },
      ],
    });

    const result = assignDay({
      date: MON,
      tasks: [task("tenHours", { estimatedMinutes: 600 })],
      candidates: [{ ...candidate("a"), availability: split }],
    });

    expect(result.unassigned[0].reason).toBe("needs-splitting");
  });

  it("says no-slot-fits when the room exists but is already taken", () => {
    // An unbroken 09:00-17:00 day, so a three-hour job would fit fine -- but
    // the middle of it is already booked and what is left is too fragmented.
    // Clearing the day would fix this one, which is why it reads differently.
    const busy = {
      ...candidate("a"),
      busy: [{ start: at(11), end: at(15) }],
    };

    const result = assignDay({
      date: MON,
      tasks: [task("threeHours", { estimatedMinutes: 180 })],
      candidates: [busy],
    });

    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reason).toBe("no-slot-fits");
  });
});

/**
 * A task done several times a shift is one person's routine -- you open, you
 * close -- so the repetitions must not be spread the way a rotated chore is.
 */
describe("anchored routines", () => {
  /** Someone on 09:00-18:00 with an hour off at 13:00, so two windows. */
  function splitDay(userId: string, start = at(9), end = at(18)): CandidateInput {
    return {
      userId,
      departmentId: "ops",
      availability: computeAvailability({
        date: MON,
        patterns: [
          {
            weekday: 1,
            startMinutes: start,
            endMinutes: end,
            breakMinutes: 60,
            breakStartMinutes: at(13),
          },
        ],
      }),
      committedMinutes: 0,
      busy: [],
    };
  }

  const routine = (ids: string[], anchors: string[]) =>
    ids.map((id, i) =>
      task(id, {
        estimatedMinutes: 10,
        anchor: anchors[i] as TaskInput["anchor"],
        groupKey: "rule-1:2026-07-27",
      }),
    );

  it("gives every repetition to the same person", () => {
    const result = assignDay({
      date: MON,
      tasks: routine(
        ["a", "b", "c", "d"],
        ["ARRIVAL", "BEFORE_BREAK", "AFTER_BREAK", "BEFORE_LEAVING"],
      ),
      candidates: [splitDay("ana"), splitDay("luis"), splitDay("marta")],
    });

    expect(result.assignments).toHaveLength(4);
    expect(new Set(result.assignments.map((a) => a.userId)).size).toBe(1);
  });

  it("places each one at its point in that person's day", () => {
    const result = assignDay({
      date: MON,
      tasks: routine(
        ["a", "b", "c", "d"],
        ["ARRIVAL", "BEFORE_BREAK", "AFTER_BREAK", "BEFORE_LEAVING"],
      ),
      candidates: [splitDay("ana")],
    });

    const startOf = (id: string) =>
      result.assignments.find((a) => a.taskId === id)?.start;

    expect(startOf("a")).toBe(at(9));
    expect(startOf("b")).toBe(at(12, 50));
    expect(startOf("c")).toBe(at(14));
    expect(startOf("d")).toBe(at(17, 50));
  });

  it("follows each person's own shift, not a fixed clock time", () => {
    // Only Luis has capacity, and he starts an hour earlier than the default.
    const result = assignDay({
      date: MON,
      tasks: routine(["a"], ["ARRIVAL"]),
      candidates: [splitDay("luis", at(8), at(16))],
    });

    expect(result.assignments[0].start).toBe(at(8));
  });

  it("counts the routine once for rotation, not once per repetition", () => {
    // Ana has done this template twice; Luis once. Luis should take today's
    // routine, and doing four of them must not credit him four times -- so
    // tomorrow's identical routine goes back to Ana, who is now behind.
    const rotation = [
      { templateId: "tpl-stock", userId: "ana", assignedCount: 2, lastAssignedAt: null },
      { templateId: "tpl-stock", userId: "luis", assignedCount: 1, lastAssignedAt: null },
    ];

    const day1 = assignDay({
      date: MON,
      tasks: routine(["a", "b", "c"], ["ARRIVAL", "AFTER_BREAK", "BEFORE_LEAVING"]),
      candidates: [splitDay("ana"), splitDay("luis")],
      rotation,
    });

    expect(new Set(day1.assignments.map((a) => a.userId))).toEqual(new Set(["luis"]));

    // Luis is now on 2, level with Ana, who last had it longer ago.
    const day2 = assignDay({
      date: MON,
      tasks: routine(["d", "e", "f"], ["ARRIVAL", "AFTER_BREAK", "BEFORE_LEAVING"]),
      candidates: [splitDay("ana"), splitDay("luis")],
      rotation: [
        { templateId: "tpl-stock", userId: "ana", assignedCount: 2, lastAssignedAt: null },
        { templateId: "tpl-stock", userId: "luis", assignedCount: 2, lastAssignedAt: MON },
      ],
    });

    expect(new Set(day2.assignments.map((a) => a.userId))).toEqual(new Set(["ana"]));
  });

  it("drops the after-break one for somebody working straight through", () => {
    /**
     * This used to place both, on the grounds that the check still had to
     * happen. It reads better on paper than it does in a day: somebody who
     * takes no break got the same routine twice within a few minutes of
     * arriving, because both repetitions resolved to the top of the morning.
     * With no break there is no "after the break", so it folds onto arrival --
     * where its sibling already is -- and the routine simply happens once.
     */
    const result = assignDay({
      date: MON,
      tasks: routine(["a", "b"], ["ARRIVAL", "AFTER_BREAK"]),
      candidates: [candidate("ana")],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].taskId).toBe("a");
    expect(result.collapsed).toEqual([{ taskId: "b", into: null }]);
    expect(result.unassigned).toHaveLength(0);
  });

  it("keeps the routine together rather than splitting it across people", () => {
    // Ana has room for only part of it; Luis has room for all of it.
    const result = assignDay({
      date: MON,
      tasks: routine(["a", "b", "c"], ["ARRIVAL", "AFTER_BREAK", "BEFORE_LEAVING"]),
      candidates: [
        { ...splitDay("ana"), committedMinutes: at(7, 40) },
        splitDay("luis"),
      ],
    });

    expect(new Set(result.assignments.map((a) => a.userId))).toEqual(new Set(["luis"]));
  });

  it("leaves the whole routine unassigned when nobody can hold it", () => {
    const result = assignDay({
      date: MON,
      tasks: routine(["a", "b"], ["ARRIVAL", "BEFORE_LEAVING"]),
      candidates: [{ ...splitDay("ana"), committedMinutes: at(8) }],
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned.map((u) => u.taskId).sort()).toEqual(["a", "b"]);
  });

  it("does not group un-anchored repeats -- those still rotate", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("a", { estimatedMinutes: 10 }),
        task("b", { estimatedMinutes: 10 }),
      ],
      candidates: [splitDay("ana"), splitDay("luis")],
    });

    expect(new Set(result.assignments.map((a) => a.userId)).size).toBe(2);
  });
});

describe("work that goes hand in hand", () => {
  /** Review then report: one groupKey, the second following the first. */
  const pair = () => [
    task("review", { estimatedMinutes: 60, groupKey: "follows:review" }),
    task("report", {
      estimatedMinutes: 30,
      groupKey: "follows:review",
      followsTaskId: "review",
    }),
  ];

  it("gives both halves to the same person", () => {
    const result = assignDay({
      date: MON,
      tasks: pair(),
      candidates: [candidate("ana"), candidate("luis"), candidate("marta")],
    });

    expect(result.assignments).toHaveLength(2);
    expect(new Set(result.assignments.map((a) => a.userId)).size).toBe(1);
  });

  it("puts the follower after the leader", () => {
    const result = assignDay({
      date: MON,
      tasks: pair(),
      candidates: [candidate("ana")],
    });

    const review = result.assignments.find((a) => a.taskId === "review")!;
    const report = result.assignments.find((a) => a.taskId === "report")!;
    expect(report.start).toBeGreaterThanOrEqual(review.end!);
  });

  it("will not drop the follower into an earlier gap", () => {
    /**
     * The regression this exists for. First-fit would put the 30-minute report
     * in the 09:00-09:30 hole and the 60-minute review after it, so the report
     * would come before the thing it reports on.
     */
    const ana = candidate("ana", {
      busy: [{ start: at(9, 30), end: at(11) }],
    });

    const result = assignDay({
      date: MON,
      tasks: pair(),
      candidates: [ana],
    });

    const review = result.assignments.find((a) => a.taskId === "review")!;
    const report = result.assignments.find((a) => a.taskId === "report")!;
    expect(review.start).toBe(at(11));
    expect(report.start).toBe(at(12));
  });

  it("keeps a chain of three in order however they are listed", () => {
    // Deliberately supplied back to front: the ordering is derived, not given.
    const result = assignDay({
      date: MON,
      tasks: [
        task("c", { estimatedMinutes: 30, groupKey: "g", followsTaskId: "b" }),
        task("b", { estimatedMinutes: 30, groupKey: "g", followsTaskId: "a" }),
        task("a", { estimatedMinutes: 30, groupKey: "g" }),
      ],
      candidates: [candidate("ana")],
    });

    const startOf = (id: string) =>
      result.assignments.find((x) => x.taskId === id)!.start!;
    expect(startOf("a")).toBeLessThan(startOf("b"));
    expect(startOf("b")).toBeLessThan(startOf("c"));
  });

  it("keeps the pair together rather than splitting it across a full day", () => {
    // Only room for the review on ana's day, so the pair goes to luis whole.
    const result = assignDay({
      date: MON,
      tasks: pair(),
      candidates: [
        candidate("ana", { start: at(9), end: at(10) }),
        candidate("luis"),
      ],
    });

    expect(new Set(result.assignments.map((a) => a.userId))).toEqual(
      new Set(["luis"]),
    );
  });
});

describe("a set time outranks a point in the shift", () => {
  /** 09:00-14:00, lunch, 16:00-19:00 -- the working pattern used here. */
  function splitDay(userId: string): CandidateInput {
    return {
      userId,
      departmentId: "ops",
      availability: computeAvailability({
        date: MON,
        patterns: [
          {
            weekday: 1,
            startMinutes: at(9),
            endMinutes: at(19),
            breakMinutes: 120,
            breakStartMinutes: at(14),
          },
        ],
      }),
      committedMinutes: 0,
      busy: [],
    };
  }

  it("gives 09:00 to the task pinned to 09:00, not to the arrivals", () => {
    /**
     * The regression. ANCHOR_ORDER.ARRIVAL is 0, and the old comparison sorted
     * anchors on ANCHOR_ORDER * 1e4 -- so every "al llegar" task sorted ahead
     * of a 09:00 task's 540 and took the morning from it.
     */
    const result = assignDay({
      date: MON,
      tasks: [
        task("arrival-1", { estimatedMinutes: 30, anchor: "ARRIVAL" }),
        task("arrival-2", { estimatedMinutes: 30, anchor: "ARRIVAL" }),
        task("arrival-3", { estimatedMinutes: 5, anchor: "ARRIVAL" }),
        task("nine", { estimatedMinutes: 90, fixedStartMinutes: at(9) }),
      ],
      candidates: [splitDay("ana")],
    });

    const startOf = (id: string) =>
      result.assignments.find((a) => a.taskId === id)?.start ?? null;

    expect(startOf("nine")).toBe(at(9));
    for (const id of ["arrival-1", "arrival-2", "arrival-3"]) {
      expect(startOf(id)).toBeGreaterThanOrEqual(at(10, 30));
    }
  });

  it("stacks the arrivals behind it rather than scattering them", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("nine", { estimatedMinutes: 90, fixedStartMinutes: at(9) }),
        task("a", { estimatedMinutes: 30, anchor: "ARRIVAL" }),
        task("b", { estimatedMinutes: 30, anchor: "ARRIVAL" }),
      ],
      candidates: [splitDay("ana")],
    });

    const starts = ["nine", "a", "b"]
      .map((id) => result.assignments.find((x) => x.taskId === id)!.start!)
      .sort((x, y) => x - y);
    // 09:00-10:30, then 10:30 and 11:00 -- contiguous, no gaps.
    expect(starts).toEqual([at(9), at(10, 30), at(11)]);
  });

  it("keeps an end-of-shift task out of the morning when the afternoon is full", () => {
    /**
     * The second regression: an unbounded first-fit fallback put "antes de
     * salir" at 10:00. Unplaced is the honest answer -- the day reads as over
     * rather than claiming a time that contradicts the task's own name.
     */
    const ana = splitDay("ana");
    ana.busy = [{ start: at(16), end: at(19) }];

    const result = assignDay({
      date: MON,
      tasks: [task("leaving", { estimatedMinutes: 30, anchor: "BEFORE_LEAVING" })],
      candidates: [ana],
    });

    const placed = result.assignments.find((a) => a.taskId === "leaving");
    expect(placed?.start ?? null).not.toBe(at(10));
    // Either unplaced entirely, or still in the afternoon. Never the morning.
    if (placed?.start != null) expect(placed.start).toBeGreaterThanOrEqual(at(16));
  });

  it("honours a morning-only preference", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("m", { estimatedMinutes: 60, shiftHalf: "MORNING" })],
      candidates: [splitDay("ana")],
    });

    const slot = result.assignments.find((a) => a.taskId === "m")!;
    expect(slot.end).toBeLessThanOrEqual(at(14));
  });

  it("honours an afternoon-only preference", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("a", { estimatedMinutes: 60, shiftHalf: "AFTERNOON" })],
      candidates: [splitDay("ana")],
    });

    const slot = result.assignments.find((a) => a.taskId === "a")!;
    expect(slot.start).toBeGreaterThanOrEqual(at(14));
  });

  it("lets an anchor override a shift preference that disagrees", () => {
    // The anchor is the more specific statement about where in the day it goes.
    const result = assignDay({
      date: MON,
      tasks: [
        task("x", {
          estimatedMinutes: 30,
          anchor: "ARRIVAL",
          shiftHalf: "AFTERNOON",
        }),
      ],
      candidates: [splitDay("ana")],
    });

    expect(result.assignments.find((a) => a.taskId === "x")!.start).toBe(at(9));
  });
});

describe("an anchor bounds the half, not just the starting point", () => {
  function splitDay(userId: string): CandidateInput {
    return {
      userId,
      departmentId: "ops",
      availability: computeAvailability({
        date: MON,
        patterns: [
          {
            weekday: 1,
            startMinutes: at(9),
            endMinutes: at(19),
            breakMinutes: 120,
            breakStartMinutes: at(14),
          },
        ],
      }),
      committedMinutes: 0,
      busy: [],
    };
  }

  it("never puts 'before the break' after the break", () => {
    /**
     * The regression. resolveAnchor put BEFORE_BREAK at 13:30; the morning was
     * full, and findSlot walked straight past lunch into the afternoon to land
     * at 16:30 -- before the break, after the break.
     */
    const ana = splitDay("ana");
    ana.busy = [{ start: at(9), end: at(14) }];

    const result = assignDay({
      date: MON,
      tasks: [task("before", { estimatedMinutes: 30, anchor: "BEFORE_BREAK" })],
      candidates: [ana],
    });

    const placed = result.assignments.find((a) => a.taskId === "before");
    if (placed?.start != null) expect(placed.start).toBeLessThan(at(14));
  });

  it("never puts 'after the break' before it", () => {
    const ana = splitDay("ana");
    ana.busy = [{ start: at(16), end: at(19) }];

    const result = assignDay({
      date: MON,
      tasks: [task("after", { estimatedMinutes: 30, anchor: "AFTER_BREAK" })],
      candidates: [ana],
    });

    const placed = result.assignments.find((a) => a.taskId === "after");
    if (placed?.start != null) expect(placed.start).toBeGreaterThanOrEqual(at(16));
  });

  it("still places it normally when its own half has room", () => {
    const result = assignDay({
      date: MON,
      tasks: [task("before", { estimatedMinutes: 30, anchor: "BEFORE_BREAK" })],
      candidates: [splitDay("ana")],
    });

    // Backed off the end of the morning so it finishes by the break.
    expect(result.assignments[0].end).toBe(at(14));
  });

  it("stacks several 'before the break' tasks against the break", () => {
    /**
     * The regression this pair of tests exists for. Only the first one was
     * aimed at 13:30; the second found that minute taken and first-fit to the
     * top of the morning, so a real day read 10:00, 10:40, 13:30 -- two of
     * them nowhere near the break they were named after.
     */
    const result = assignDay({
      date: MON,
      tasks: [
        task("b1", { estimatedMinutes: 30, anchor: "BEFORE_BREAK" }),
        task("b2", { estimatedMinutes: 30, anchor: "BEFORE_BREAK" }),
        task("b3", { estimatedMinutes: 10, anchor: "BEFORE_BREAK" }),
      ],
      candidates: [splitDay("ana")],
    });

    const slots = result.assignments
      .map((a) => ({ start: a.start ?? 0, end: a.end ?? 0 }))
      .sort((x, y) => x.start - y.start);

    // One contiguous block finishing exactly at the break: 30 + 30 + 10 = 70
    // minutes, so 12:50 to 14:00 with no gaps.
    expect(slots[slots.length - 1].end).toBe(at(14));
    expect(slots[0].start).toBe(at(12, 50));
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].start).toBe(slots[i - 1].end);
    }
  });

  it("stacks several 'before leaving' tasks against the end of the shift", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("l1", { estimatedMinutes: 30, anchor: "BEFORE_LEAVING" }),
        task("l2", { estimatedMinutes: 30, anchor: "BEFORE_LEAVING" }),
      ],
      candidates: [splitDay("ana")],
    });

    const starts = result.assignments.map((a) => a.start ?? 0).sort((x, y) => x - y);
    expect(starts).toEqual([at(18), at(18, 30)]);
  });

  it("still packs 'on arrival' forward from the start of the day", () => {
    // The mirror case: deadline anchors changed direction, starting guns
    // must not have.
    const result = assignDay({
      date: MON,
      tasks: [
        task("a1", { estimatedMinutes: 30, anchor: "ARRIVAL" }),
        task("a2", { estimatedMinutes: 30, anchor: "ARRIVAL" }),
      ],
      candidates: [splitDay("ana")],
    });

    const starts = result.assignments.map((a) => a.start ?? 0).sort((x, y) => x - y);
    expect(starts).toEqual([at(9), at(9, 30)]);
  });

  it("keeps arrivals and before-breaks at opposite ends of the morning", () => {
    // The shape the user actually sees on My Day: the day opens with the
    // arrival work and closes the morning with the pre-break work, instead of
    // all six running together from 09:00.
    const result = assignDay({
      date: MON,
      tasks: [
        task("a1", { estimatedMinutes: 30, anchor: "ARRIVAL" }),
        task("a2", { estimatedMinutes: 5, anchor: "ARRIVAL" }),
        task("b1", { estimatedMinutes: 30, anchor: "BEFORE_BREAK" }),
        task("b2", { estimatedMinutes: 10, anchor: "BEFORE_BREAK" }),
      ],
      candidates: [splitDay("ana")],
    });

    const startOf = (id: string) =>
      result.assignments.find((a) => a.taskId === id)?.start ?? -1;

    expect(startOf("a1")).toBeLessThan(at(10));
    expect(startOf("a2")).toBeLessThan(at(10));
    expect(startOf("b1")).toBeGreaterThanOrEqual(at(13));
    expect(startOf("b2")).toBeGreaterThanOrEqual(at(13));
  });
});

describe("a routine anchored around a break, on a day without one", () => {
  /** 09:00-14:00 straight through: no break, so one window. */
  function shortDay(userId: string): CandidateInput {
    return {
      userId,
      departmentId: "ops",
      availability: computeAvailability({
        date: MON,
        patterns: [
          { weekday: 1, startMinutes: at(9), endMinutes: at(14), breakMinutes: 0 },
        ],
      }),
      committedMinutes: 0,
      busy: [],
    };
  }

  /** The same routine on a day that does have a break. */
  function splitDay(userId: string): CandidateInput {
    return {
      userId,
      departmentId: "ops",
      availability: computeAvailability({
        date: MON,
        patterns: [
          {
            weekday: 1,
            startMinutes: at(9),
            endMinutes: at(19),
            breakMinutes: 120,
            breakStartMinutes: at(14),
          },
        ],
      }),
      committedMinutes: 0,
      busy: [],
    };
  }

  /** WhatsApp: the same check at all four points in the shift. */
  const fourTimes = () => [
    task("arrival", { estimatedMinutes: 30, anchor: "ARRIVAL", groupKey: "r:mon" }),
    task("before", { estimatedMinutes: 30, anchor: "BEFORE_BREAK", groupKey: "r:mon" }),
    task("after", { estimatedMinutes: 30, anchor: "AFTER_BREAK", groupKey: "r:mon" }),
    task("leaving", { estimatedMinutes: 30, anchor: "BEFORE_LEAVING", groupKey: "r:mon" }),
  ];

  it("does it twice, not four times", () => {
    const result = assignDay({
      date: MON,
      tasks: fourTimes(),
      candidates: [shortDay("chao")],
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.map((a) => a.taskId).sort()).toEqual([
      "arrival",
      "leaving",
    ]);
  });

  it("folds the two break repetitions onto the ends of the day", () => {
    const result = assignDay({
      date: MON,
      tasks: fourTimes(),
      candidates: [shortDay("chao")],
    });

    const folded = Object.fromEntries(
      result.collapsed.map((c) => [c.taskId, c.into]),
    );
    // Both had a sibling already sitting on the point they fold onto, so
    // neither is work -- they are duplicates.
    expect(folded).toEqual({ before: null, after: null });
  });

  it("still does it four times when there is a break", () => {
    const result = assignDay({
      date: MON,
      tasks: fourTimes(),
      candidates: [splitDay("santi")],
    });

    expect(result.assignments).toHaveLength(4);
    expect(result.collapsed).toEqual([]);
  });

  it("keeps work whose only anchor is the break, moved rather than dropped", () => {
    // "Examen sorpresa" fires before the break and nowhere else. On a day with
    // no break it still needs doing, so it moves to the end of the day instead
    // of quietly not happening.
    const result = assignDay({
      date: MON,
      tasks: [
        task("examen", {
          estimatedMinutes: 30,
          anchor: "BEFORE_BREAK",
          groupKey: "examen:mon",
        }),
      ],
      candidates: [shortDay("chao")],
    });

    expect(result.collapsed).toEqual([
      { taskId: "examen", into: "BEFORE_LEAVING" },
    ]);
    expect(result.assignments).toHaveLength(1);
    // Placed against the end of the shift, as "before leaving" now means.
    expect(result.assignments[0].end).toBe(at(14));
  });

  it("moves work anchored only after the break to the start of the day", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("latam", {
          estimatedMinutes: 30,
          anchor: "AFTER_BREAK",
          groupKey: "latam:mon",
        }),
      ],
      candidates: [shortDay("chao")],
    });

    expect(result.collapsed).toEqual([{ taskId: "latam", into: "ARRIVAL" }]);
    expect(result.assignments[0].start).toBe(at(9));
  });

  it("judges capacity on what will actually be done, not on all four", () => {
    // Two of the four fold away, so 60 minutes is needed, not 120. A person
    // with 90 left should still be given the routine.
    const chao = shortDay("chao");
    chao.committedMinutes = 210; // 300 rostered - 210 = 90 left

    const result = assignDay({
      date: MON,
      tasks: fourTimes(),
      candidates: [chao],
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.unassigned).toEqual([]);
  });
});

describe("folding a routine when part of it is already done", () => {
  function shortDay(userId: string): CandidateInput {
    return {
      userId,
      departmentId: "ops",
      availability: computeAvailability({
        date: MON,
        patterns: [
          { weekday: 1, startMinutes: at(9), endMinutes: at(14), breakMinutes: 0 },
        ],
      }),
      committedMinutes: 0,
      busy: [],
    };
  }

  it("does not move a repetition onto a point the finished one already holds", () => {
    /**
     * The regression. The arrival check was already done, so it was in flight
     * and not in the pool. The after-break one folded onto arrival, found it
     * apparently free, and moved there -- leaving the day with the same
     * "al llegar" twice, one done and one still to do.
     */
    const result = assignDay({
      date: MON,
      tasks: [
        task("after", {
          estimatedMinutes: 30,
          anchor: "AFTER_BREAK",
          groupKey: "crm:mon",
        }),
      ],
      candidates: [shortDay("santi")],
      occupiedAnchors: [{ groupKey: "crm:mon", anchor: "ARRIVAL" }],
    });

    expect(result.collapsed).toEqual([{ taskId: "after", into: null }]);
    expect(result.assignments).toEqual([]);
  });

  it("still moves it when the finished work is a different routine", () => {
    const result = assignDay({
      date: MON,
      tasks: [
        task("after", {
          estimatedMinutes: 30,
          anchor: "AFTER_BREAK",
          groupKey: "crm:mon",
        }),
      ],
      candidates: [shortDay("santi")],
      // Whatsapp's arrival check says nothing about CRM's.
      occupiedAnchors: [{ groupKey: "whatsapp:mon", anchor: "ARRIVAL" }],
    });

    expect(result.collapsed).toEqual([{ taskId: "after", into: "ARRIVAL" }]);
    expect(result.assignments).toHaveLength(1);
  });
});

describe("priority across routines and single tasks", () => {
  it("gives a must-do task the day before a spare-time routine", () => {
    // One person, 09:00-11:00. The routine wants two hours; the must-do task
    // wants one. Backlog work must not be what fills the day.
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo", { end: at(11) })],
      tasks: [
        task("spare-a", {
          priority: "SPARE_TIME",
          templateId: "tpl-spare",
          groupKey: "routine",
        }),
        task("spare-b", {
          priority: "SPARE_TIME",
          templateId: "tpl-spare",
          groupKey: "routine",
        }),
        task("must", { priority: "MUST", templateId: "tpl-must" }),
      ],
    });

    const must = result.assignments.find((a) => a.taskId === "must");
    expect(must?.start).toBe(at(9));
    expect(must?.overCapacity).toBeUndefined();
  });

  it("gives a must-do task the day before a normal routine", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo", { end: at(11) })],
      tasks: [
        task("routine-a", { templateId: "tpl-routine", groupKey: "routine" }),
        task("routine-b", { templateId: "tpl-routine", groupKey: "routine" }),
        task("must", { priority: "MUST", templateId: "tpl-must" }),
      ],
    });

    const must = result.assignments.find((a) => a.taskId === "must");
    expect(must?.start).toBe(at(9));
  });

  it("still places a routine before a spare-time single", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo", { end: at(10) })],
      tasks: [
        task("spare", { priority: "SPARE_TIME", templateId: "tpl-spare" }),
        task("routine", { templateId: "tpl-routine", groupKey: "routine" }),
      ],
    });

    const routine = result.assignments.find((a) => a.taskId === "routine");
    expect(routine?.start).toBe(at(9));
  });
});

describe("a deadline with no start time", () => {
  it("refuses a slot that would finish after it", () => {
    // Finish by 10:00, but 09:00-10:30 is already taken. There is no honest
    // slot, so it must go to triage rather than land at 10:30 pretending.
    const result = assignDay({
      date: MON,
      candidates: [
        candidate("solo", { busy: [{ start: at(9), end: at(10, 30) }] }),
      ],
      tasks: [task("due-by-ten", { templateId: null, fixedEndMinutes: at(10) })],
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned).toEqual([
      { taskId: "due-by-ten", reason: "no-slot-fits" },
    ]);
  });

  it("takes a slot that finishes in time", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo")],
      tasks: [task("due-by-ten", { templateId: null, fixedEndMinutes: at(10) })],
    });

    expect(result.assignments[0].start).toBe(at(9));
    expect(result.assignments[0].end).toBe(at(10));
  });

  it("gives a MUST task with only a deadline a null slot when no deadline-respecting slot exists", () => {
    // A MUST task with only a deadline, on a day where nothing fits by that
    // time, is assigned to somebody but with start: null, overCapacity: true.
    // That is how "never dropped" is expressed when the day is over.
    const result = assignDay({
      date: MON,
      candidates: [
        candidate("solo", { busy: [{ start: at(9), end: at(10, 30) }] }),
      ],
      tasks: [
        task("must-by-ten", {
          priority: "MUST",
          templateId: null,
          fixedEndMinutes: at(10),
        }),
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].start).toBeNull();
    expect(result.assignments[0].end).toBeNull();
    expect(result.assignments[0].overCapacity).toBe(true);
  });

  it("does not fallback-place a grouped member past its deadline", () => {
    // A routine member with a deadline, whose anchor can't accommodate it,
    // should not be fallback-placed past the deadline. With a deadline that
    // can't be met on a full day, the member gets a null slot and overCapacity
    // is true (like MUST work) -- the day reads as over, not the deadline as
    // violated.
    const result = assignDay({
      date: MON,
      candidates: [
        candidate("solo", { busy: [{ start: at(9), end: at(10, 30) }] }),
      ],
      tasks: [
        task("routine-1", {
          templateId: "tpl-routine",
          groupKey: "routine",
          fixedEndMinutes: at(10),
        }),
        task("routine-2", {
          templateId: "tpl-routine",
          groupKey: "routine",
          fixedEndMinutes: at(10),
        }),
      ],
    });

    // The routine gets assigned to solo, but cannot fit by the deadline.
    expect(result.assignments).toHaveLength(2);
    // Both should have null slots (no moment before 10:00 is free).
    for (const a of result.assignments) {
      expect(a.start).toBeNull();
      expect(a.end).toBeNull();
    }
  });
});

describe("work held behind a task this run is not placing", () => {
  it("keeps it with the pinned person and after the given minute", () => {
    // The leader is running 14:00-16:00 on someone else's calendar, so it is
    // not in this run at all. The follower must still be theirs, and after.
    const result = assignDay({
      date: MON,
      candidates: [
        candidate("leader-owner", { busy: [{ start: at(14), end: at(16) }] }),
        candidate("somebody-else"),
      ],
      tasks: [
        task("follower", {
          estimatedMinutes: 30,
          groupKey: "follows:leader",
          followsTaskId: "leader",
          pinnedAssigneeId: "leader-owner",
          notBeforeMinutes: at(16),
        }),
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].userId).toBe("leader-owner");
    expect(result.assignments[0].start).toBe(at(16));
  });

  it("holds a whole chain behind it, in order", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("leader-owner"), candidate("somebody-else")],
      tasks: [
        task("head", {
          estimatedMinutes: 30,
          groupKey: "follows:leader",
          followsTaskId: "leader",
          pinnedAssigneeId: "leader-owner",
          notBeforeMinutes: at(15),
        }),
        task("tail", {
          estimatedMinutes: 30,
          groupKey: "follows:leader",
          followsTaskId: "head",
        }),
      ],
    });

    const head = result.assignments.find((a) => a.taskId === "head");
    const tail = result.assignments.find((a) => a.taskId === "tail");
    expect(head?.start).toBe(at(15));
    expect(tail?.userId).toBe("leader-owner");
    expect(tail?.start).toBe(at(15, 30));
  });

  it("says so plainly when the pinned person is gone", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("somebody-else")],
      tasks: [
        task("follower", {
          groupKey: "follows:leader",
          followsTaskId: "leader",
          pinnedAssigneeId: "leader-owner",
          notBeforeMinutes: at(16),
        }),
      ],
    });

    expect(result.unassigned).toEqual([
      { taskId: "follower", reason: "pinned-person-unavailable" },
    ]);
  });
});
