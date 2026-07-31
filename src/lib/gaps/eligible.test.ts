import { describe, it, expect } from "vitest";
import { isCadence, isHourBound, isOfferable, type Candidate } from "./eligible";

const TODAY = new Date("2026-07-29T00:00:00Z");

function day(offset: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    anchor: null,
    isMeeting: false,
    hasFixedTime: false,
    origin: "MANUAL",
    dueDate: TODAY,
    ...over,
  };
}

describe("isHourBound", () => {
  it("catches work anchored to a point in the day", () => {
    // "CRM al llegar" cannot be done at four in the afternoon.
    expect(isHourBound(candidate({ anchor: "ARRIVAL" }))).toBe(true);
    expect(isHourBound(candidate({ anchor: "BEFORE_LEAVING" }))).toBe(true);
  });

  it("catches work pinned to a clock time by its rule", () => {
    expect(isHourBound(candidate({ hasFixedTime: true }))).toBe(true);
  });

  it("catches meetings, which are not yours alone to move", () => {
    expect(isHourBound(candidate({ isMeeting: true }))).toBe(true);
  });

  it("leaves ordinary work alone", () => {
    expect(isHourBound(candidate())).toBe(false);
  });
});

describe("isCadence", () => {
  it("counts recurring work, which includes onboarding interviews", () => {
    expect(isCadence(candidate({ origin: "RECURRING" }))).toBe(true);
  });

  it("counts the daily CRM call batch", () => {
    expect(isCadence(candidate({ origin: "CRM" }))).toBe(true);
  });

  it("does not count work with a real deadline", () => {
    for (const origin of ["MANUAL", "SHEET", "CATALOGUE", "MEETING"]) {
      expect(isCadence(candidate({ origin }))).toBe(false);
    }
  });
});

describe("isOfferable", () => {
  it("never offers hour-bound work, whatever tier it came from", () => {
    const anchored = candidate({ anchor: "ARRIVAL", origin: "RECURRING" });
    expect(isOfferable(anchored, "unassigned", TODAY)).toBe(false);
    expect(isOfferable(anchored, "pullForward", TODAY)).toBe(false);
    expect(isOfferable(anchored, "spare", TODAY)).toBe(false);
    // Not even an orphan: the exemption is from the cadence rule, not this one.
    expect(isOfferable(anchored, "orphaned", TODAY)).toBe(false);
  });

  it("offers cadence work on the day it is due", () => {
    const due = candidate({ origin: "RECURRING", dueDate: TODAY });
    expect(isOfferable(due, "unassigned", TODAY)).toBe(true);
  });

  it("will not catch up a cadence occurrence that has passed", () => {
    // The bimonthly interview of March 2023. Doing it now is not catching up.
    const stale = candidate({ origin: "RECURRING", dueDate: day(-1200) });
    expect(isOfferable(stale, "unassigned", TODAY)).toBe(false);
  });

  it("will not pull a cadence occurrence forward", () => {
    const future = candidate({ origin: "RECURRING", dueDate: day(3) });
    expect(isOfferable(future, "pullForward", TODAY)).toBe(false);
  });

  it("still treats a missed real deadline as debt", () => {
    // A sheet job that was due last week is genuinely owed, unlike a cadence.
    const late = candidate({ origin: "SHEET", dueDate: day(-7) });
    expect(isOfferable(late, "unassigned", TODAY)).toBe(true);
  });

  it("still lets non-cadence work be pulled forward", () => {
    const future = candidate({ origin: "SHEET", dueDate: day(3) });
    expect(isOfferable(future, "pullForward", TODAY)).toBe(true);
  });

  it("rescues an orphaned cadence occurrence, which is the point of triage", () => {
    // Dropped by an absence: nobody will do it unless somebody takes it.
    const orphan = candidate({ origin: "RECURRING", dueDate: day(1) });
    expect(isOfferable(orphan, "orphaned", TODAY)).toBe(true);
    // The same task in any other tier stays off limits.
    expect(isOfferable(orphan, "pullForward", TODAY)).toBe(false);
  });
});
