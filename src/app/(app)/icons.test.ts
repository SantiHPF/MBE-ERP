import { describe, expect, it } from "vitest";
import { ICON_PATHS, type IconName } from "./icons";

// Every nav destination and every top-bar control needs one.
const REQUIRED: IconName[] = [
  "day", "plan", "calendar", "meetings", "p1n", "messages",
  "team", "triage", "catalogue", "perf", "attendance",
  "requests", "people", "sources", "candidates", "me", "mobile",
  "search", "bell",
];

describe("ICON_PATHS", () => {
  it("has a path for every name the shell asks for", () => {
    for (const name of REQUIRED) {
      expect(ICON_PATHS[name], name).toBeTruthy();
    }
  });

  it("draws every icon on the 16x16 grid the stroke width assumes", () => {
    // A path is a run of SVG commands over coordinates. Nothing should stray
    // outside 0-16: a 1.4 stroke on a larger grid would render thinner than
    // every other icon once scaled.
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(numbers.length, name).toBeGreaterThan(0);
      for (const n of numbers) {
        expect(Number(n), `${name}: ${n}`).toBeLessThanOrEqual(16);
        expect(Number(n), `${name}: ${n}`).toBeGreaterThanOrEqual(-16);
      }
    }
  });
});
