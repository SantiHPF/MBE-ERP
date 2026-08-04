/**
 * Ordering for the ⌘K results.
 *
 * Pure and separate from the queries, so "does a prefix beat a substring"
 * is a test rather than an argument. Fold and rank in memory: the whole
 * result set is a few dozen rows, and doing it in SQL would mean a ranking
 * nobody can read and three queries that have to agree about it.
 */

export type SearchKind = "task" | "person" | "p1n";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  /** What the row is called. Company content -- never translated. */
  title: string;
  /** The quiet second line: a date, a username, a cause. */
  sub: string;
  href: string;
};

/** Per kind, so one noisy kind cannot crowd the other two out. */
export const MAX_HITS = 6;

const KIND_ORDER: Record<SearchKind, number> = { task: 0, person: 1, p1n: 2 };

/**
 * Lowercased and stripped of diacritics. Somebody hunting for "Revisión" in
 * a hurry types "revision", and should not be punished for it.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function rankHits(hits: SearchHit[], query: string): SearchHit[] {
  const q = normalise(query.trim());
  // An empty box means "I have not asked yet", not "show me everything".
  if (q === "") return [];

  return hits
    .map((h) => ({ h, at: normalise(h.title).indexOf(q) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => {
      // A title that starts with what you typed is the one you meant.
      const prefix = Number(a.at !== 0) - Number(b.at !== 0);
      if (prefix !== 0) return prefix;

      const kind = KIND_ORDER[a.h.kind] - KIND_ORDER[b.h.kind];
      if (kind !== 0) return kind;

      // Deterministic, so the list does not reshuffle as you type.
      return a.h.title.localeCompare(b.h.title);
    })
    .map(({ h }) => h);
}
