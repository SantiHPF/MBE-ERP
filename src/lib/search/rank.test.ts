import { describe, expect, it } from "vitest";
import { rankHits, type SearchHit } from "./rank";

const hit = (kind: SearchHit["kind"], title: string): SearchHit => ({
  kind,
  id: title,
  title,
  sub: "",
  href: "/x",
});

describe("rankHits", () => {
  it("puts a title starting with the query above one merely containing it", () => {
    const hits = [hit("task", "Revisión Portales"), hit("task", "Portales LATAM")];
    expect(rankHits(hits, "portales").map((h) => h.title)).toEqual([
      "Portales LATAM",
      "Revisión Portales",
    ]);
  });

  it("orders kinds tasks, people, P1N when the match is equally good", () => {
    const hits = [hit("p1n", "Ana"), hit("person", "Ana"), hit("task", "Ana")];
    expect(rankHits(hits, "ana").map((h) => h.kind)).toEqual([
      "task",
      "person",
      "p1n",
    ]);
  });

  it("ignores case and accents, because nobody types an accent in a hurry", () => {
    const hits = [hit("task", "Revisión Portales")];
    expect(rankHits(hits, "revision")).toHaveLength(1);
    expect(rankHits(hits, "REVISIÓN")).toHaveLength(1);
  });

  it("drops anything that does not match at all", () => {
    const hits = [hit("task", "Email"), hit("task", "Ofertas")];
    expect(rankHits(hits, "nada")).toEqual([]);
  });

  it("returns nothing for an empty query rather than everything", () => {
    const hits = [hit("task", "Email"), hit("person", "Ana Molina")];
    expect(rankHits(hits, "")).toEqual([]);
    expect(rankHits(hits, "   ")).toEqual([]);
  });

  it("breaks a tie by title so the order never wobbles between keystrokes", () => {
    const hits = [hit("task", "Ofertas B"), hit("task", "Ofertas A")];
    expect(rankHits(hits, "ofertas").map((h) => h.title)).toEqual([
      "Ofertas A",
      "Ofertas B",
    ]);
  });
});
