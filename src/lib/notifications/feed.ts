/**
 * What is waiting for you, folded into one list.
 *
 * There is no Notification table and deliberately so -- see the spec. Every
 * row here is derived from something the app already stores, which is why the
 * bell can never disagree with the page it points at. The cost is that a
 * single row cannot be dismissed; the design does not ask for that, it asks
 * for "Marcar leídos", all of them.
 *
 * This half is pure. Fetching is read.ts's job, and keeping the two apart is
 * what lets the ordering and the unread boundary be tested without a
 * database.
 */

export type NotificationTone = "accent" | "pause" | "stall";

export type NotificationRow = {
  /** Kind-prefixed, because a message and a task can share an id. */
  id: string;
  tone: NotificationTone;
  /**
   * Interface copy, as a dictionary key plus its arguments. What the company
   * typed -- names, task titles, message text -- goes in `body` or into
   * `titleArgs`, never into the dictionary.
   */
  titleKey: string;
  titleArgs: string[];
  body: string;
  href: string;
  /** ISO instant. */
  at: string;
};

export type FeedInput = {
  messages: { id: string; from: string; preview: string; at: string }[];
  absences: { id: string; person: string; dates: string; at: string }[];
  orphans: { id: string; title: string; at: string }[];
  blocks: { id: string; title: string; at: string }[];
};

export type Feed = {
  rows: NotificationRow[];
  /** Counted across everything, not just the rows handed back. */
  unread: number;
};

/** As many as the 348px popover shows without becoming a page of its own. */
export const MAX_ROWS = 20;

export function buildFeed(input: FeedInput, seenAt: string | null): Feed {
  const rows: NotificationRow[] = [
    ...input.messages.map((m) => ({
      id: `message:${m.id}`,
      tone: "accent" as const,
      titleKey: "notifications.newMessage",
      titleArgs: [m.from],
      body: m.preview,
      href: "/messages",
      at: m.at,
    })),
    ...input.absences.map((a) => ({
      id: `absence:${a.id}`,
      tone: "pause" as const,
      titleKey: "notifications.absencePending",
      titleArgs: [a.person],
      body: a.dates,
      href: "/hr/absences",
      at: a.at,
    })),
    ...input.orphans.map((o) => ({
      id: `orphan:${o.id}`,
      tone: "stall" as const,
      titleKey: "notifications.orphaned",
      titleArgs: [],
      body: o.title,
      href: "/triage",
      at: o.at,
    })),
    ...input.blocks.map((b) => ({
      id: `block:${b.id}`,
      tone: "stall" as const,
      titleKey: "notifications.blocked",
      titleArgs: [],
      body: b.title,
      href: "/triage",
      at: b.at,
    })),
  ];

  rows.sort((a, b) => b.at.localeCompare(a.at));

  /*
   * Strictly after, so the instant `markSeen()` wrote is itself read. The
   * alternative loses the race with anything landing in the same millisecond
   * as the click -- rarer, but it leaves a badge that will not clear.
   */
  const unread =
    seenAt === null ? rows.length : rows.filter((r) => r.at > seenAt).length;

  // Counted first, sliced second: the badge tells the truth even when the
  // list cannot show all of it.
  return { rows: rows.slice(0, MAX_ROWS), unread };
}
