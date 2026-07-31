import { describe, expect, it } from "vitest";
import {
  buildRecurringKey,
  coverageKey,
  diffAgainstExisting,
  dropAlreadyCovered,
  planRecurringTasks,
  type RuleInput,
} from "./materialize";

const MON = new Date(Date.UTC(2026, 6, 27));
const FRI = new Date(Date.UTC(2026, 6, 31));
const NEXT_FRI = new Date(Date.UTC(2026, 7, 7));

function rule(over: Partial<RuleInput> = {}): RuleInput {
  return {
    id: "rule-1",
    templateId: "tpl-1",
    departmentId: "dept-1",
    weekdays: [1, 4],
    instancesPerOccurrence: 1,
    fixedStartMinutes: null,
    fixedEndMinutes: null,
    active: true,
    template: { name: "Warehouse stock count", estimatedMinutes: 90, active: true },
    ...over,
  };
}

describe("planRecurringTasks", () => {
  it("creates one task per matching weekday in the window", () => {
    const planned = planRecurringTasks({ rules: [rule()], from: MON, to: FRI });

    // Monday and Thursday fall in Mon-Fri.
    expect(planned).toHaveLength(2);
    expect(planned.map((t) => t.dueDate.toISOString().slice(0, 10))).toEqual([
      "2026-07-27",
      "2026-07-30",
    ]);
  });

  it("repeats across multiple weeks", () => {
    const planned = planRecurringTasks({ rules: [rule()], from: MON, to: NEXT_FRI });
    expect(planned).toHaveLength(4);
  });

  it("carries the template's duration onto every instance", () => {
    const planned = planRecurringTasks({ rules: [rule()], from: MON, to: FRI });
    expect(planned.every((t) => t.estimatedMinutes === 90)).toBe(true);
  });

  it("numbers repeated instances so they are distinguishable", () => {
    const planned = planRecurringTasks({
      rules: [rule({ weekdays: [1], instancesPerOccurrence: 3 })],
      from: MON,
      to: MON,
    });

    expect(planned).toHaveLength(3);
    expect(planned.map((t) => t.title)).toEqual([
      "Warehouse stock count (1 of 3)",
      "Warehouse stock count (2 of 3)",
      "Warehouse stock count (3 of 3)",
    ]);
    // Keys must differ or the second and third would collide on insert.
    expect(new Set(planned.map((t) => t.externalKey)).size).toBe(3);
  });

  it("does not name a single instance '1 of 1'", () => {
    const planned = planRecurringTasks({ rules: [rule()], from: MON, to: MON });
    expect(planned[0].title).toBe("Warehouse stock count");
  });

  it("skips inactive rules", () => {
    const planned = planRecurringTasks({
      rules: [rule({ active: false })],
      from: MON,
      to: FRI,
    });
    expect(planned).toEqual([]);
  });

  it("skips rules whose template was retired", () => {
    const planned = planRecurringTasks({
      rules: [rule({ template: { name: "Old job", estimatedMinutes: 30, active: false } })],
      from: MON,
      to: FRI,
    });
    expect(planned).toEqual([]);
  });

  it("carries a fixed window through to the instance", () => {
    const planned = planRecurringTasks({
      rules: [rule({ weekdays: [5], fixedStartMinutes: 540, fixedEndMinutes: 660 })],
      from: MON,
      to: FRI,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].fixedStartMinutes).toBe(540);
    expect(planned[0].fixedEndMinutes).toBe(660);
  });

  it("produces identical keys when run twice over the same window", () => {
    const first = planRecurringTasks({ rules: [rule()], from: MON, to: FRI });
    const second = planRecurringTasks({ rules: [rule()], from: MON, to: FRI });

    expect(first.map((t) => t.externalKey)).toEqual(second.map((t) => t.externalKey));
  });
});

describe("buildRecurringKey", () => {
  it("is stable for the same rule, date and instance", () => {
    expect(buildRecurringKey("r1", MON, 1)).toBe(buildRecurringKey("r1", MON, 1));
  });

  it("differs across dates and instances", () => {
    expect(buildRecurringKey("r1", MON, 1)).not.toBe(buildRecurringKey("r1", FRI, 1));
    expect(buildRecurringKey("r1", MON, 1)).not.toBe(buildRecurringKey("r1", MON, 2));
  });
});

