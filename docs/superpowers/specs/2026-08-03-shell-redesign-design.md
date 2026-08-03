# Shell redesign: sidebar, top bar, now bar, and the primitives underneath

Date: 2026-08-03
Branch: `feature/erp-round-two`
Source: `design_handoff_mbe_erp` — `MBE ERP.dc.html` plus its README

This is **sub-project 1 of 5** in applying the full front-end redesign. It
delivers the shell — the part of the screen that is on every page — and the CSS
primitives the other four sub-projects consume. Nothing here changes what the
ERP *does*; two new controls (⌘K, notifications) are the only added behaviour,
and both read data that already exists.

---

## What the handoff actually asks for

The handoff describes 17 screens. Read against the repo, it is less new than it
reads:

- **The tokens are already in place.** Every value in the handoff's token table
  is already in `src/app/globals.css`, verbatim — colours, shadows, the
  `light-dark()` switch, Gantari. This is not a re-theming job. It is layout,
  shell structure, and component vocabulary.
- **Mensajes is not new.** The handoff lists it as a new screen; `/messages`
  has existed since round two. It needs restyling, not building.
- **Most "specified but not wired" items are wired.** Drag-to-reorder, "No
  puedo hacerla", triage assignment, close-day, and meeting finalisation all
  exist. The genuinely unbuilt items are the ⌘K palette and the notifications
  inbox — both in this sub-project — plus Rendimiento and Asistencia, which are
  sub-project 4 and are also the two items already on the repo's own *Still to
  build* list.

### The five sub-projects

| # | Sub-project | Contents |
| --- | --- | --- |
| **1** | **Shell + primitives** | **this document** |
| 2 | Core work screens | Mi día, Planificar semana, Equipo, Mensajes |
| 3 | Remaining screens | Pendientes, Catálogo, Solicitudes, Personal, CRM ×2, Reuniones, Mi calendario, P1N, Mi ficha |
| 4 | New screens | Rendimiento, Asistencia |
| 5 | Mobile | Drawer, touch targets, viewport meta |

1 comes first because 2–4 consume its primitives. 5 is independent.

### Routes are not renamed

The handoff names routes that do not match the repo — `/performance`,
`/attendance`, `/requests`, `/people`, `/calendar` against the repo's
`/hr/absences`, `/hr/people`, `/my-calendar`, `/crm/sources`,
`/crm/candidates`. **The repo's routes stand.** Renaming them would break
bookmarks and every internal link to buy nothing; only the visual design is
being adopted.

The design's copy is Spanish-only. The repo is bilingual — 2111 lines of
`src/lib/i18n/dictionary.ts`. **Every new string lands in the dictionary in
both languages.** No Spanish is hardcoded, including in the prototype's own
labels.

---

## Part 1 — The icon set

The nav has never had icons. The design puts a 16px stroke icon on every link,
and the prototype defines all of them inline in an `ICONS` map: 18 paths on a
`0 0 16 16` viewBox at 1.4 stroke-width, no icon library and no assets.

Those paths are lifted verbatim into `src/app/(app)/icons.tsx`, which exports
one component:

```tsx
export function Icon({ name, className }: { name: IconName; className?: string })
```

It renders a single `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>`
with one `<path d>`. `currentColor` is the point — the active-nav colour change
then costs nothing, and the same icon works in the sidebar, the top bar and a
button without variants.

Names: `day, plan, calendar, meetings, p1n, messages, team, triage, catalogue,
perf, attendance, requests, people, sources, candidates, me, mobile`, plus
`search` and `bell` for the top bar. `perf` and `attendance` are included now
even though their screens arrive in sub-project 4 — the map is one object and
splitting it across two passes would be worse than seventeen unused bytes.

Sun and moon stay where they are: `theme-toggle.tsx` already draws its own
three, including a half-filled disc for SYSTEM that has no equivalent in the
handoff. See *Deliberate deviations*.

## Part 2 — The sidebar

`layout.tsx` and `nav-link.tsx`.

**Width 208 → 238px.** The extra 30px is what the icons and the wider nav item
padding need.

**A brand lockup replaces the text mark.** A 30×30 accent square at 8px radius
carrying "MB" in 12.5px/700 accent-ink, beside "MBE ERP" at 14px/650 over
"OPERACIONES" at 10px/600/0.14em uppercase faint. This supersedes the current
stacked "MBE / ERP" and the comment above it inviting a real SVG — the square
*is* the mark now.

**Nav items** gain the icon (16px, 0.85 opacity), 6×8px padding and 7px radius.
Idle is transparent on `--color-ink`; hover is `--color-surface-2`; active is
`--color-accent-wash` + `--color-accent` + 600 weight **plus a 2px accent rail
inset 6px from the item's top and bottom on its left edge**. That inset rail
replaces the current full-height `inset-y-1` bar.

