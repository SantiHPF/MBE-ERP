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