describe("diffAgainstExisting", () => {
  it("creates nothing on a second run", () => {
    const planned = planRecurringTasks({ rules: [rule()], from: MON, to: FRI });
    const keys = new Set(planned.map((t) => t.externalKey));

    const { toCreate, alreadyPresent } = diffAgainstExisting(planned, keys);

    expect(toCreate).toEqual([]);
    expect(alreadyPresent).toBe(2);
  });

  it("creates only what is missing", () => {
    const planned = planRecurringTasks({ rules: [rule()], from: MON, to: FRI });
    const keys = new Set([planned[0].externalKey]);

    const { toCreate, alreadyPresent } = diffAgainstExisting(planned, keys);

    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].externalKey).toBe(planned[1].externalKey);
    expect(alreadyPresent).toBe(1);
  });
});

describe("monthly rules", () => {
  const monthly = (over: Partial<RuleInput>): RuleInput =>
    rule({ frequency: "MONTHLY", ...over });

  // July 2026: Mondays fall on 6, 13, 20, 27. Wednesdays on 1, 8, 15, 22, 29.
  const JUL_1 = new Date(Date.UTC(2026, 6, 1));
  const JUL_31 = new Date(Date.UTC(2026, 6, 31));

  it("fires on the last Monday of the month (BYDAY=-1MO)", () => {
    const planned = planRecurringTasks({
      rules: [monthly({ weekdays: [1], monthlyNth: -1 })],
      from: JUL_1,
      to: JUL_31,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].dueDate.toISOString().slice(0, 10)).toBe("2026-07-27");
  });

  it("fires on the last Wednesday of the month (BYDAY=-1WE)", () => {
    const planned = planRecurringTasks({
      rules: [monthly({ weekdays: [3], monthlyNth: -1 })],
      from: JUL_1,
      to: JUL_31,
    });

    expect(planned[0].dueDate.toISOString().slice(0, 10)).toBe("2026-07-29");
  });

  it("fires on the first Friday (BYDAY=1FR)", () => {
    const planned = planRecurringTasks({
      rules: [monthly({ weekdays: [5], monthlyNth: 1 })],
      from: JUL_1,
      to: JUL_31,
    });

    expect(planned[0].dueDate.toISOString().slice(0, 10)).toBe("2026-07-03");
  });

  it("fires on a fixed day of the month (BYMONTHDAY=22)", () => {
    const planned = planRecurringTasks({
      rules: [monthly({ weekdays: [], monthlyDay: 22 })],
      from: JUL_1,
      to: JUL_31,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].dueDate.toISOString().slice(0, 10)).toBe("2026-07-22");
  });

  it("fires once per month across a longer window", () => {
    const planned = planRecurringTasks({
      rules: [monthly({ weekdays: [1], monthlyNth: -1 })],
      from: JUL_1,
      to: new Date(Date.UTC(2026, 8, 30)),
    });

    expect(planned.map((t) => t.dueDate.toISOString().slice(0, 10))).toEqual([
      "2026-07-27",
      "2026-08-31",
      "2026-09-28",
    ]);
  });

  it("skips a month too short for the requested day", () => {
    // February 2026 has 28 days, so a 30th never comes round.
    const planned = planRecurringTasks({
      rules: [monthly({ weekdays: [], monthlyDay: 30 })],
      from: new Date(Date.UTC(2026, 1, 1)),
      to: new Date(Date.UTC(2026, 1, 28)),
    });

    expect(planned).toEqual([]);
  });

  it("keeps monthly and weekly rules independent", () => {
    const planned = planRecurringTasks({
      rules: [
        monthly({ id: "m", weekdays: [1], monthlyNth: -1 }),
        rule({ id: "w", weekdays: [1] }),
      ],
      from: JUL_1,
      to: JUL_31,
    });

    // Four Mondays weekly, plus one monthly on the last of them.
    expect(planned.filter((t) => t.externalKey.startsWith("recurring:w"))).toHaveLength(4);
    expect(planned.filter((t) => t.externalKey.startsWith("recurring:m"))).toHaveLength(1);
  });
});

