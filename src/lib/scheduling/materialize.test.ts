import { describe, expect, it } from "vitest";
import {
  buildRecurringKey,
  diffAgainstExisting,
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
