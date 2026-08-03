# Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the ERP's shell — sidebar, top bar, now bar — to the `design_handoff_mbe_erp` design, and define the CSS primitives the four later sub-projects consume.

**Architecture:** Pure, testable logic lands first (breadcrumb resolution, the notifications feed, search ranking) as plain functions under `src/lib`, unit-tested with vitest and no database. The UI then consumes them. The notifications feed derives from readers that already exist (`unreadFor`, `getTriageQueue`, `getStuckQueue`) rather than a new table, so the bell can never disagree with `/triage`.

**Tech Stack:** Next.js 16 App Router (server components by default), React 19, TypeScript, Tailwind v4 (`@theme` + `@layer components` in `src/app/globals.css`), Prisma 7 + Postgres, vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-03-shell-redesign-design.md`. Read it before starting.
- **No hardcoded Spanish or English.** Every interface string goes in `src/lib/i18n/dictionary.ts` under both `en` and `es`. `dictionary.test.ts` already asserts the two have identical key sets and will fail if you add to one only.
- **Company content is never translated.** Task titles, message bodies, people's names, pause reasons as typed — these pass through as data. Only interface copy gets a key. This rule is documented at the top of `dictionary.ts`.
- **Routes keep their current paths.** `/hr/absences`, `/hr/people`, `/my-calendar`, `/crm/sources`, `/crm/candidates`. Do not rename anything to match the handoff's route names.
- **Colours come from tokens only.** Use `var(--color-*)` or the Tailwind classes bound to them (`bg-surface`, `text-accent`, `border-line`). Never write a hex value from the handoff table into a component — every one of them is already in `globals.css`.
- **Tests are lib-level.** There is no component-test harness in this repo and this sub-project does not add one. Test pure functions under `src/lib`.
- **Run tests with:** `npm test` (vitest run). A single file: `npx vitest run src/lib/path/file.test.ts`.
- **Typecheck with:** `npx tsc --noEmit`.
- **Commit after every task.** End commit messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

```
src/app/(app)/
  icons.tsx                       CREATE  ICON_PATHS map + <Icon>
  icons.test.ts                   CREATE
  breadcrumb.ts                   CREATE  pathname → dictionary keys
  breadcrumb.test.ts              CREATE
  layout.tsx                      MODIFY  238px sidebar, brand, TopBar
  nav-link.tsx                    MODIFY  icon slot, inset active rail
  message-badge.tsx               MODIFY  accent → pause
  top-bar.tsx                     CREATE  57px sticky bar
  now-bar.tsx                     MODIFY  restyle only
  notifications/bell.tsx          CREATE
  notifications/popover.tsx       CREATE
  command-palette.tsx             CREATE

src/lib/
  notifications/feed.ts           CREATE  buildFeed() — pure
  notifications/feed.test.ts      CREATE
  notifications/read.ts           CREATE  getNotifications() — DB
  notifications/actions.ts        CREATE  markSeen()
  search/rank.ts                  CREATE  rankHits() — pure
  search/rank.test.ts             CREATE
  search/actions.ts               CREATE  search() — server action
  i18n/dictionary.ts              MODIFY  new keys, en + es

prisma/schema.prisma              MODIFY  User.notificationsSeenAt
src/app/globals.css               MODIFY  type tokens, radii, primitives
```

---

### Task 1: The icon set

18 nav icons plus magnifier and bell, lifted verbatim from the prototype's `ICONS` map. Exported as plain data so it can be tested without React.

**Files:**
- Create: `src/app/(app)/icons.tsx`
- Test: `src/app/(app)/icons.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ICON_PATHS: Record<IconName, string>`, `type IconName`, and `Icon({ name, className }: { name: IconName; className?: string })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/(app)/icons.test.ts
import { describe, expect, it } from "vitest";
import { ICON_PATHS, type IconName } from "./icons";

// Every nav destination and every top-bar control needs one.
const REQUIRED: IconName[] = [
  "day", "plan", "calendar", "meetings", "p1n", "messages",
  "team", "triage", "catalogue", "perf", "attendance",
  "requests", "people", "sources", "candidates", "me", "mobile",
  "search", "bell",
];