/**
 * Anchored rules: a task done at several points in the shift, e.g. a till
 * check on arrival, either side of the break, and before leaving.
 */
describe("anchored rules", () => {
  const anchored = rule({
    weekdays: [1],
    anchors: ["ARRIVAL", "AFTER_BREAK", "BEFORE_LEAVING"],
  });

  it("creates one task per anchor, not per instance count", () => {
    const planned = planRecurringTasks({ rules: [anchored], from: MON, to: MON });

    expect(planned).toHaveLength(3);
    expect(planned.map((p) => p.anchor)).toEqual([
      "ARRIVAL",
      "AFTER_BREAK",
      "BEFORE_LEAVING",
    ]);
  });

  it("ignores instancesPerOccurrence once anchors are set", () => {
    const planned = planRecurringTasks({
      rules: [rule({ weekdays: [1], anchors: ["ARRIVAL"], instancesPerOccurrence: 9 })],
      from: MON,
      to: MON,
    });

    expect(planned).toHaveLength(1);
  });

  it("names each one rather than numbering it", () => {
    const planned = planRecurringTasks({ rules: [anchored], from: MON, to: MON });

    // Generated names are written in the company's language, as the onboarding
    // interview titles already are.
    expect(planned[0].title).toBe("Warehouse stock count · al llegar");
    expect(planned[2].title).toBe("Warehouse stock count · antes de salir");
  });

  it("leaves the clock time open -- it depends on whose shift it is", () => {
    const planned = planRecurringTasks({ rules: [anchored], from: MON, to: MON });

    expect(planned.every((p) => p.fixedStartMinutes === null)).toBe(true);
  });

  it("groups a day's repetitions so one person gets all of them", () => {
    const planned = planRecurringTasks({ rules: [anchored], from: MON, to: MON });
    const keys = new Set(planned.map((p) => p.groupKey));

    expect(keys.size).toBe(1);
    expect([...keys][0]).not.toBeNull();
  });

  it("puts different days in different groups", () => {
    const planned = planRecurringTasks({
      rules: [rule({ weekdays: [1, 4], anchors: ["ARRIVAL", "BEFORE_LEAVING"] })],
      from: MON,
      to: FRI,
    });

    expect(new Set(planned.map((p) => p.groupKey)).size).toBe(2);
  });

  it("drops a repeated anchor rather than colliding on the key", () => {
    const planned = planRecurringTasks({
      rules: [rule({ weekdays: [1], anchors: ["ARRIVAL", "ARRIVAL"] })],
      from: MON,
      to: MON,
    });

    expect(planned).toHaveLength(1);
  });

  /**
   * The reason keys are built from the anchor and not a position: inserting a
   * midday check used to renumber every later one, so the stale sweep in
   * run.ts deleted and recreated tasks that had not changed.
   */
  it("keeps existing keys stable when an anchor is inserted in the middle", () => {
    const before = planRecurringTasks({
      rules: [rule({ weekdays: [1], anchors: ["ARRIVAL", "BEFORE_LEAVING"] })],
      from: MON,
      to: MON,
    });

    const after = planRecurringTasks({
      rules: [
        rule({
          weekdays: [1],
          anchors: ["ARRIVAL", "AFTER_BREAK", "BEFORE_LEAVING"],
        }),
      ],
      from: MON,
      to: MON,
    });

    const existing = new Set(before.map((p) => p.externalKey));
    const { toCreate } = diffAgainstExisting(after, existing);

    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].anchor).toBe("AFTER_BREAK");
  });

  it("re-keys only the one that moved when an anchor changes", () => {
    const before = planRecurringTasks({
      rules: [rule({ weekdays: [1], anchors: ["ARRIVAL", "BEFORE_BREAK"] })],
      from: MON,
      to: MON,
    });

    const after = planRecurringTasks({
      rules: [rule({ weekdays: [1], anchors: ["ARRIVAL", "AFTER_BREAK"] })],
      from: MON,
      to: MON,
    });

    const { toCreate } = diffAgainstExisting(
      after,
      new Set(before.map((p) => p.externalKey)),
    );

    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].anchor).toBe("AFTER_BREAK");
  });

  it("still numbers un-anchored repeats as before", () => {
    const planned = planRecurringTasks({
      rules: [rule({ weekdays: [1], instancesPerOccurrence: 2 })],
      from: MON,
      to: MON,
    });

    expect(planned.map((p) => p.title)).toEqual([
      "Warehouse stock count (1 of 2)",
      "Warehouse stock count (2 of 2)",
    ]);
    expect(planned.every((p) => p.anchor === null)).toBe(true);
    expect(planned.every((p) => p.groupKey === null)).toBe(true);
  });
});

