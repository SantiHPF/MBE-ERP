/**
 * Filtering a list by any of its properties.
 *
 * The fields are declared rather than hard-coded into a control, so adding
 * something filterable later is one line in a list instead of a new widget.
 * That is the difference between "you can filter by these four things" and
 * "you can filter by whatever the row has".
 *
 * Pure and database-free, so the rules are testable and the same list can be
 * filtered on the client without a round trip.
 */

export type FilterOption = { value: string; label: string };

export type Field<T> =
  | {
      key: string;
      label: string;
      kind: "text";
      /** Several strings for one field is fine -- a source's contacts, say. */
      get: (row: T) => (string | null | undefined)[] | string | null | undefined;
    }
  | {
      key: string;
      label: string;
      kind: "enum";
      options: FilterOption[];
      get: (row: T) => string | null | undefined;
    }
  | {
      key: string;
      label: string;
      kind: "bool";
      /** Wording for the two sides, e.g. "Retired" / "Active". */
      yes: string;
      no: string;
      get: (row: T) => boolean;
    }
  | {
      key: string;
      label: string;
      kind: "date";
      /** A sortable string: YYYY-MM-DD, optionally with a time after it. */
      get: (row: T) => string | null | undefined;
    };

export type FilterState = {
  /** Matched against every text field at once. */
  query: string;
  /** Field key -> chosen values. An empty list means "no opinion". */
  enums: Record<string, string[]>;
  /** Field key -> true / false. Absent means "no opinion". */
  bools: Record<string, boolean>;
  /** Field key -> inclusive bounds, either end optional. */
  dates: Record<string, { from?: string; to?: string }>;
};

export const EMPTY_FILTERS: FilterState = {
  query: "",
  enums: {},
  bools: {},
  dates: {},
};

/**
 * Lowercased and stripped of accents.
 *
 * Nobody types "Politécnica" into a search box when they are looking for it
 * in a hurry, and a Spanish list that only matches the accented spelling is a
 * list you cannot search.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function textValues<T>(field: Field<T>, row: T): string[] {
  if (field.kind !== "text") return [];
  const raw = field.get(row);
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Is anything actually being filtered on? */
export function isActive(state: FilterState): boolean {
  return (
    state.query.trim() !== "" ||
    Object.values(state.enums).some((v) => v.length > 0) ||
    Object.keys(state.bools).length > 0 ||
    Object.values(state.dates).some((d) => d.from || d.to)
  );
}

/** How many separate conditions are on, for the "clear (3)" affordance. */
export function activeCount(state: FilterState): number {
  return (
    (state.query.trim() ? 1 : 0) +
    Object.values(state.enums).filter((v) => v.length > 0).length +
    Object.keys(state.bools).length +
    Object.values(state.dates).filter((d) => d.from || d.to).length
  );
}

function matchesQuery<T>(row: T, fields: Field<T>[], query: string): boolean {
  const needle = normalise(query);
  if (!needle) return true;

  // Every word has to appear somewhere, but not necessarily in the same
  // field: "europea perez" should find Pepito Perez at Universidad Europea.
  const haystack = fields
    .flatMap((f) => textValues(f, row))
    .map(normalise)
    .join(" ");

  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

export function applyFilters<T>(
  rows: T[],
  fields: Field<T>[],
  state: FilterState,
): T[] {
  return rows.filter((row) => {
    if (!matchesQuery(row, fields, state.query)) return false;

    for (const field of fields) {
      if (field.kind === "enum") {
        const chosen = state.enums[field.key];
        // Nothing chosen is "no opinion", not "match nothing" -- the mistake
        // that makes a filter panel show an empty list the moment it opens.
        if (!chosen || chosen.length === 0) continue;
        const value = field.get(row);
        if (!value || !chosen.includes(value)) return false;
      }

      if (field.kind === "bool") {
        const wanted = state.bools[field.key];
        if (wanted === undefined) continue;
        if (field.get(row) !== wanted) return false;
      }

      if (field.kind === "date") {
        const bounds = state.dates[field.key];
        if (!bounds || (!bounds.from && !bounds.to)) continue;
        const value = field.get(row);
        // A row with no date cannot satisfy a date range; excluding it is the
        // honest answer to "updated since March".
        if (!value) return false;
        const day = value.slice(0, 10);
        if (bounds.from && day < bounds.from) return false;
        if (bounds.to && day > bounds.to) return false;
      }
    }

    return true;
  });
}
