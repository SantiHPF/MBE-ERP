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
    expect(result.unassigned).toEqual([{ taskId: "big", reason: "no-capacity" }]);
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
    expect(result.unassigned[0].reason).toBe("no-slot-fits");
  });
});
