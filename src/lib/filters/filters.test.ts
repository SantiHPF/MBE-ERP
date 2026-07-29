import { describe, expect, it } from "vitest";
import {
  activeCount,
  applyFilters,
  EMPTY_FILTERS,
  isActive,
  normalise,
  type Field,
  type FilterState,
} from "./filters";

type Row = {
  name: string;
  city: string | null;
  type: "UNIVERSITY" | "JOB_PORTAL";
  active: boolean;
  lastTalked: string | null;
  contacts: string[];
};

const FIELDS: Field<Row>[] = [
  { key: "name", label: "Name", kind: "text", get: (r) => r.name },
  { key: "city", label: "City", kind: "text", get: (r) => r.city },
  // One field, several strings: a university's people are searchable from the
  // university's own row.
  { key: "contacts", label: "Contacts", kind: "text", get: (r) => r.contacts },
  {
    key: "type",
    label: "Type",
    kind: "enum",
    options: [
      { value: "UNIVERSITY", label: "University" },
      { value: "JOB_PORTAL", label: "Portal" },
    ],
    get: (r) => r.type,
  },
  { key: "active", label: "Active", kind: "bool", yes: "Active", no: "Retired", get: (r) => r.active },
  { key: "lastTalked", label: "Last talked", kind: "date", get: (r) => r.lastTalked },
];

const ROWS: Row[] = [
  {
    name: "Universidad Politécnica",
    city: "Madrid",
    type: "UNIVERSITY",
    active: true,
    lastTalked: "2026-03-14 09:20",
    contacts: ["Pepito Perez", "600111222"],
  },
  {
    name: "Universidad Europea",
    city: "Valencia",
    type: "UNIVERSITY",
    active: false,
    lastTalked: null,
    contacts: ["Ana Ruiz"],
  },
  {
    name: "InfoJobs",
    city: null,
    type: "JOB_PORTAL",
    active: true,
    lastTalked: "2026-07-01",
    contacts: [],
  },
];

function state(over: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...over };
}

const names = (rows: Row[]) => rows.map((r) => r.name);

describe("normalise", () => {
  it("strips accents so a hurried search still finds things", () => {
    expect(normalise("Politécnica")).toBe("politecnica");
    expect(normalise("  ÁÉÍÓÚ ")).toBe("aeiou");
  });
});

describe("the search box", () => {
  it("shows everything when it is empty", () => {
    expect(applyFilters(ROWS, FIELDS, state())).toHaveLength(3);
  });

  it("matches without the accent the name actually has", () => {
    expect(names(applyFilters(ROWS, FIELDS, state({ query: "politecnica" })))).toEqual([
      "Universidad Politécnica",
    ]);
  });

  it("ignores case", () => {
    expect(applyFilters(ROWS, FIELDS, state({ query: "INFOJOBS" }))).toHaveLength(1);
  });

  it("searches every declared text field, not just the name", () => {
    expect(names(applyFilters(ROWS, FIELDS, state({ query: "valencia" })))).toEqual([
      "Universidad Europea",
    ]);
  });

  /** The reason a text field may return several strings. */
  it("finds a university by one of its contacts", () => {
    expect(names(applyFilters(ROWS, FIELDS, state({ query: "pepito" })))).toEqual([
      "Universidad Politécnica",
    ]);
  });

  it("finds one by a contact's phone number", () => {
    expect(applyFilters(ROWS, FIELDS, state({ query: "600111" }))).toHaveLength(1);
  });

  it("lets words match across different fields", () => {
    // "europea" is in the name, "valencia" in the city.
    expect(applyFilters(ROWS, FIELDS, state({ query: "europea valencia" }))).toHaveLength(1);
  });

  it("returns nothing when a word matches nowhere", () => {
    expect(applyFilters(ROWS, FIELDS, state({ query: "europea sevilla" }))).toHaveLength(0);
  });
});