The group structure — Trabajo / Equipo / RRHH, each behind its role gate, each
with a top hairline and a 10px/600/0.14em label — is already correct and does
not change.

**Count badges unify on `--color-pause`.** Today `/messages` badges in accent
and `/hr/absences` in pause, which reads as two different kinds of thing when
both mean "n things are waiting for you". The design uses pause for both:
a 17px pill, white mono 10px/700. `MessageBadge` changes colour only — its
polling, visibility-gating and server action are untouched.

**The footer** becomes a 30px accent-wash avatar with initials beside the name
at 13px/550 over role at 11px faint, then "Salir" as a text button and the
theme toggle at 28px icon-only. Close to what is there; mostly sizing.

## Part 3 — The top bar

New: `src/app/(app)/top-bar.tsx`. There is no top bar today.

57px tall, sticky, `--color-surface` at 92% with `backdrop-filter: blur(8px)`,
bottom hairline.

**Left — title and breadcrumb.** New `src/app/(app)/breadcrumb.ts` maps a
pathname to `{ titleKey, trailKey }`, both dictionary keys, both reusing the
`nav.*` keys the sidebar already has so a route is never named twice. A route
absent from the map renders no title rather than a wrong one.

**Right — search and bell.** A 224px field, 31px tall, `--color-line-strong`
border at 8px radius, magnifier icon, and a ⌘K hint in a 4px-radius outlined
mono chip. Then a 31px bell with a 15px count badge ringed 2px in the surface
colour so it reads as sitting *on* the bell.

### Why both controls ship now

They were originally scheduled for sub-project 5. They are pulled forward so
the bar is never on screen with dead chrome, and so `layout.tsx` is opened once
rather than twice. Sub-project 5 shrinks to mobile alone.

## Part 4 — Notifications

The bell needs a source, and the repo has no `Notification` model.

**It derives from data that already exists rather than adding a table.**
`src/lib/notifications/feed.ts` maps four existing sources onto rows:

| Source | Existing reader | Row | Dot |
| --- | --- | --- | --- |
| unread `Message` | `unreadFor()` | sender + preview | accent |
| `Absence` where `status = PENDING` | the layout's own count | person + kind | pause |
| orphaned `Task` | `getTriageQueue(departmentId)` | task + former owner | stall |
| open `TaskBlock` | `getStuckQueue(departmentId)` | task + reason | stall |

**No new queries.** All four sources already have readers — the two task
sources are exactly what `/triage` renders, and reusing `lib/triage/queue.ts`
means the bell and the Pendientes page can never disagree about what is
waiting.

The last three are role-gated at query time by the same guards the nav uses —
`canDecideAbsences` for absences, `hasRole(user, "MANAGER")` for the two task
sources, which are scoped to the manager's own department by the `departmentId`
those functions already take. A WORKER's bell therefore shows messages only,
with no special-casing at the render site.

**Why derived and not a table.** A `Notification` table would need a migration,
write-sites threaded through roughly eight existing server actions, and a
backfill for state that already exists — and it would silently drift from
reality the first time a write-site was missed. Deriving cannot drift: the feed
*is* the state of the system. The cost is that a notification cannot be
dismissed individually, which the design does not ask for — its popover offers
"Marcar leídos", all of them, and nothing else.

**Read state is one nullable column.** `User.notificationsSeenAt DateTime?`;
the unread count is the number of rows newer than it, and `markSeen()` sets it
to now. One migration, one column.

`buildFeed()` is a pure function over already-fetched rows, so it unit-tests
without a database — the same shape as `lib/attendance/attendance.ts`.

**The popover** is 348px at 12px radius with the raised shadow: an "AVISOS"
eyebrow beside a "Marcar leídos" accent text button, then rows of 6px dot +
title 13px/550 + body 12px muted + mono 10.5px timestamp, hairline between.
Navigating closes it. Each row links to the thing it is about.

## Part 5 — The ⌘K palette

`src/app/(app)/command-palette.tsx` over a `search()` server action in
`src/lib/search/search.ts`, searching **tasks, people and P1N** as the handoff
specifies, results grouped by kind.

No search index: three `contains` queries against columns that are already
indexed, capped at a handful of rows each. The dataset is one company's
operations, not a corpus — an index would be machinery for a problem that does
not exist yet.

Opens on ⌘K / Ctrl+K and on clicking the field; Escape and selection close it.
Ranking is exact-prefix before substring, then by kind in the order above.

## Part 6 — The now bar

