import { describe, expect, it } from "vitest";
import { addMonths, planOnboarding } from "./onboarding";

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
const keys = (tasks: { dueDate: Date }[]) =>
  tasks.map((t) => t.dueDate.toISOString().slice(0, 10));

function plan(over: Partial<Parameters<typeof planOnboarding>[0]> = {}) {
  return planOnboarding({
    userId: "u1",
    displayName: "Ana Molina",
    startDate: D("2026-03-02"),
    endDate: null,
    horizon: D("2026-12-31"),
    ...over,
  });
}

describe("addMonths", () => {
  it("clamps to the end of a shorter month", () => {
    // 31 January plus one month is the end of February, not 3 March.
    expect(addMonths(D("2026-01-31"), 1).toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
  });

  it("handles a leap February", () => {
    expect(addMonths(D("2028-01-31"), 1).toISOString().slice(0, 10)).toBe(
      "2028-02-29",
    );
  });

  it("crosses a year boundary", () => {
    expect(addMonths(D("2026-11-15"), 4).toISOString().slice(0, 10)).toBe(
      "2027-03-15",
    );
  });
});

describe("planOnboarding", () => {
  it("books the references interview on the first day", () => {
    const refs = plan().filter((t) => t.kind === "REFERENCES");
    expect(keys(refs)).toEqual(["2026-03-02"]);
  });

  it("books the weekly interview one week in", () => {
    const weekly = plan().filter((t) => t.kind === "WEEKLY");
    expect(keys(weekly)).toEqual(["2026-03-09"]);
  });

  it("books the bimonthly review every two months from month two", () => {
    const every = plan().filter((t) => t.kind === "BIMONTHLY");
    expect(keys(every)).toEqual([
      "2026-05-02",
      "2026-07-02",
      "2026-09-02",
      "2026-11-02",
    ]);
  });

  it("stops the bimonthly review when they leave", () => {
    const every = plan({ endDate: D("2026-08-01") }).filter(
      (t) => t.kind === "BIMONTHLY",
    );
    expect(keys(every)).toEqual(["2026-05-02", "2026-07-02"]);
  });

  it("generates nothing at all after the leaving date", () => {
    const tasks = plan({ endDate: D("2026-03-05") });
    // Only the references interview fits; the weekly one is two days late.
    expect(tasks.map((t) => t.kind)).toEqual(["REFERENCES"]);
  });

  it("keeps generating for an indefinite contract, up to the horizon", () => {
    const near = plan({ horizon: D("2026-06-30") });
    const far = plan({ horizon: D("2027-06-30") });
    expect(near.filter((t) => t.kind === "BIMONTHLY")).toHaveLength(1);
    expect(far.filter((t) => t.kind === "BIMONTHLY").length).toBeGreaterThan(5);
  });

  it("names each task after the person, so HR knows who it is about", () => {
    expect(plan()[0].title).toBe("Entrevista de Referencias — Ana Molina");
  });

  it("produces stable keys, so regenerating never duplicates", () => {
    const a = plan().map((t) => t.externalKey);
    const b = plan().map((t) => t.externalKey);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("comes back in date order", () => {
    const dates = plan().map((t) => t.dueDate.getTime());
    expect([...dates].sort((x, y) => x - y)).toEqual(dates);
  });

  it("clamps a month-end start date sensibly", () => {
    const every = plan({ startDate: D("2026-03-31") }).filter(
      (t) => t.kind === "BIMONTHLY",
    );
    // 31 May exists; 31 July exists; the end of September does not, so 30th.
    expect(keys(every).slice(0, 3)).toEqual([
      "2026-05-31",
      "2026-07-31",
      "2026-09-30",
    ]);
  });

  it("uses catalogue durations when given", () => {
    const tasks = plan({ minutes: { REFERENCES: 45 } });
    const refs = tasks.find((t) => t.kind === "REFERENCES");
    expect(refs?.estimatedMinutes).toBe(45);
    // The others keep their defaults.
    expect(tasks.find((t) => t.kind === "WEEKLY")?.estimatedMinutes).toBe(30);
  });
});