describe("enum filters", () => {
  /** The mistake that empties a list the moment the panel opens. */
  it("with nothing chosen is a no-op, not a rejection", () => {
    expect(applyFilters(ROWS, FIELDS, state({ enums: { type: [] } }))).toHaveLength(3);
  });

  it("keeps only the chosen value", () => {
    const out = applyFilters(ROWS, FIELDS, state({ enums: { type: ["JOB_PORTAL"] } }));
    expect(names(out)).toEqual(["InfoJobs"]);
  });

  it("treats several chosen values as 'any of'", () => {
    const out = applyFilters(
      ROWS,
      FIELDS,
      state({ enums: { type: ["JOB_PORTAL", "UNIVERSITY"] } }),
    );
    expect(out).toHaveLength(3);
  });
});

describe("bool filters", () => {
  it("absent means no opinion", () => {
    expect(applyFilters(ROWS, FIELDS, state({ bools: {} }))).toHaveLength(3);
  });

  /** A checkbox cannot say "only the retired ones"; a tri-state can. */
  it("distinguishes wanting true from wanting false", () => {
    expect(names(applyFilters(ROWS, FIELDS, state({ bools: { active: true } })))).toEqual([
      "Universidad Politécnica",
      "InfoJobs",
    ]);
    expect(names(applyFilters(ROWS, FIELDS, state({ bools: { active: false } })))).toEqual([
      "Universidad Europea",
    ]);
  });
});

describe("date filters", () => {
  it("filters from a day, inclusive", () => {
    const out = applyFilters(ROWS, FIELDS, state({ dates: { lastTalked: { from: "2026-07-01" } } }));
    expect(names(out)).toEqual(["InfoJobs"]);
  });

  it("filters up to a day, inclusive", () => {
    const out = applyFilters(ROWS, FIELDS, state({ dates: { lastTalked: { to: "2026-03-14" } } }));
    expect(names(out)).toEqual(["Universidad Politécnica"]);
  });

  it("ignores the time when only the day was asked for", () => {
    // The stored value is "2026-03-14 09:20"; a plain string compare against
    // "2026-03-14" would drop it from a range ending that day.
    const out = applyFilters(
      ROWS,
      FIELDS,
      state({ dates: { lastTalked: { from: "2026-03-14", to: "2026-03-14" } } }),
    );
    expect(names(out)).toEqual(["Universidad Politécnica"]);
  });

  it("excludes rows with no date at all", () => {
    const out = applyFilters(ROWS, FIELDS, state({ dates: { lastTalked: { from: "2020-01-01" } } }));
    expect(names(out)).not.toContain("Universidad Europea");
  });

  it("with neither bound set is a no-op", () => {
    expect(applyFilters(ROWS, FIELDS, state({ dates: { lastTalked: {} } }))).toHaveLength(3);
  });
});

describe("combining filters", () => {
  it("narrows rather than widens", () => {
    const out = applyFilters(
      ROWS,
      FIELDS,
      state({ query: "universidad", enums: { type: ["UNIVERSITY"] }, bools: { active: true } }),
    );
    expect(names(out)).toEqual(["Universidad Politécnica"]);
  });

  it("can narrow to nothing", () => {
    const out = applyFilters(
      ROWS,
      FIELDS,
      state({ enums: { type: ["JOB_PORTAL"] }, bools: { active: false } }),
    );
    expect(out).toEqual([]);
  });

  it("restores the full list when cleared", () => {
    expect(applyFilters(ROWS, FIELDS, EMPTY_FILTERS)).toHaveLength(3);
  });
});

describe("isActive / activeCount", () => {
  it("is quiet when nothing is set", () => {
    expect(isActive(EMPTY_FILTERS)).toBe(false);
    expect(activeCount(EMPTY_FILTERS)).toBe(0);
  });

  it("does not count an empty enum choice as a filter", () => {
    expect(isActive(state({ enums: { type: [] } }))).toBe(false);
    expect(activeCount(state({ enums: { type: [] } }))).toBe(0);
  });

  it("counts each condition once", () => {
    const s = state({
      query: "x",
      enums: { type: ["UNIVERSITY"] },
      bools: { active: true },
      dates: { lastTalked: { from: "2026-01-01" } },
    });
    expect(activeCount(s)).toBe(4);
    expect(isActive(s)).toBe(true);
  });

  it("does not count whitespace as a search", () => {
    expect(isActive(state({ query: "   " }))).toBe(false);
  });
});
