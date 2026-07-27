import { describe, expect, it } from "vitest";
import { isEffective } from "./effective";
import { computeAvailability } from "@/lib/scheduling/availability";

const MON = new Date(Date.UTC(2026, 6, 27));
const at = (h: number) => h * 60;

const PATTERNS = [
  { weekday: 1, startMinutes: at(9), endMinutes: at(17), breakMinutes: 0 },
];

describe("isEffective", () => {
  it("counts an approved absence whatever it is", () => {
    for (const category of ["SICK", "HOLIDAY", "PERSONAL", "OTHER"] as const) {
      expect(isEffective({ category, status: "APPROVED" })).toBe(true);
    }
  });

  it("ignores a rejected absence, including sickness", () => {
    for (const category of ["SICK", "HOLIDAY", "PERSONAL", "OTHER"] as const) {
      expect(isEffective({ category, status: "REJECTED" })).toBe(false);
    }
  });

  it("counts a pending sick day, because they are not at work", () => {
    expect(isEffective({ category: "SICK", status: "PENDING" })).toBe(true);
  });

  it("does not count pending leave that HR has not approved", () => {
    expect(isEffective({ category: "HOLIDAY", status: "PENDING" })).toBe(false);
    expect(isEffective({ category: "PERSONAL", status: "PENDING" })).toBe(false);
    expect(isEffective({ category: "OTHER", status: "PENDING" })).toBe(false);
  });

  it("counts records that predate approval", () => {
    expect(isEffective({})).toBe(true);
  });
});

describe("availability honours the approval rule", () => {
  const absence = (
    category: "SICK" | "HOLIDAY",
    status: "PENDING" | "APPROVED" | "REJECTED",
  ) => ({
    startDate: MON,
    endDate: MON,
    scope: "FULL_DAY" as const,
    category,
    status,
  });

  it("a phoned-in sick day empties the day straight away", () => {
    const result = computeAvailability({
      date: MON,
      patterns: PATTERNS,
      absences: [absence("SICK", "PENDING")],
    });

    expect(result.availableMinutes).toBe(0);
  });

  it("a holiday request does not free the day until HR approves", () => {
    const pending = computeAvailability({
      date: MON,
      patterns: PATTERNS,
      absences: [absence("HOLIDAY", "PENDING")],
    });
    expect(pending.availableMinutes).toBe(480);

    const approved = computeAvailability({
      date: MON,
      patterns: PATTERNS,
      absences: [absence("HOLIDAY", "APPROVED")],
    });
    expect(approved.availableMinutes).toBe(0);
  });

  it("a rejected sick day puts the person back on the schedule", () => {
    const result = computeAvailability({
      date: MON,
      patterns: PATTERNS,
      absences: [absence("SICK", "REJECTED")],
    });

    expect(result.availableMinutes).toBe(480);
    expect(result.reducedBy).toBe("none");
  });
});
