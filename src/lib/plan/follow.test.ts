import { describe, it, expect } from "vitest";
import {
  buildFollowKey,
  chainFrom,
  depthOf,
  MAX_CHAIN,
  wouldCycle,
  type FollowLink,
} from "./follow";

/** "b follows a" reads as b -> a, which is how the column stores it. */
function links(...pairs: [string, string | null][]): FollowLink[] {
  return pairs.map(([id, followsId]) => ({ id, followsId }));
}

describe("chainFrom", () => {
  it("finds nothing for a task that stands on its own", () => {
    expect(chainFrom("a", links(["a", null], ["b", null]))).toEqual([]);
  });

  it("finds the one task that comes after", () => {
    expect(chainFrom("a", links(["a", null], ["b", "a"]))).toEqual(["b"]);
  });

  it("finds every task hanging off the same leader", () => {
    // Reviewing the portals produces both a report and a Gantt update.
    const l = links(["a", null], ["report", "a"], ["gantt", "a"]);
    expect(chainFrom("a", l)).toEqual(["report", "gantt"]);
  });

  it("walks depth-first, so a follower's own follower comes next", () => {
    // a -> (b -> c), d is worked as a, b, c, d -- not a, b, d, c.
    const l = links(["a", null], ["b", "a"], ["c", "b"], ["d", "a"]);
    expect(chainFrom("a", l)).toEqual(["b", "c", "d"]);
  });

  it("ignores chains belonging to a different leader", () => {
    const l = links(["a", null], ["b", "a"], ["x", null], ["y", "x"]);
    expect(chainFrom("a", l)).toEqual(["b"]);
  });

  it("survives a cycle the catalogue let through", () => {
    // Never reachable through the UI, but a direct database edit could do it,
    // and walking it forever would take the scheduler down.
    const l = links(["a", "c"], ["b", "a"], ["c", "b"]);
    expect(chainFrom("a", l)).toEqual(["b", "c"]);
  });

  it("stops at the depth cap rather than generating an unbounded day", () => {
    const l: FollowLink[] = [{ id: "t0", followsId: null }];
    for (let i = 1; i <= 20; i++) l.push({ id: `t${i}`, followsId: `t${i - 1}` });

    expect(chainFrom("t0", l)).toHaveLength(MAX_CHAIN);
  });
});

describe("wouldCycle", () => {
  it("refuses a task pointed at itself", () => {
    expect(wouldCycle("a", "a", links(["a", null]))).toBe(true);
  });

  it("refuses a link that closes a loop", () => {
    // b already follows a; making a follow b would close it.
    expect(wouldCycle("a", "b", links(["a", null], ["b", "a"]))).toBe(true);
  });

  it("refuses a link that closes a longer loop", () => {
    const l = links(["a", null], ["b", "a"], ["c", "b"]);
    expect(wouldCycle("a", "c", l)).toBe(true);
  });

  it("allows an ordinary link", () => {
    expect(wouldCycle("b", "a", links(["a", null], ["b", null]))).toBe(false);
  });

  it("allows a second follower on the same leader", () => {
    const l = links(["a", null], ["b", "a"], ["c", null]);
    expect(wouldCycle("c", "a", l)).toBe(false);
  });

  it("terminates on a cycle that already exists upstream", () => {
    const l = links(["x", "y"], ["y", "x"], ["new", null]);
    expect(wouldCycle("new", "x", l)).toBe(false);
  });
});

describe("depthOf", () => {
  it("counts a standalone task as the first step", () => {
    expect(depthOf("a", links(["a", null]))).toBe(1);
  });

  it("counts each step up the chain", () => {
    const l = links(["a", null], ["b", "a"], ["c", "b"]);
    expect(depthOf("c", l)).toBe(3);
  });

  it("terminates on a cycle rather than counting forever", () => {
    expect(depthOf("a", links(["a", "b"], ["b", "a"]))).toBe(2);
  });
});

describe("buildFollowKey", () => {
  it("is stable, so regenerating never duplicates the follower", () => {
    const key = buildFollowKey("recurring:rule-1:2026-07-30:1", "tpl-report");
    expect(key).toBe("follows:recurring:rule-1:2026-07-30:1:tpl-report");
    expect(buildFollowKey("recurring:rule-1:2026-07-30:1", "tpl-report")).toBe(key);
  });

  it("differs per follower, so two followers do not collide", () => {
    expect(buildFollowKey("k", "one")).not.toBe(buildFollowKey("k", "two"));
  });
});
