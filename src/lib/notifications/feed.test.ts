import { describe, expect, it } from "vitest";
import { buildFeed, MAX_ROWS, type FeedInput } from "./feed";

const EMPTY: FeedInput = { messages: [], absences: [], orphans: [], blocks: [] };

const INPUT: FeedInput = {
  messages: [
    { id: "m1", from: "Marta Ruiz", preview: "¿Cojo Portales?", at: "2026-08-03T11:02:00.000Z" },
  ],
  absences: [
    { id: "a1", person: "Ana Molina", dates: "03/08 – 05/08", at: "2026-08-03T08:12:00.000Z" },
  ],
  orphans: [
    { id: "o1", title: "Revisión Portales", at: "2026-08-03T16:00:00.000Z" },
  ],
  blocks: [
    { id: "b1", title: "Meter Candidatos Latam", at: "2026-08-03T11:20:00.000Z" },
  ],
};

describe("buildFeed", () => {
  it("puts the newest thing first, whatever kind it is", () => {
    const { rows } = buildFeed(INPUT, null);
    expect(rows.map((r) => r.id)).toEqual([
      "orphan:o1", // 16:00
      "block:b1", // 11:20
      "message:m1", // 11:02
      "absence:a1", // 08:12
    ]);
  });

  it("gives each kind its semantic tone and its destination", () => {
    const byId = Object.fromEntries(buildFeed(INPUT, null).rows.map((r) => [r.id, r]));
    expect(byId["message:m1"]).toMatchObject({ tone: "accent", href: "/messages" });
    expect(byId["absence:a1"]).toMatchObject({ tone: "pause", href: "/hr/absences" });
    expect(byId["orphan:o1"]).toMatchObject({ tone: "stall", href: "/triage" });
    expect(byId["block:b1"]).toMatchObject({ tone: "stall", href: "/triage" });
  });

  it("keeps the company's own words out of the dictionary", () => {
    const byId = Object.fromEntries(buildFeed(INPUT, null).rows.map((r) => [r.id, r]));
    // The template is a key; the name and the message are data.
    expect(byId["message:m1"].titleKey).toBe("notifications.newMessage");
    expect(byId["message:m1"].titleArgs).toEqual(["Marta Ruiz"]);
    expect(byId["message:m1"].body).toBe("¿Cojo Portales?");
    // A task's title is the company's, so it is the body, never a key.
    expect(byId["orphan:o1"].titleKey).toBe("notifications.orphaned");
    expect(byId["orphan:o1"].titleArgs).toEqual([]);
    expect(byId["orphan:o1"].body).toBe("Revisión Portales");
  });

  it("counts everything as unread when nothing has ever been seen", () => {
    expect(buildFeed(INPUT, null).unread).toBe(4);
  });

  it("counts only what arrived after the last look", () => {
    // 11:02 -- the message and everything older is read.
    expect(buildFeed(INPUT, "2026-08-03T11:02:00.000Z").unread).toBe(2);
  });

  it("treats a row landing exactly on the timestamp as read", () => {
    const one: FeedInput = { ...EMPTY, messages: INPUT.messages };
    expect(buildFeed(one, "2026-08-03T11:02:00.000Z").unread).toBe(0);
  });

  it("counts unread across everything but hands back only a popover's worth", () => {
    const many: FeedInput = {
      ...EMPTY,
      messages: Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({
        id: `m${i}`,
        from: "Marta Ruiz",
        preview: "hola",
        // Ascending, so the newest are the last generated.
        at: new Date(Date.UTC(2026, 7, 3, 9, i)).toISOString(),
      })),
    };
    const { rows, unread } = buildFeed(many, null);
    expect(unread).toBe(MAX_ROWS + 5);
    expect(rows).toHaveLength(MAX_ROWS);
    // The ones kept are the newest, not the first generated.
    expect(rows[0].id).toBe(`message:m${MAX_ROWS + 4}`);
  });

  it("is empty, not broken, when there is nothing waiting", () => {
    expect(buildFeed(EMPTY, null)).toEqual({ rows: [], unread: 0 });
  });
});
