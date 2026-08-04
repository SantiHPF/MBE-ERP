/**
 * What the top bar calls the page you are on.
 *
 * Both halves are dictionary keys, and both are the *same* keys the sidebar
 * uses -- a route named twice is a route that will eventually be named two
 * different things. Nothing here renders; the bar translates.
 */
export type Crumb = {
  titleKey: string;
  /** The nav group, shown small and faint after the title. Null when the
      page belongs to no group. */
  trailKey: string | null;
};

const ROUTES: Record<string, Crumb> = {
  "/my-day": { titleKey: "nav.myDay", trailKey: "nav.groupWork" },
  "/plan": { titleKey: "nav.planWeek", trailKey: "nav.groupWork" },
  "/my-calendar": { titleKey: "nav.myCalendar", trailKey: "nav.groupWork" },
  "/meetings": { titleKey: "nav.meetings", trailKey: "nav.groupWork" },
  "/messages": { titleKey: "nav.messages", trailKey: "nav.groupWork" },
  "/p1n": { titleKey: "nav.p1n", trailKey: "nav.groupWork" },

  "/team": { titleKey: "nav.team", trailKey: "nav.groupTeam" },
  "/triage": { titleKey: "nav.triage", trailKey: "nav.groupTeam" },
  "/catalogue": { titleKey: "nav.catalogue", trailKey: "nav.groupTeam" },

  "/hr/absences": { titleKey: "nav.requests", trailKey: "nav.groupHr" },
  "/hr/people": { titleKey: "nav.people", trailKey: "nav.groupHr" },
  "/crm/sources": { titleKey: "nav.crm", trailKey: "nav.groupHr" },
  "/crm/candidates": { titleKey: "nav.crm", trailKey: "nav.groupHr" },

  // Reached from the account row rather than the nav, so it has no group.
  "/me": { titleKey: "common.yourRecord", trailKey: null },
};

/**
 * Longest prefix wins, and only on a segment boundary.
 *
 * The boundary check is what stops "/team" claiming "/teamwork"; the length
 * ordering is what stops "/crm/sources" being answered by a bare "/crm" if
 * one is ever added.
 */
export function crumbFor(pathname: string): Crumb | null {
  let best: { path: string; crumb: Crumb } | null = null;

  for (const [path, crumb] of Object.entries(ROUTES)) {
    const matches = pathname === path || pathname.startsWith(`${path}/`);
    if (!matches) continue;
    if (!best || path.length > best.path.length) best = { path, crumb };
  }

  return best?.crumb ?? null;
}