describe("dropAlreadyCovered", () => {
  /** A rule that fires once on Monday and once on Thursday. */
  const onceADay = () =>
    planRecurringTasks({ rules: [rule()], from: MON, to: FRI });

  /** The same template at four points in the shift, one day only. */
  const fourTimes = () =>
    planRecurringTasks({
      rules: [
        rule({
          weekdays: [1],
          anchors: ["ARRIVAL", "BEFORE_BREAK", "AFTER_BREAK", "BEFORE_LEAVING"],
        }),
      ],
      from: MON,
      to: MON,
    });

  it("plans everything when nobody has claimed anything", () => {
    const { toPlan, covered } = dropAlreadyCovered(onceADay(), new Map());
    expect(toPlan).toHaveLength(2);
    expect(covered).toBe(0);
  });

  it("raises nothing for a once-a-day job somebody already claimed", () => {
    // The bug: a board tick on Monday plus the rule's own Monday instance is
    // the same job twice on one morning.
    const { toPlan, covered } = dropAlreadyCovered(
      onceADay(),
      new Map([[coverageKey("tpl-1", MON), 1]]),
    );

    expect(covered).toBe(1);
    expect(toPlan).toHaveLength(1);
    expect(toPlan[0].dueDate.toISOString().slice(0, 10)).toBe("2026-07-30");
  });

  it("tops a four-times-a-day routine up to four, not five", () => {
    const { toPlan, covered } = dropAlreadyCovered(
      fourTimes(),
      new Map([[coverageKey("tpl-1", MON), 1]]),
    );

    expect(covered).toBe(1);
    expect(toPlan).toHaveLength(3);
  });

  it("gives up the end of the day rather than the arrival check", () => {
    // "Al llegar" is an instruction somebody notices missing. The fourth
    // check of the afternoon is the one a claim can stand in for.
    const { toPlan } = dropAlreadyCovered(
      fourTimes(),
      new Map([[coverageKey("tpl-1", MON), 1]]),
    );

    expect(toPlan.map((t) => t.anchor)).toEqual([
      "ARRIVAL",
      "BEFORE_BREAK",
      "AFTER_BREAK",
    ]);
  });

  it("raises nothing at all when the whole routine is already claimed", () => {
    const { toPlan } = dropAlreadyCovered(
      fourTimes(),
      new Map([[coverageKey("tpl-1", MON), 4]]),
    );
    expect(toPlan).toEqual([]);
  });

  it("does not go negative when more is claimed than the rule wants", () => {
    const { toPlan, covered } = dropAlreadyCovered(
      onceADay(),
      new Map([[coverageKey("tpl-1", MON), 9]]),
    );
    expect(covered).toBe(1);
    expect(toPlan).toHaveLength(1);
  });

  it("only counts a claim against its own day", () => {
    const { toPlan } = dropAlreadyCovered(
      onceADay(),
      new Map([[coverageKey("tpl-1", MON), 1]]),
    );
    // Thursday is untouched by a Monday claim.
    expect(toPlan.map((t) => t.dueDate.toISOString().slice(0, 10))).toEqual([
      "2026-07-30",
    ]);
  });

  it("only counts a claim against its own template", () => {
    const { toPlan, covered } = dropAlreadyCovered(
      onceADay(),
      new Map([[coverageKey("tpl-other", MON), 3]]),
    );
    expect(covered).toBe(0);
    expect(toPlan).toHaveLength(2);
  });
});