describe("ICON_PATHS", () => {
  it("has a path for every name the shell asks for", () => {
    for (const name of REQUIRED) {
      expect(ICON_PATHS[name], name).toBeTruthy();
    }
  });

  it("draws every icon on the 16x16 grid the stroke width assumes", () => {
    // A path is a run of SVG commands over coordinates. Nothing should stray
    // outside 0-16: a 1.4 stroke on a larger grid would render thinner than
    // every other icon once scaled.
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(numbers.length, name).toBeGreaterThan(0);
      for (const n of numbers) {
        expect(Number(n), `${name}: ${n}`).toBeLessThanOrEqual(16);
        expect(Number(n), `${name}: ${n}`).toBeGreaterThanOrEqual(-16);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(app)/icons.test.ts"`
Expected: FAIL — cannot resolve `./icons`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/(app)/icons.tsx
/**
 * The shell's icons, as data.
 *
 * Every one is a single path on a 0 0 16 16 viewBox at 1.4 stroke-width,
 * taken verbatim from the design prototype's ICONS map. No icon library and
 * no assets: nineteen strings weigh less than a dependency, and `currentColor`
 * means the active-nav colour change costs nothing.
 *
 * `perf` and `attendance` have no screens yet -- they arrive with
 * Rendimiento and Asistencia in sub-project 4. They live here now because the
 * map is one object, and splitting it across two passes would be worse than
 * carrying two unused strings.
 */
export const ICON_PATHS = {
  day: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M8 4.6V8l2.4 1.7",
  plan: "M2.5 2.5h11v11h-11zM2.5 6.2h11M6.2 6.2v7.3M9.9 6.2v7.3",
  calendar: "M2.5 3.6h11v10h-11zM2.5 6.6h11M5.4 1.9v2.4M10.6 1.9v2.4",
  meetings:
    "M5.8 7.2a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2M1.9 13.4c0-2.3 1.7-3.9 3.9-3.9s3.9 1.6 3.9 3.9M11 4.3a2 2 0 0 1 0 3.8M12.1 13.4c0-1.8-.6-3-1.6-3.7",
  p1n: "M8 2.3 14.4 13.4H1.6zM8 6.4v3.2M8 11.3h.01",
  messages: "M2.2 3.2h11.6v8.2H8l-3.4 2.6v-2.6H2.2z",
  team: "M4 6.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8M12 6.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8M1.6 13.4c0-1.8 1.1-3 2.4-3s2.4 1.2 2.4 3M9.6 13.4c0-1.8 1.1-3 2.4-3s2.4 1.2 2.4 3",
  triage: "M2.4 9.4h3l1 2h3.2l1-2h3M2.4 9.4 4.2 3h7.6l1.8 6.4v4H2.4z",
  catalogue: "M2.5 4h11M2.5 8h11M2.5 12h7",
  perf: "M2.5 13.4h11M4.6 11V6.8M8 11V3.4M11.4 11V8.6",
  attendance: "M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6M5.2 8.2l2 2 3.6-4.2",
  requests: "M2 4.4h12v7.8H2zM2 4.4l6 4.4 6-4.4",
  people: "M8 7.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8M2.9 13.7c0-2.6 2.3-4.4 5.1-4.4s5.1 1.8 5.1 4.4",
  sources: "M3 13.5V3.4h6.4v10.1M9.4 6.6H13v6.9M5 6h2.4M5 9h2.4M11 9h1",
  candidates: "M2.6 3h10.8L9.4 8.1v5.4l-2.8-1.5V8.1z",
  me: "M2 3.4h12v9.2H2zM5.6 8.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M3.4 11.4c0-1.2 1-1.9 2.2-1.9s2.2.7 2.2 1.9M9.9 6.7h2.4M9.9 9.2h2.4",
  mobile: "M5 1.8h6v12.4H5zM7 12.6h2",
  search: "M7.3 12.6a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6M14 14l-2.9-2.9",
  bell: "M8 1.9a3.9 3.9 0 0 0-3.9 3.9c0 4.1-1.4 5.2-1.4 5.2h10.6s-1.4-1.1-1.4-5.2A3.9 3.9 0 0 0 8 1.9M9.4 13.4a1.6 1.6 0 0 1-2.8 0",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * `currentColor` and no explicit size: the icon inherits both from whatever
 * is drawing it, so the same node works in a nav link, a button and a table
 * cell without a variant for each.
 */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/(app)/icons.test.ts"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/icons.tsx" "src/app/(app)/icons.test.ts"
git commit -m "feat: the shell's icons, as data

Nineteen single-path glyphs on a 16x16 grid, lifted from the design
prototype. currentColor rather than a fill, so the active-nav colour
change costs nothing and one node works everywhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Type tokens, radii, and the primitives

CSS only — there is nothing to unit-test, so this task is verified by a build and by eye. It lands early because tasks 8–12 all consume it.

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: the `@theme` block's existing `--color-*` tokens.
- Produces: CSS classes `.rail`, `.pill`, `.chip`, `.track`, `.track-fill`, `.stopwatch`, `.kpi-value`, `.popover`, `.table-erp`; type tokens `--text-nano|mini|label|meta|cell|card|kpi|stopwatch`; radius tokens `--radius-nav`, `--radius-pop`.

- [ ] **Step 1: Add the missing type-scale steps**

In the `@theme` block, immediately after the existing `--text-title` line, add:

```css
  /*
   * The half-steps the redesign asks for. The scale was six values; the
   * design lands on thirteen. They go here rather than as arbitrary values
   * at the call sites so the scale stays enumerable -- the next sub-project
   * needs somewhere to put a number, and "whatever the design said" is not
   * somewhere.
   */
  --text-nano: 0.625rem; /* 10px — pills, nav group headings */
  --text-mini: 0.65625rem; /* 10.5px — badges, timestamps */
  --text-label: 0.71875rem; /* 11.5px — role lines, notes */
  --text-meta: 0.78125rem; /* 12.5px — secondary values */
  --text-cell: 0.84375rem; /* 13.5px — nav links, table cells */
  --text-card: 1.3125rem; /* 21px — running-task name */
  --text-kpi: 1.5625rem; /* 25px — KPI numbers */
  --text-stopwatch: 2.875rem; /* 46px — the stopwatch, and only that */
```

- [ ] **Step 2: Correct the radii**

The design specifies 10px cards and 8px buttons/inputs; the repo has 8px and 6px. Replace the two existing radius lines in `@theme` with:

```css
  /* The design's radii, which are a step softer than what was here: cards
     were 8 and controls 6. Changing the tokens rather than the call sites
     means every card and button in the app moves together. */
  --radius-card: 10px;
  --radius-control: 8px;
  --radius-nav: 7px;
  --radius-pop: 12px;
```

- [ ] **Step 3: Add the primitives**

Append inside the existing `@layer components { … }` block, after the `.notice-*` rules:

```css
  /* ---------------------------------------------------------------- tone */

  /*
   * One custom property instead of a variant per colour.
   *
   * Everything below reads --tone, and a wash-filled thing also reads
   * --tone-wash. A caller sets them to a semantic pair:
   *
   *   <span className="pill" style={{ "--tone": "var(--color-run)" }} />
   *
   * so run / pause / stall / accent / done cost nothing per class, and a
   * sixth tone later costs nothing at all.
   */

  /* The 3px spine down the left of a card that says which state it is in. */
  .rail { border-left: 3px solid var(--tone, var(--color-line)); }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.0625rem 0.5rem;
    border: 1px solid var(--tone, var(--color-line));
    border-radius: 999px;
    color: var(--tone, var(--color-faint));
    font-size: var(--text-mini);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  /* The square in a plan or calendar cell. Sized by its caller, since the
     matrix and the calendar want different shapes. */
  .chip {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--tone, var(--color-line));
    border-radius: 4px;
    background: var(--tone-wash, transparent);
    font-size: var(--text-mini);
    font-weight: 600;
    color: var(--tone, var(--color-faint));
  }

  .track {
    overflow: hidden;
    height: 6px;
    border-radius: 999px;
    background: var(--color-line);
  }
  .track-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--tone, var(--color-accent));
    /* Long enough to read as movement rather than a jump; the suppression
       rule at the top of this file overrides it under reduced motion. */
    transition: width 500ms ease;
  }

  .stopwatch {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
    font-size: var(--text-stopwatch);
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1;
  }

  .kpi-value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
    font-size: var(--text-kpi);
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--tone, var(--color-ink));
  }

  .popover {
    background: var(--color-surface);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-pop);
    box-shadow: var(--shadow-raised);
  }

  /* ------------------------------------------------------------- tables */

  .table-erp { width: 100%; border-collapse: collapse; }

  .table-erp thead th {
    padding: 0.5rem 0.875rem;
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-line);
    font-size: var(--text-micro);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-faint);
    text-align: left;
  }

  .table-erp tbody td {
    padding: 0.625rem 0.875rem;
    border-bottom: 1px solid var(--color-line);
    font-size: var(--text-cell);
  }

  /* The card already draws the closing edge. */
  .table-erp tbody tr:last-child td { border-bottom: 0; }
  .table-erp tbody tr:hover td { background: var(--color-surface-2); }
```

- [ ] **Step 4: Verify the build compiles the new tokens**

Run: `npm run build`
Expected: build succeeds. Tailwind v4 resolves `@theme` tokens at build time, so a malformed custom property fails here rather than silently at runtime.

- [ ] **Step 5: Verify by eye in both themes**

Run: `npm run dev`, open `/my-day`, and toggle the theme from the sidebar.
Expected: cards are visibly rounder (10px), buttons and inputs rounder (8px). Nothing else has moved yet.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: the vocabulary the redesigned screens will speak

Eight type steps the design lands on that the six-value scale had no
room for, the design's softer radii as tokens so every card moves
together, and nine component classes.

All of them take colour from one --tone property rather than a variant
per semantic, so run/pause/stall/accent cost nothing each and a sixth
tone later costs nothing at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The new interface strings

All new copy in one place, in both languages, before anything renders it. `dictionary.test.ts` already asserts `en` and `es` have identical key sets.

**Files:**
- Modify: `src/lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: dictionary keys `nav.brandSub`, `nav.attendance`, `nav.performance`, `search.*`, `notifications.*`, `common.notifications`.

- [ ] **Step 1: Add the keys to `en`**

In the `en` object, add `brandSub`, `attendance` and `performance` to the existing `nav` block (after `p1n`):

```ts
    /* Under the wordmark in the sidebar's brand lockup. */
    brandSub: "Operations",
    /* No screens yet -- sub-project 4 builds them. The keys exist now so
       the nav and the breadcrumb map are written once. */
    performance: "Performance",
    attendance: "Attendance",
```

Then, as new top-level blocks alongside `nav`:

```ts
  search: {
    placeholder: "Search task, person, P1N…",
    /* Shown in the outlined chip inside the field. Not translated -- the
       key exists so the chip is not a magic string in the markup. */
    hint: "⌘K",
    open: "Search",
    close: "Close search",
    empty: "Nothing matches “{0}”",
    /* Before anything is typed. */
    prompt: "Type to search tasks, people and P1N",
    tasks: "Tasks",
    people: "People",
    p1ns: "P1N",
  },
  notifications: {
    /* The popover's eyebrow. */
    title: "Alerts",
    open: "Alerts",
    markRead: "Mark read",
    empty: "Nothing waiting",
    /* {0} is the sender's name, which is their own and untranslated. */
    newMessage: "{0} wrote to you",
    absencePending: "{0} is waiting on a decision",
    orphaned: "Without an owner",
    blocked: "Stopped",
  },
```

Add to the existing `common` block:

```ts
    notifications: "Alerts",
```

- [ ] **Step 2: Add the same keys to `es`**

In the `es` object's `nav` block:

```ts
    brandSub: "Operaciones",
    performance: "Rendimiento",
    attendance: "Asistencia",
```

New top-level blocks:

```ts
  search: {
    placeholder: "Buscar tarea, persona, P1N…",
    hint: "⌘K",
    open: "Buscar",
    close: "Cerrar la búsqueda",
    empty: "Nada coincide con «{0}»",
    prompt: "Escribe para buscar tareas, personas y P1N",
    tasks: "Tareas",
    people: "Personas",
    p1ns: "P1N",
  },
  notifications: {
    title: "Avisos",
    open: "Avisos",
    markRead: "Marcar leídos",
    empty: "Nada pendiente",
    newMessage: "{0} te ha escrito",
    absencePending: "{0} espera una decisión",
    orphaned: "Sin dueño",
    blocked: "Parada",
  },
```

And in `es`'s `common` block:

```ts
    notifications: "Avisos",
```

- [ ] **Step 3: Run the dictionary test**

Run: `npx vitest run src/lib/i18n/dictionary.test.ts`
Expected: PASS. If it fails with a key-set mismatch, a key was added to one language and not the other — that is exactly what the test is for.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `Dictionary` is `typeof en`, so `es` is structurally checked against it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/dictionary.ts
git commit -m "feat: copy for the search field and the alerts inbox

Both languages together, ahead of the components that render them, so
the key-set test is the thing that catches a missed translation rather
than a Spanish string appearing in an English session.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Breadcrumb resolution

The top bar's left side. A pure map from pathname to two dictionary keys, reusing the `nav.*` keys the sidebar already uses so a route is never named twice.

**Files:**
- Create: `src/app/(app)/breadcrumb.ts`
- Test: `src/app/(app)/breadcrumb.test.ts`

**Interfaces:**
- Consumes: the `nav.*` and `common.*` keys from Task 3.
- Produces: `type Crumb = { titleKey: string; trailKey: string | null }` and `crumbFor(pathname: string): Crumb | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/(app)/breadcrumb.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(app)/breadcrumb.test.ts"`
Expected: FAIL — cannot resolve `./breadcrumb`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/(app)/breadcrumb.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/(app)/breadcrumb.test.ts"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/breadcrumb.ts" "src/app/(app)/breadcrumb.test.ts"
git commit -m "feat: what the top bar calls the page you are on

Keys rather than strings, and the same keys the sidebar uses -- a route
named in two places is a route that ends up with two names. Longest
prefix wins on a segment boundary, so a source's own page inherits the
list's title and /team never claims /teamwork.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The notifications feed

The pure half: fold four kinds of pending thing into one ordered list and count what is unread. No database, no React.

**Files:**
- Create: `src/lib/notifications/feed.ts`
- Test: `src/lib/notifications/feed.test.ts`

**Interfaces:**
- Consumes: the `notifications.*` keys from Task 3.
- Produces: `type NotificationTone`, `type NotificationRow`, `type FeedInput`, `type Feed`, `buildFeed(input: FeedInput, seenAt: string | null): Feed`, and `MAX_ROWS`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/notifications/feed.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/notifications/feed.test.ts`
Expected: FAIL — cannot resolve `./feed`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/notifications/feed.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/notifications/feed.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/feed.ts src/lib/notifications/feed.test.ts
git commit -m "feat: fold what is waiting into one ordered list

Pure, so the ordering and the unread boundary are testable without a
database. Interface copy stays a dictionary key and the company's own
words stay data -- a task title is never something we translate.

Unread is counted before the list is capped, so the badge stays honest
when there is more waiting than the popover can show.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Reading the feed, and marking it seen

The database half. One migration for the read timestamp, one reader that reuses the existing queries, one action.

**Files:**
- Modify: `prisma/schema.prisma:58-104` (the `User` model)
- Create: `src/lib/notifications/read.ts`
- Create: `src/lib/notifications/actions.ts`

**Interfaces:**
- Consumes: `buildFeed`, `FeedInput`, `Feed` from Task 5. `unreadFor(userId)` from `@/lib/messages/db`. `getTriageQueue(departmentId): Promise<OrphanedTask[]>` and `getStuckQueue(departmentId): Promise<StuckTask[]>` from `@/lib/triage/queue`. `hasRole`, `canDecideAbsences`, `requireUser` from `@/lib/auth/guards`.
- Produces: `getNotifications(user: SessionUser): Promise<Feed>` and the server action `markSeen(): Promise<void>`.

- [ ] **Step 1: Add the column to the schema**

In `prisma/schema.prisma`, inside `model User`, after the `locale` line:

```prisma
  /// When they last opened the alerts popover. Everything newer is unread.
  /// One nullable column instead of a Notification table with per-row read
  /// state -- the rows are derived, so there is nothing to mark but the look.
  notificationsSeenAt DateTime?
```

- [ ] **Step 2: Create and apply the migration**

Run: `npm run db:start` (if the database is not already up), then:
`npx prisma migrate dev --name notifications_seen_at`
Expected: a new folder under `prisma/migrations/`, and `ALTER TABLE "User" ADD COLUMN "notificationsSeenAt" TIMESTAMP(3);` applied. Nullable, so no backfill and no default.

- [ ] **Step 3: Write the reader**

```ts
// src/lib/notifications/read.ts
import "server-only";
import { prisma } from "@/lib/db";
import { hasRole, canDecideAbsences } from "@/lib/auth/guards";
import type { SessionUser } from "@/lib/auth/session";
import { getTriageQueue, getStuckQueue } from "@/lib/triage/queue";
import { buildFeed, type Feed, type FeedInput } from "./feed";

/** Enough of a message to recognise it; the thread has the rest. */
const PREVIEW = 90;

/**
 * Everything waiting for one person, gathered from where it already lives.
 *
 * The two task sources are the very queries /triage renders, which is the
 * point: the bell and the Pendientes page read the same rows, so they cannot
 * come to different conclusions about what is outstanding.
 *
 * Role gating happens here rather than at the render site. A WORKER simply
 * has three empty arrays, so nothing downstream needs to know about roles.
 */
export async function getNotifications(user: SessionUser): Promise<Feed> {
  const isManager = hasRole(user, "MANAGER");
  const isHr = canDecideAbsences(user);

  const [messages, absences, orphans, blocks, row] = await Promise.all([
    prisma.message.findMany({
      where: { recipientId: user.id, readAt: null },
      select: {
        id: true,
        body: true,
        createdAt: true,
        sender: { select: { displayName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    isHr
      ? prisma.absence.findMany({
          where: { status: "PENDING" },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            createdAt: true,
            // The relation is *named* AbsenceSubject; the field is `user`.
            user: { select: { displayName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [],
    isManager ? getTriageQueue(user.departmentId) : [],
    isManager ? getStuckQueue(user.departmentId) : [],
    prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationsSeenAt: true },
    }),
  ]);

  const input: FeedInput = {
    messages: messages.map((m) => ({
      id: m.id,
      from: m.sender.displayName,
      preview: m.body.slice(0, PREVIEW),
      at: m.createdAt.toISOString(),
    })),
    absences: absences.map((a) => ({
      id: a.id,
      person: a.user.displayName,
      dates: `${short(a.startDate)} – ${short(a.endDate)}`,
      at: a.createdAt.toISOString(),
    })),
    /*
     * Orphans and blocks carry no timestamp of their own in these types --
     * getTriageQueue orders by the date the work was scheduled for, and
     * getStuckQueue by when it stopped.
     *
     * StuckTask.when is already `createdAt.toISOString()`, so it passes
     * straight through. An orphan carries only a "YYYY-MM-DD" day key, and
     * the day the work was due is the honest instant to sort it by -- that
     * is the day the decision is needed by. An orphan with no scheduled date
     * has no position on the list and is dropped rather than dated to now.
     */
    orphans: orphans
      .filter((o) => o.scheduledDate !== null)
      .map((o) => ({
        id: o.id,
        title: o.title,
        at: `${o.scheduledDate}T00:00:00.000Z`,
      })),
    blocks: blocks.map((b) => ({
      id: b.blockId,
      title: b.title,
      at: b.when,
    })),
  };

  return buildFeed(input, row?.notificationsSeenAt?.toISOString() ?? null);
}

/** dd/mm, which is all a date range needs at 12px. */
function short(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}`;
}
```

- [ ] **Step 4: Write the action**

```ts
// src/lib/notifications/actions.ts
"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";

/**
 * "Marcar leídos".
 *
 * There is nothing per-row to mark, so this is one timestamp: everything
 * older than the moment you looked is read, and anything landing afterwards
 * is not. Revalidating the layout is what clears the badge, since that is
 * where the count is rendered.
 */
export async function markSeen(): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { notificationsSeenAt: new Date() },
  });
  revalidatePath("/", "layout");
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If Prisma complains that `notificationsSeenAt` does not exist, the client was not regenerated — run `npx prisma generate`.

- [ ] **Step 6: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS, including the pre-existing suites.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/notifications/read.ts src/lib/notifications/actions.ts
git commit -m "feat: read the alerts feed from what triage already knows

The two task sources are the same queries /triage renders, so the bell
and the Pendientes page cannot disagree about what is outstanding.
Role gating happens in the reader, so a WORKER gets three empty arrays
and nothing downstream has to know about roles.

Read state is one nullable column. There are no rows to mark, only the
look, so a timestamp is the whole of it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Search

Ranking as a pure function, then the server action that feeds it.

**Files:**
- Create: `src/lib/search/rank.ts`
- Test: `src/lib/search/rank.test.ts`
- Create: `src/lib/search/actions.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth/guards`; `prisma` from `@/lib/db`.
- Produces: `type SearchKind = "task" | "person" | "p1n"`, `type SearchHit`, `rankHits(hits: SearchHit[], query: string): SearchHit[]`, `MAX_HITS`, and the server action `search(query: string): Promise<SearchHit[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/search/rank.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/search/rank.test.ts`
Expected: FAIL — cannot resolve `./rank`.

- [ ] **Step 3: Write the ranker**

```ts
// src/lib/search/rank.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/search/rank.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the server action**

```ts
// src/lib/search/actions.ts
"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { rankHits, MAX_HITS, type SearchHit } from "./rank";

/**
 * ⌘K, over the three things worth jumping to.
 *
 * Three `contains` queries and no index. This is one company's operations,
 * not a corpus -- a search index would be machinery for a problem that does
 * not exist, and the cap means the query never returns more than eighteen
 * rows however common the word.
 *
 * Scoped to the caller's department, matching every other read in the app.
 */
export async function search(query: string): Promise<SearchHit[]> {
  const user = await requireUser();
  const q = query.trim();
  if (q === "") return [];

  const where = { contains: q, mode: "insensitive" as const };

  const [tasks, people, p1ns] = await Promise.all([
    prisma.task.findMany({
      where: { departmentId: user.departmentId, title: where },
      select: { id: true, title: true, scheduledDate: true },
      take: MAX_HITS,
      orderBy: { scheduledDate: "desc" },
    }),
    prisma.user.findMany({
      where: { departmentId: user.departmentId, active: true, displayName: where },
      select: { id: true, displayName: true, username: true },
      take: MAX_HITS,
      orderBy: { displayName: "asc" },
    }),
    prisma.p1n.findMany({
      where: { departmentId: user.departmentId, mistake: where },
      select: { id: true, mistake: true, createdAt: true },
      take: MAX_HITS,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const hits: SearchHit[] = [
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      sub: t.scheduledDate ? t.scheduledDate.toISOString().slice(0, 10) : "",
      href: "/my-day",
    })),
    ...people.map((p) => ({
      kind: "person" as const,
      id: p.id,
      title: p.displayName,
      sub: p.username,
      href: "/hr/people",
    })),
    ...p1ns.map((p) => ({
      kind: "p1n" as const,
      id: p.id,
      title: p.mistake,
      sub: p.createdAt.toISOString().slice(0, 10),
      href: "/p1n",
    })),
  ];

  return rankHits(hits, q);
}
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/search/
git commit -m "feat: jump to a task, a person or a P1N

Ranking is a pure function so "does a prefix beat a substring" is a test
rather than an argument, and normalising away accents means somebody
hunting for Revision in a hurry still finds Revisión.

Three contains queries and no index: this is one company's operations,
not a corpus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The sidebar

238px, brand lockup, icons on every link, the inset active rail, and badges that agree with each other.

**Files:**
- Modify: `src/app/(app)/nav-link.tsx`
- Modify: `src/app/(app)/message-badge.tsx:56-58`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `Icon`, `IconName` from Task 1; `nav.brandSub` from Task 3; `--radius-nav` from Task 2.
- Produces: `NavLink` gains a required `icon: IconName` prop. Every existing call site must pass one.

- [ ] **Step 1: Give NavLink an icon and the inset rail**

Replace the body of `src/app/(app)/nav-link.tsx` from the `export function NavLink` line onward:

```tsx
export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2 rounded-[var(--radius-nav)] px-3 py-1.5 text-[13px] transition-colors lg:px-2 lg:text-cell ${
        active
          ? "font-semibold text-ink lg:bg-accent-wash lg:text-accent"
          : "text-muted hover:bg-surface-2 hover:text-ink lg:text-ink/80"
      }`}
    >
      {/* Slightly held back, so a row of nineteen glyphs reads as texture
          under the labels rather than competing with them. */}
      <Icon name={icon} className="shrink-0 opacity-85" />
      {children}
      {active && (
        /* Inset from the item's own top and bottom rather than run edge to
           edge: a rail the full height of the row reads as a border on the
           column, not a mark on the item. */
        <span
          className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-accent
                     lg:inset-x-auto lg:top-1.5 lg:bottom-1.5 lg:left-0 lg:h-auto lg:w-0.5"
        />
      )}
    </Link>
  );
}
```

Add to the imports at the top of the file:

```tsx
import { Icon, type IconName } from "./icons";
```

- [ ] **Step 2: Make the two badges agree**

In `src/app/(app)/message-badge.tsx`, the returned `<span>` currently uses `bg-accent text-accent-ink`. Replace that className with:

```tsx
    <span className="num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pause px-1 text-[10px] font-semibold text-white">
```

Add above the `return`:

```tsx
  /* Pause, not accent, and the same as the requests badge in the layout:
     both mean "n things are waiting for you", and two colours for one
     meaning reads as two different kinds of thing. */
```

- [ ] **Step 3: Widen the column and add the brand lockup**

In `src/app/(app)/layout.tsx`, in the `<aside>` className, change `lg:w-[208px]` to `lg:w-[238px]`.

Replace the brand `<span>` block (the one containing "MBE" and "ERP", and the comment above it) with:

```tsx
            {/*
              The stamp lockup from the brand book: a mark, the name, and a
              tracked descriptor under it. The square *is* the mark -- an
              approximation of the shield and owl would be a worse
              counterfeit than a wordmark.
            */}
            <a
              href="/my-day"
              className="flex shrink-0 items-center gap-2.5 py-3.5 lg:px-1.5 lg:pt-0 lg:pb-5"
            >
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent text-[12.5px] font-bold text-accent-ink">
                MB
              </span>
              <span className="leading-tight">
                <span className="block text-body font-semibold tracking-[-0.01em]">
                  MBE ERP
                </span>
                <span className="nav-group block">{t("nav.brandSub")}</span>
              </span>
            </a>
```

- [ ] **Step 4: Pass an icon to every nav link**

In the same file, in the `groups` array, add the `icon` prop to all fourteen `NavLink` calls:

```tsx
<NavLink key="my-day" href="/my-day" icon="day">{t("nav.myDay")}</NavLink>,
<NavLink key="plan" href="/plan" icon="plan">{t("nav.planWeek")}</NavLink>,
<NavLink key="cal" href="/my-calendar" icon="calendar">{t("nav.myCalendar")}</NavLink>,
<NavLink key="meet" href="/meetings" icon="meetings">{t("nav.meetings")}</NavLink>,
<NavLink key="msg" href="/messages" icon="messages">
  {t("nav.messages")}
  <MessageBadge initial={unread} />
</NavLink>,
<NavLink key="p1n" href="/p1n" icon="p1n">{t("nav.p1n")}</NavLink>,
```

```tsx
<NavLink key="team" href="/team" icon="team">{t("nav.team")}</NavLink>,
<NavLink key="triage" href="/triage" icon="triage">{t("nav.triage")}</NavLink>,
<NavLink key="cat" href="/catalogue" icon="catalogue">{t("nav.catalogue")}</NavLink>,
```

```tsx
<NavLink key="req" href="/hr/absences" icon="requests">
  {t("nav.requests")}
  {waiting > 0 && (
    <span className="num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pause px-1 text-[10px] font-semibold text-white">
      {waiting}
    </span>
  )}
</NavLink>,
```

```tsx
<NavLink key="people" href="/hr/people" icon="people">{t("nav.people")}</NavLink>,
<NavLink key="crm" href="/crm/sources" icon="sources">{t("nav.crm")}</NavLink>,
```

- [ ] **Step 5: Size the account footer to the design**

In the footer block, change the avatar `<span>` from `h-8 w-8` to `h-[30px] w-[30px]`, and the name `<span>` from `text-[13px] font-medium` to `text-[13px] font-[550]`. Change the role line from `text-[11px] text-faint` to `text-micro text-faint`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. A missing `icon` prop on any `NavLink` fails here — that is the point of making it required.

- [ ] **Step 7: Verify by eye in both themes**

Run: `npm run dev`, open `/my-day`.
Expected: 238px column; the accent square with "MB" beside "MBE ERP" over "OPERACIONES"; an icon on every link; the active link in accent-wash with a short rail inset from its top and bottom; the Mensajes and Solicitudes badges the same colour. Toggle the theme and check all of it again.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/nav-link.tsx" "src/app/(app)/message-badge.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat: the sidebar the design draws

Thirty pixels wider to make room for an icon on every link, the stamp
lockup from the brand book in place of the wordmark, and an active rail
inset from the item's own edges -- run full height it reads as a border
on the column rather than a mark on the item.

The messages and requests badges become one colour. Both mean "n things
are waiting for you", and two colours for one meaning read as two
different kinds of thing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The top bar and the content column

A bar that has never existed, and the 1180px column with its documented escape hatch.

**Files:**
- Create: `src/app/(app)/top-bar.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `crumbFor` from Task 4; `Icon` from Task 1; `search.*` from Task 3.
- Produces: `TopBar({ children }: { children?: React.ReactNode })` — a client component that resolves its own title from the pathname and renders `children` (the bell and the palette trigger) on its right.

- [ ] **Step 1: Write the bar**

```tsx
// src/app/(app)/top-bar.tsx
"use client";

import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { crumbFor } from "./breadcrumb";
import { Icon } from "./icons";

/**
 * The strip above every page.
 *
 * A client component because it names the page from the pathname, which is
 * the one thing the server layout cannot know -- the layout does not
 * re-render between navigations, so a server-resolved title would freeze on
 * whatever page you first landed on.
 *
 * The right-hand slot is a prop rather than a hard-coded pair: the bell needs
 * server-fetched counts and the palette needs a server action, and neither
 * belongs inside a component whose job is the title.
 */
export function TopBar({
  onOpenSearch,
  children,
}: {
  onOpenSearch: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useT();
  const crumb = crumbFor(usePathname());

  return (
    <header
      className="sticky top-0 z-30 flex h-[57px] items-center gap-4 border-b border-line
                 bg-surface/92 px-6 backdrop-blur-[8px] lg:px-8"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        {/* An unknown route gets no title rather than a confident wrong one. */}
        {crumb && (
          <>
            <h2 className="truncate text-body font-semibold">
              {t(crumb.titleKey)}
            </h2>
            {crumb.trailKey && (
              <span className="truncate text-tiny text-faint">
                {t(crumb.trailKey)}
              </span>
            )}
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/*
          A button that looks like a field. It opens the palette rather than
          accepting text, so making it an <input> would promise typing that
          goes nowhere.
        */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={t("search.open")}
          className="hidden h-[31px] w-[224px] items-center gap-2 rounded-[var(--radius-control)]
                     border border-line-strong px-2.5 text-left text-small text-faint
                     transition-colors hover:border-faint sm:flex"
        >
          <Icon name="search" className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t("search.placeholder")}</span>
          <kbd className="num shrink-0 rounded border border-line px-1 text-mini text-faint">
            {t("search.hint")}
          </kbd>
        </button>
        {children}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Mount it, and set the content column**

In `src/app/(app)/layout.tsx`, replace the `<main>` element and its preceding comment with:

```tsx
        {/*
          The bar and the column it caps.

          1180px is what the design draws every screen at, and it is right for
          all of them except the two matrix screens -- /plan and /team put five
          day-columns side by side and were widened on purpose after they came
          out cramped. So the cap is the design's, and those two opt out by
          marking their own root `data-wide`.

          Done with :has() rather than a prop so no server component has to
          thread a width down to a layout that has no business knowing routes.
        */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="w-full px-6 py-[22px] pb-[92px] lg:px-8">
            <div className="mx-auto w-full max-w-[1180px] [&:has([data-wide])]:max-w-[1600px]">
              {children}
            </div>
          </main>
        </div>
```

Note the `pb-[92px]`: the now bar is fixed, and this is what stops it covering the last row of any page.

Add the import:

```tsx
import { TopBar } from "./top-bar";
```

- [ ] **Step 3: Give the two matrix screens their opt-out**

In `src/app/(app)/plan/page.tsx` and `src/app/(app)/team/page.tsx`, add `data-wide` to the outermost element each returns, with a comment at each site:

```tsx
    {/* Five day-columns need more than the 1180px the other screens use;
        see the cap in (app)/layout.tsx. */}
    <div data-wide>
```

If either page returns a fragment, wrap it in a `<div data-wide>`.

- [ ] **Step 4: Wire the search button to nothing yet**

`TopBar` requires `onOpenSearch`, but the palette arrives in Task 12 and `layout.tsx` is a server component that cannot pass a function. For now, make the prop optional and default the button to disabled:

Change the signature to `onOpenSearch?: () => void`, and add `disabled={!onOpenSearch}` to the button. Task 12 replaces this with the real trigger.

- [ ] **Step 5: Typecheck and verify by eye**

Run: `npx tsc --noEmit`, then `npm run dev`.
Expected: a 57px bar on every page showing e.g. "Mi día · Trabajo"; content capped at 1180px on `/my-day` and running wider on `/plan` and `/team`; the bar's background blurs content scrolling under it. Check both themes.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/top-bar.tsx" "src/app/(app)/layout.tsx" "src/app/(app)/plan/page.tsx" "src/app/(app)/team/page.tsx"
git commit -m "feat: a bar that says which page you are on

Client-side because the layout does not re-render between navigations,
so a server-resolved title would freeze on whichever page you landed on
first.

The column takes the design's 1180px, and the two matrix screens opt
out by marking themselves data-wide -- they were widened on purpose
after five day-columns came out cramped, and that fix stands. Done with
:has() so no server component threads a width down to a layout with no
business knowing routes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The now bar, restyled

Layout only. Its behaviour — the local tick, pace, gap detection, pause/complete/close-day — is correct and is not touched.

**Files:**
- Modify: `src/app/(app)/now-bar.tsx:67-71`

**Interfaces:**
- Consumes: `.rail`, `--tone` from Task 2. Nothing new.
- Produces: nothing new.

- [ ] **Step 1: Move it clear of the wider sidebar and cap it to the column**

In the outer `<div>` at line 67, change `lg:left-[208px]` to `lg:left-[238px]`.

On the inner `<div>` at line 71, change `max-w-[1600px]` to `max-w-[1180px]` so it lines up with the content above it.

- [ ] **Step 2: Give the status a rail and an eyebrow**

The bar's leading element should be a 3px × 28px rail tinted by the running state, with the status word above the task name. Replace the leading status block with:

```tsx
        {/* Rail, eyebrow and label all take the same tone, so pausing
            recolours the whole left end in one move rather than three. */}
        <div
          className="flex items-center gap-2.5"
          style={{
            "--tone": paused ? "var(--color-pause)" : "var(--color-run)",
          } as React.CSSProperties}
        >
          <span className="h-7 w-[3px] shrink-0 rounded-full bg-[var(--tone)]" />
          <span className="min-w-0 leading-tight">
            <span className="eyebrow block text-[var(--tone)]">
              {paused ? t("myDay.paused") : t("myDay.runningNow")}
            </span>
            <span className="block truncate text-small font-[550]">
              {active?.title}
            </span>
          </span>
        </div>
```

Use whichever local variable the file already has for the paused state and the active task — read the component before editing and reuse its existing names rather than introducing new ones.

- [ ] **Step 3: Set the stopwatch and pace to the design's sizes**

The bar's stopwatch is 15px mono/600 (not the 46px `.stopwatch` class, which belongs to the My día card in sub-project 2). Ensure it carries `num text-[15px] font-semibold`. The pace readout keeps its existing `BAND_STYLE` colour and gains the `eyebrow` label above it.

- [ ] **Step 4: Verify the timer still runs**

Run: `npm run dev`, start a task on `/my-day`, then navigate to `/team`.
Expected: the bar stays, the clock keeps ticking, Pausar recolours the rail, eyebrow and label from run to pause together, and Terminar still completes. Behaviour must be identical to before this task.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS. `pace.test.ts` and `elapsed.test.ts` cover the logic this task deliberately did not touch.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/now-bar.tsx"
git commit -m "style: the now bar, to the design

Rail, eyebrow and label read one --tone, so pausing recolours the left
end in one move instead of three. Offset and cap follow the sidebar and
the content column.

Layout only. The tick, the pace and the gap detection are untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The bell and its popover

**Files:**
- Create: `src/app/(app)/notifications/bell.tsx`
- Create: `src/app/(app)/notifications/popover.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getNotifications` (Task 6), `markSeen` (Task 6), `Feed`/`NotificationRow` (Task 5), `Icon` (Task 1), `.popover`/`.rail`/`--tone` (Task 2), `notifications.*` (Task 3).
- Produces: `Bell({ feed }: { feed: Feed })`, a client component.

- [ ] **Step 1: Write the popover**

```tsx
// src/app/(app)/notifications/popover.tsx
"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import type { NotificationRow } from "@/lib/notifications/feed";
import { markSeen } from "@/lib/notifications/actions";

const TONE: Record<NotificationRow["tone"], string> = {
  accent: "var(--color-accent)",
  pause: "var(--color-pause)",
  stall: "var(--color-stall)",
};

export function Popover({
  rows,
  onNavigate,
}: {
  rows: NotificationRow[];
  onNavigate: () => void;
}) {
  const { t } = useT();

  return (
    <div className="popover absolute right-0 top-[calc(100%+8px)] z-50 w-[348px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className="eyebrow">{t("notifications.title")}</span>
        <form action={markSeen}>
          <button
            type="submit"
            className="text-tiny font-medium text-accent hover:underline"
          >
            {t("notifications.markRead")}
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        /* One sentence, never an illustration. */
        <p className="px-3.5 py-6 text-center text-small text-muted">
          {t("notifications.empty")}
        </p>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-line last:border-b-0">
              <Link
                href={row.href}
                onClick={onNavigate}
                className="flex gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-surface-2"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TONE[row.tone] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small font-[550]">
                    {t(row.titleKey, ...row.titleArgs)}
                  </span>
                  {/* The company's own words, never translated. */}
                  <span className="block truncate text-tiny text-muted">
                    {row.body}
                  </span>
                </span>
                <span className="num shrink-0 text-mini text-faint">
                  {row.at.slice(11, 16)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the bell**

```tsx
// src/app/(app)/notifications/bell.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { Feed } from "@/lib/notifications/feed";
import { Icon } from "../icons";
import { Popover } from "./popover";

export function Bell({ feed }: { feed: Feed }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Navigating away closes it -- the popover is a signpost, not a window.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("common.notifications")}
        aria-expanded={open}
        className="relative flex h-[31px] w-[31px] items-center justify-center rounded-[var(--radius-control)]
                   border border-line-strong text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="bell" />
        {feed.unread > 0 && (
          /* Ringed in the surface colour so it reads as sitting on the bell
             rather than beside it. */
          <span
            className="num absolute -right-1.5 -top-1.5 flex h-[15px] min-w-[15px] items-center
                       justify-center rounded-full bg-stall px-1 text-[9.5px] font-bold text-white
                       ring-2 ring-surface"
          >
            {feed.unread}
          </span>
        )}
      </button>

      {open && <Popover rows={feed.rows} onNavigate={() => setOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Mount it**

In `src/app/(app)/layout.tsx`, fetch the feed alongside the other layout queries:

```tsx
  const feed = await getNotifications(user);
```

and pass the bell into the bar:

```tsx
          <TopBar>
            <Bell feed={feed} />
          </TopBar>
```

Add the imports:

```tsx
import { getNotifications } from "@/lib/notifications/read";
import { Bell } from "./notifications/bell";
```

- [ ] **Step 4: Typecheck and verify by eye**

Run: `npx tsc --noEmit`, then `npm run dev`.
Expected: a bell in the top bar; as an HR or admin account with a pending absence, a stall-coloured count on it; clicking opens a 348px popover with the eyebrow, "Marcar leídos", and rows whose dots match their kind. "Marcar leídos" clears the count. Escape, an outside click, and navigating all close it. Check both themes.

- [ ] **Step 5: Verify the role gate**

Sign in as a WORKER.
Expected: the popover shows unread messages only — no absences, no orphans, no blocks — with no error.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/notifications/" "src/app/(app)/layout.tsx"
git commit -m "feat: a bell for what is waiting

Rows link to the page that can act on them, dots carry the same
semantics as everywhere else, and the count is ringed in the surface
colour so it reads as sitting on the bell rather than beside it.

Marking read is one timestamp, so the button clears everything at once
-- which is what the design offers and all the derived rows can support.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The ⌘K palette

**Files:**
- Create: `src/app/(app)/command-palette.tsx`
- Modify: `src/app/(app)/top-bar.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `search` (Task 7), `SearchHit`/`SearchKind` (Task 7), `Icon` (Task 1), `.popover` (Task 2), `search.*` (Task 3).
- Produces: `CommandPalette({ children })` — a client component holding open/closed state and rendering `children` as a render-prop receiving `open()`.

- [ ] **Step 1: Write the palette**

```tsx
// src/app/(app)/command-palette.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { search } from "@/lib/search/actions";
import type { SearchHit, SearchKind } from "@/lib/search/rank";

const GROUP_KEY: Record<SearchKind, string> = {
  task: "search.tasks",
  person: "search.people",
  p1n: "search.p1ns",
};

/**
 * ⌘K.
 *
 * Holds the open state and hands an `open()` down to whatever should trigger
 * it, so the top bar's search button does not have to own a dialog and the
 * keyboard shortcut does not have to live in a component about titles.
 */
export function CommandPalette({
  children,
}: {
  children: (open: () => void) => React.ReactNode;
}) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /*
   * Debounced, because this fires a server action per keystroke otherwise.
   * 180ms is under the threshold where a list feels laggy and well over the
   * gap between two keys in a word.
   */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q === "") {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      startTransition(async () => setHits(await search(q)));
    }, 180);
    return () => clearTimeout(id);
  }, [query, open]);

  // A fresh box every time, rather than yesterday's search waiting in it.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      {children(() => setOpen(true))}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-6 pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("search.open")}
            className="popover w-full max-w-[520px] overflow-hidden"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="w-full border-b border-line bg-transparent px-4 py-3 text-body
                         text-ink outline-none placeholder:text-faint"
            />

            <div className="max-h-[380px] overflow-y-auto">
              {query.trim() === "" ? (
                <p className="px-4 py-6 text-center text-small text-muted">
                  {t("search.prompt")}
                </p>
              ) : hits.length === 0 && !pending ? (
                <p className="px-4 py-6 text-center text-small text-muted">
                  {t("search.empty", query.trim())}
                </p>
              ) : (
                <ul>
                  {hits.map((hit, i) => {
                    // The group heading appears once, above the first of its
                    // kind -- rankHits has already clustered them.
                    const first = i === 0 || hits[i - 1].kind !== hit.kind;
                    return (
                      <li key={`${hit.kind}:${hit.id}`}>
                        {first && (
                          <p className="eyebrow px-4 pt-3 pb-1">
                            {t(GROUP_KEY[hit.kind])}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => go(hit.href)}
                          className="flex w-full items-baseline gap-2 px-4 py-2 text-left
                                     transition-colors hover:bg-surface-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-small">
                            {hit.title}
                          </span>
                          {hit.sub && (
                            <span className="num shrink-0 text-mini text-faint">
                              {hit.sub}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Make the top bar's button required again**

In `src/app/(app)/top-bar.tsx`, change `onOpenSearch?: () => void` back to `onOpenSearch: () => void` and remove the `disabled={!onOpenSearch}` added in Task 9, Step 4.

- [ ] **Step 3: Wrap the bar**

`layout.tsx` is a server component and cannot pass a function, so the palette owns the state and the bar receives it through the render prop. Replace the `<TopBar>` usage with:

```tsx
          <CommandPalette>
            {(open) => (
              <TopBar onOpenSearch={open}>
                <Bell feed={feed} />
              </TopBar>
            )}
          </CommandPalette>
```

Add the import:

```tsx
import { CommandPalette } from "./command-palette";
```

- [ ] **Step 4: Typecheck and verify by eye**

Run: `npx tsc --noEmit`, then `npm run dev`.
Expected: ⌘K (and Ctrl+K) opens the dialog from any page; typing "rev" lists matching tasks under a "TAREAS" heading; picking one navigates and closes; Escape and a backdrop click close it; reopening shows an empty box. Check both themes.

- [ ] **Step 5: Run the whole suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; the production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/command-palette.tsx" "src/app/(app)/top-bar.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat: jump anywhere with cmd-K

The palette owns the open state and hands a trigger down, so the top bar
does not have to own a dialog and the shortcut does not have to live in
a component about titles -- which also gets around the layout being a
server component that cannot pass a callback.

Debounced at 180ms: under where a list starts feeling laggy, over the
gap between two keys in a word.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-08-03-shell-redesign-design.md`:

- Spec Part 1 (icons) → Task 1. Part 2 (sidebar) → Task 8. Part 3 (top bar) → Task 9. Part 4 (notifications) → Tasks 5, 6, 11. Part 5 (⌘K) → Tasks 7, 12. Part 6 (now bar) → Task 10. Part 7 (content column) → Task 9. Part 8 (primitives) → Task 2. i18n constraint → Task 3.
- The spec's four deliberate deviations are preserved: routes are unrenamed throughout; `theme-toggle.tsx` is not in any task's file list, so its three-way cycle survives untouched; the column opt-out is Task 9 Step 3; notifications stay derived.
- Two things the spec left implicit and this plan pins down: `getTriageQueue`'s `OrphanedTask` has no created-at, so Task 6 uses `scheduledDate` and drops orphans with none; and `TopBar`'s search prop is deliberately optional for one task only (9 → 12), which Task 12 Step 2 closes.

Field names verified against `prisma/schema.prisma` rather than assumed — two
errors found and corrected while reviewing:

- `Absence` has **no `subject` field**. The relation is *named* `AbsenceSubject`
  but the field is `user`. The first draft of Task 6 would have failed at
  runtime with an unknown-field error.
- `StuckTask.when` is already `createdAt.toISOString()`, so the draft's
  `new Date(b.when).toISOString()` was a round trip to the same string.

Confirmed as written: `Message.sender`/`recipientId`/`readAt`/`createdAt`;
`Task.scheduledDate` is `DateTime? @db.Date`, so the null guard in Task 7 is
required; `OrphanedTask.scheduledDate` is a `dateKey()` string, `"YYYY-MM-DD"`,
which is why Task 6 appends a time rather than calling `toISOString()`;
`SessionUser` carries `departmentId`; `P1n` has `mistake`, not `title`.