`now-bar.tsx` is **restyled only**. Its behaviour — the local 15s tick, pace,
gap detection, pause/complete/close-day — is correct and untouched.

Layout to spec, left to right: a 3px×28px status rail, the status eyebrow over
the task name, the live stopwatch at 15px mono/600, a spacer, the right-aligned
pace readout, then Pausar / Terminar / Cerrar el día. The rail, eyebrow and
label switch `--color-run` → `--color-pause` when paused.

Two positional changes: `lg:left-[208px]` → `lg:left-[238px]`, and the inner
cap `max-w-[1600px]` → `max-w-[1180px]` to match the content column below.

## Part 7 — The content column

The handoff specifies 1180px. `layout.tsx` currently caps at 1600px, and its
comment records *why*: the cap used to be lower, and "past about 1450px every
extra pixel piled up as dead space on the right while the week grids next to it
stayed cramped."

Taking 1180 literally would re-break the week grids on `/plan` and `/team`.

**Resolution: 1180 by default, with an opt-out for the two matrix screens.**

```
<div className="mx-auto w-full max-w-[1180px] [&:has([data-wide])]:max-w-[1600px]">
```

`/plan` and `/team` mark their root element `data-wide`. The container widens
because of what it contains — no prop threaded through server components, no
pathname check in a component that has no business knowing routes. Two callers,
both documented at the call site.

## Part 8 — Primitives

Sub-projects 2–4 all reach for the same small vocabulary, so it is defined once
now, in `globals.css`'s existing `@layer components` block:

| Class | What |
| --- | --- |
| `.chip` | 4px-radius state chip (plan matrix, calendar, team cells) |
| `.pill` | 999px outlined status pill |
| `.rail` | 3px semantic left border |
| `.kpi` | KPI card and its mono number |
| `.track` / `.track-fill` | 999px progress track, 500ms width transition |
| `.stopwatch` | 46px mono/500/-0.03em, tabular |
| `.popover` | 12px radius + raised shadow |
| `.table-erp` | 11px/600/0.07em uppercase faint header, 9–11×14px cells |

**One colour convention, not four variants per class.** Each state-carrying
class reads a single custom property, `--tone`, defaulting to
`var(--color-line)`; the caller sets it to the semantic token it needs.

```css
.rail { border-left: 3px solid var(--tone, var(--color-line)); }
.pill { border: 1px solid var(--tone, var(--color-line)); color: var(--tone, var(--color-faint)); }
```

```tsx
<div className="rail" style={{ "--tone": "var(--color-run)" }} />
```

So `run / pause / stall / accent / done` cost nothing per class, and a new tone
later costs nothing at all. Where the design also asks for a wash background,
the caller sets `--tone-wash` alongside it; the two are always set together.

**Type scale.** The design uses half-steps the repo's scale lacks — 10.5, 11.5,
12.5, 13.5, 21, 25 and 46px. They are added as named `@theme` tokens rather
than scattered as arbitrary values, so the scale stays enumerable and the next
sub-project has somewhere to land.

---

## Deliberate deviations from the handoff

Recorded so they are not read as oversights:

1. **Routes keep their current paths.** Visual design only. (Above.)
2. **The theme toggle stays a three-way cycle.** The handoff draws a sun ⇄ moon
   pair; the repo cycles system → light → dark and shows the state you are
   *in*. Three modes is strictly more capable, `/me` already offers the triple,
   and SYSTEM is what makes the theme follow the OS. Sizing adopted, behaviour
   kept.
3. **Content column is 1180 with a documented opt-out**, not a flat 1180.
   (Part 7.)
4. **Notifications are derived, not stored.** (Part 4.)

## Testing

Lib-level, matching the repo — every existing test is under `src/lib`, and this
sub-project is not the place to introduce a component-test harness.

- `feed.test.ts` — `buildFeed()` over fixture rows: ordering, the
  `notificationsSeenAt` boundary (a row exactly at the timestamp is *read*),
  role gating, and the empty case.
- `search.test.ts` — ranking: exact prefix before substring, grouping order,
  the cap, and an empty query returning nothing rather than everything.
- `breadcrumb.test.ts` — pathname to keys, including nested routes
  (`/crm/sources/[id]`) and an unmapped route yielding no title.
- `dictionary.test.ts` — already asserts EN and ES have identical key sets; the
  new strings are covered by it for free.

Manual verification: both themes on every route, since the handoff makes theme
parity a requirement and the `light-dark()` tokens mean nothing is
theme-conditional in markup.

## Sequencing

Icons → sidebar → primitives can land in any order; the top bar needs the icon
set; notifications and ⌘K need the top bar to hang in; the now bar and the
content column are independent of all of it. The migration for
`notificationsSeenAt` should land before the feed reads it.
