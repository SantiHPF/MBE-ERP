/**
 * Work that goes hand in hand.
 *
 * A catalogue entry can say it comes after another one -- you review the
 * portals, then you write the report. Planning the leader brings its followers
 * with it, placed immediately after, given to the same person, and unable to
 * start until the leader is done.
 *
 * The link is stored on the follower, so a leader may have several. That makes
 * the runtime shape a tree rather than a list, and the order things must happen
 * in is a depth-first walk of it.
 *
 * This half is pure: given the catalogue links, what hangs off a leader and in
 * what order. The writing lives in follow-db.ts.
 */

/**
 * How deep a chain may go.
 *
 * Not a technical limit -- a five-step chain is already a process rather than a
 * pair, and the catalogue is the wrong place to model a process. The cap exists
 * so that a mistake in the catalogue cannot generate an unbounded day.
 */
export const MAX_CHAIN = 5;

export type FollowLink = {
  /** The follower. */
  id: string;
  /** What it comes after, or null when it stands on its own. */
  followsId: string | null;
};

/**
 * Everything that hangs off `leaderId`, in the order it has to happen.
 *
 * Depth-first, so a follower's own followers come immediately after it rather
 * than after all its siblings: A -> (B -> C), D reads A, B, C, D. That is the
 * order somebody would actually work in.
 *
 * Anything deeper than MAX_CHAIN is dropped rather than throwing. A chain that
 * long is a catalogue mistake, and refusing to plan the day because of it would
 * punish the wrong person -- the tasks that do fit still get made.
 */
export function chainFrom(leaderId: string, links: FollowLink[]): string[] {
  const byLeader = new Map<string, string[]>();
  for (const link of links) {
    if (!link.followsId) continue;
    const list = byLeader.get(link.followsId);
    if (list) list.push(link.id);
    else byLeader.set(link.followsId, [link.id]);
  }

  const out: string[] = [];
  // Guards against a cycle the catalogue let through: without it, A -> B -> A
  // would walk forever.
  const seen = new Set<string>([leaderId]);

  const walk = (id: string, depth: number) => {
    if (depth >= MAX_CHAIN) return;
    for (const follower of byLeader.get(id) ?? []) {
      if (seen.has(follower)) continue;
      seen.add(follower);
      out.push(follower);
      walk(follower, depth + 1);
    }
  };

  walk(leaderId, 0);
  return out;
}

/**
 * Would pointing `id` at `followsId` create a cycle?
 *
 * Walks up from the proposed leader looking for the follower. Pointing a task
 * at itself is the degenerate case and is caught by the first comparison.
 */
export function wouldCycle(
  id: string,
  followsId: string,
  links: FollowLink[],
): boolean {
  const parentOf = new Map(links.map((l) => [l.id, l.followsId]));

  let cursor: string | null = followsId;
  const seen = new Set<string>();

  while (cursor) {
    if (cursor === id) return true;
    // A cycle that already exists upstream: stop rather than spin.
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }

  return false;
}

/**
 * How many steps deep `id` would sit, counting the leader at the top as 1.
 *
 * Used to refuse a link that would push an existing chain past MAX_CHAIN from
 * the middle, which walking downwards from the new follower would miss.
 */
export function depthOf(id: string, links: FollowLink[]): number {
  const parentOf = new Map(links.map((l) => [l.id, l.followsId]));

  let depth = 1;
  let cursor = parentOf.get(id) ?? null;
  const seen = new Set<string>([id]);

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = parentOf.get(cursor) ?? null;
  }

  return depth;
}

/** A stable key for a generated follower, so re-running never duplicates. */
export function buildFollowKey(
  leaderExternalKey: string,
  followerTemplateId: string,
): string {
  return `follows:${leaderExternalKey}:${followerTemplateId}`;
}
