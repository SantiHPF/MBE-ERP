import { describe, expect, it } from "vitest";
import { crumbFor } from "./breadcrumb";

describe("crumbFor", () => {
  it("names a top-level route and the nav group it sits in", () => {
    expect(crumbFor("/my-day")).toEqual({
      titleKey: "nav.myDay",
      trailKey: "nav.groupWork",
    });
    expect(crumbFor("/triage")).toEqual({
      titleKey: "nav.triage",
      trailKey: "nav.groupTeam",
    });
    expect(crumbFor("/hr/people")).toEqual({
      titleKey: "nav.people",
      trailKey: "nav.groupHr",
    });
  });

  it("falls back to the longest matching prefix for a nested route", () => {
    // A source's own page has no nav entry; it belongs to the list's.
    expect(crumbFor("/crm/sources/abc123")).toEqual({
      titleKey: "nav.crm",
      trailKey: "nav.groupHr",
    });
    expect(crumbFor("/meetings/xyz")).toEqual({
      titleKey: "nav.meetings",
      trailKey: "nav.groupWork",
    });
  });

  it("prefers the longer prefix when two routes share one", () => {
    // /crm/sources and /crm/candidates both start /crm.
    expect(crumbFor("/crm/candidates")?.titleKey).toBe("nav.crm");
    expect(crumbFor("/crm/sources")?.titleKey).toBe("nav.crm");
  });

  it("gives the personal record no trail, because it is in no group", () => {
    expect(crumbFor("/me")).toEqual({
      titleKey: "common.yourRecord",
      trailKey: null,
    });
  });

  it("returns null for a route it does not know", () => {
    // Better a bare bar than a confidently wrong title.
    expect(crumbFor("/nope")).toBeNull();
    expect(crumbFor("/")).toBeNull();
  });

  it("does not match a prefix that is not a path segment", () => {
    // "/team" must not claim "/teamwork".
    expect(crumbFor("/teamwork")).toBeNull();
  });
});
