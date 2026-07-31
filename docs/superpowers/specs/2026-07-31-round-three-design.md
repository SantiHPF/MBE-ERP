# Round three: many predecessors, in-app reports, and three assign fixes

Date: 2026-07-31
Branch: `feature/erp-round-two`

Three independent pieces of work, shipped together:

1. A catalogue entry can come after **more than one** other entry.
2. Every page can raise a **bug report or improvement suggestion**, readable
   from the command line while the ERP is being worked on.
3. Three **confirmed defects in the auto-assign engine**, each reproduced
   before being written down.

They share no code. Parts 1 and 3 both touch `follows`, and the order they land
in matters — see *Sequencing* at the end.

---

## Part 1 — A task can come after several others

### The ask

> "Debriefing proceso" must be done after "Proceso", and also after
> "Proceso LATAM".

### The decision that shapes everything else

When both leaders land on the same day, **each leader brings its own
debriefing**. This is not a join: the debriefing is not one task waiting on
both, it is one debriefing per thing being debriefed. You debrief Proceso after
Proceso; you debrief Proceso LATAM after Proceso LATAM.

That decision keeps the runtime model exactly as it is. `Task.followsTaskId`
stays a single link, because every generated follower still comes after exactly
one real leader. Only the *catalogue* becomes many-to-many.

### Schema

`TaskTemplate.followsId` is replaced by an explicit join table:

```prisma
model TemplateFollow {
  followerId String
  follower   TaskTemplate @relation("FollowFollower", fields: [followerId], references: [id], onDelete: Cascade)
  leaderId   String
  leader     TaskTemplate @relation("FollowLeader",   fields: [leaderId],   references: [id], onDelete: Cascade)

  @@id([followerId, leaderId])
  @@index([leaderId])
}
```

Both sides cascade on delete: a link to an entry that no longer exists is not a
link. This is a deliberate change from the old `onDelete: SetNull`, which was
the only sensible option when the link lived in a column on the follower.

The migration:

1. creates `TemplateFollow`;
2. inserts one row per existing non-null `TaskTemplate.followsId`
   (`followerId` = the row's own id, `leaderId` = its `followsId`);
3. drops the `followsId` column and its index.

Reversible in the same three steps backwards, which only loses information for
followers that have gained a second leader since.

### Pure logic — `src/lib/plan/follow.ts`

The link set stops being a parent pointer per node and becomes a set of edges:

```ts
export type FollowLink = { followerId: string; leaderId: string };
```

Three functions change shape, because the graph is now a DAG rather than a
forest:

- **`chainFrom(leaderId, links)`** returns everything hanging off a leader,
  depth-first, **paired with the parent each one actually comes after**:
  `{ templateId, afterTemplateId }[]`. Today it returns a flat list and the
  caller links each task to whatever preceded it in the walk, so for
  `A → (B, D)` the generated D is linked to B rather than to A. Returning the
  real parent fixes that, and is required once a node can have several.
- **`wouldCycle(followerId, leaderId, links)`** walks *every* parent upward
  (breadth-first over the reversed edges) instead of following one pointer.
  Pointing an entry at itself is still caught by the first comparison.
- **`depthOf(id, links)`** becomes the **longest** path from `id` to a root.
  With one parent per node there was only one path; now the deepest is the one
  that matters, since `MAX_CHAIN` is a bound on the whole structure.

`MAX_CHAIN` stays 5 and keeps its existing meaning and rationale. The cycle
guard inside the depth-first walk stays: a stored cycle drops work rather than
looping.

A template with two leaders legitimately appears in *both* leaders' chains. The
`seen` set in `chainFrom` is per-walk, so this is already the behaviour once the
edges are right.

### Generation — `src/lib/plan/follow-db.ts`

Barely changes, which is the point of the model above.

- `linksFor(departmentId)` reads `TemplateFollow` joined to active templates in
  the department instead of selecting `followsId`.
- `buildFollowKey(leaderExternalKey, followerTemplateId)` is unchanged and
  already does the necessary work: two leaders have two different external
  keys, so they produce two distinct follower tasks with no dedup logic and no
  risk of one overwriting the other. Idempotency across re-runs is unchanged.
- `createFollowers` links each new task to the task generated for its **actual
  parent** (from `chainFrom`'s new return), falling back to the leader when the
  parent is the leader itself. It no longer threads a `previous` cursor.
- **Titles.** When a follower template has two or more leaders, the generated
  task is titled `"<template name> — <leader template name>"`. With exactly one
  leader the title is untouched, so every entry in the catalogue today looks
  exactly as it does today.

Placement is unchanged: immediately after the task it follows, same person,
same day, same origin.

`followersOf` needs no change at all — it walks `Task.followsTaskId`, which is
still single.

### Catalogue UI

`catalogue-form.tsx`'s single `followsId` select becomes a multi-select over the
department's other active entries. The existing downstream-exclusion logic
(which hides entries that already sit below this one) generalises to the DAG by
reusing `wouldCycle` rather than the local single-parent walk at line 102.

`saveCatalogueEntry` in `src/lib/catalogue/actions.ts` takes `leaderIds: string[]`
and validates each one before writing, reusing the existing errors:

- an entry pointing at itself → `errors.followsItself`;
- a link that would cycle → the existing cycle error;
- a link that would push the longest path past `MAX_CHAIN` → the existing depth
  error, naming the entry responsible.

Links are replaced as a set inside the existing transaction: delete the rows for
this follower, insert the new ones.

### What is explicitly not being built

No join semantics ("wait for all of them"), no per-entry flag choosing between
join and per-leader. The question was asked and answered: one debriefing per
leader, always.

---

## Part 2 — Report a bug or a suggestion from any page

### The ask

A button on every page, so that testing does not mean keeping a separate list —
and a way for the assistant to **read the reports directly out of the ERP**
rather than having them pasted in. Reports cover improvement suggestions as
well as defects.

### Schema

```prisma
enum ReportKind   { BUG, IDEA }
enum ReportStatus { OPEN, CLOSED }

model Report {
  id     String @id @default(cuid())
  /// Short handle, so a report can be closed by number from the CLI.
  number Int    @unique @default(autoincrement())

  kind   ReportKind   @default(BUG)
  body   String
  status ReportStatus @default(OPEN)

  /// Captured automatically, so filing one costs a sentence and nothing else.
  path      String
  userId    String
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      Role
  locale    String
  /// Whatever was running when it was filed, when anything was.
  taskId    String?
  task      Task?   @relation(fields: [taskId], references: [id], onDelete: SetNull)

  createdAt   DateTime @default(now())
  closedAt    DateTime?
  closedById  String?
  closedBy    User?     @relation("ReportCloser", fields: [closedById], references: [id])
  closedNote  String?

  @@index([status, createdAt])
}
```

`User` gains `reports Report[]` and `closedReports Report[] @relation("ReportCloser")`,
and `Task` gains `reports Report[]`, since Prisma requires the other side of
every relation.

`number` exists because `npm run bugs -- close 7` is usable and
`close cmf3x9q2a0000` is not.

Role and locale are captured because a report that only reproduces for a WORKER,
or only in Spanish, is a different report — and neither is recoverable later
once the account changes.

### The button

A `ReportButton` client component, rendered in the app shell
(`src/app/(app)/layout.tsx`) inside the bottom cluster of the sidebar, beside
sign-out. That puts it on **every page for every role** — the sidebar is the
shell — without colliding with the fixed now-bar the way a floating corner
button would.

It opens a small dialog holding:

- a two-way toggle, **Bug** / **Suggestion**, defaulting to Bug;
- one textarea;
- Send.

Nothing else is asked for. `path` comes from `usePathname()` and is submitted
with the form; the user, role, locale and running task are read on the server
inside the action, where they cannot be forged by the client.

The action is `createReport` in `src/lib/reports/actions.ts`, guarded by
`requireUser()` — every role may file. Bodies are validated with zod like every
other action: trimmed, non-empty, at most 4000 characters.

Both languages get dictionary entries, like every other string in the app.

### Reading them from the command line

`scripts/reports.ts`, wired up as `npm run bugs`:

```
npm run bugs                             # open reports, newest first
npm run bugs -- all                      # open and closed
npm run bugs -- bugs | ideas             # filter by kind
npm run bugs -- show 7                   # full body and captured context
npm run bugs -- close 7 "fixed — assign.ts ordering"
```

Output is plain text, one report per block: number, status, kind, path, who,
when, the body, and the running task if there was one. It reads the same
database as the app through the existing `prisma` client, exactly like the other
`scripts/verify-*.ts` tools.

`close` sets `status`, `closedAt` and `closedNote`. `closedById` is left null
for a CLI close — the command line is not a session, and inventing a user for it
would put a name against something that person did not do.

### `/admin/reports`

ADMIN only, guarded by `requireRole("ADMIN")`. Lists reports with filters for
status and kind, shows the captured context, and closes one with a note. It is
the same data as the CLI, for when reading it in the app is easier.

`requireRole` already exists and already takes a minimum role, so no new guard
is needed.

---

## Part 3 — Three defects in the auto-assign engine

All three were reproduced against the real `assignDay` before being written
down. The existing suite (478 tests, 23 files) passes both before and after; each
fix arrives with the probe that found it, turned into a regression test.

### Defect 1 — any group outranks a MUST single

`assignDay` places every grouped task before any ungrouped one:
`for (const members of groups.values())` at `assign.ts:476` runs to completion
before `for (const task of singles)` at `assign.ts:670`. `orderTasks` sorts by
priority *within* each bucket and never across them.

**Reproduced:** one person, 09:00–11:00. A SPARE_TIME anchored routine of two
60-minute repetitions took the whole day; the MUST task came out with
`start: null`, `overCapacity: true`. Backlog work displaced must-do work.

This contradicts the contract written into the schema — SPARE_TIME "only appears
once everything else has been placed" — and into `TaskInput.priority`, "MUST is
placed first and never dropped".

**Fix.** Collapse the two loops into one pass over *units*, where a single is a
unit of one and a group is a unit of many. Units are ordered by the existing
comparator applied to each unit's highest-priority member, so a routine is
ranked by the most important thing in it. Group members keep their internal
order (`orderChain` then placement), and singles behave exactly as before
relative to one another. The only behaviour that changes is the one that was
wrong.

### Defect 2 — a deadline with no start time is ignored

In `placeFor` (`assign.ts:349-354`), `fixedEndMinutes` is only honoured on the
branch where a wanted start exists:

```ts
const from = wantedStart(task, candidate);
if (from == null) return findSlot(free, task.estimatedMinutes); // limit dropped
```

**Reproduced:** a 60-minute task with `fixedEndMinutes: 600` (finish by 10:00)
on a day whose 09:00–10:30 was already busy was placed at **10:30–11:30** — past
its own deadline, with no warning and nothing in triage.

**Fix.** Check the limit on that branch too. `findSlot` returns the *earliest*
fitting slot, so if that one busts the deadline no later one can satisfy it
either — returning null is correct, and the task surfaces in triage as
`no-slot-fits` rather than silently landing late.

### Defect 3 — a follower is abandoned the moment its leader starts

Once a leader is `IN_PROGRESS` it is immovable and drops out of `schedulable`.
`run.ts`'s `chainRoot` walk then cannot find it, so the follower is left in a
group of one holding a `followsTaskId` that points outside the group. In
`placeAll`, `endOf.get(task.followsTaskId)` misses, and the follower falls
through to ordinary first-fit.

**Reproduced:** a follower whose leader is running 14:00–16:00 was assigned to
**a different person entirely**, at **09:00** — before the work it comes after.

This fires in the most ordinary case there is: you are doing the leader right
now. It defeats both halves of the feature's promise — same person, and after.

**Fix.** `run.ts` already loads the in-flight tasks; look the leader up among
them, and when a schedulable task follows one:

- set the follower's `pinnedAssigneeId` to the leader's assignee, so the pair
  stays one person's work;
- pass the leader's `scheduledEnd` as a new
  `TaskInput.notBeforeMinutes?: number | null`, honoured by `placeFor` and
  `fallbackFor` as a floor on the start.

A DONE leader pins the same way but needs no time floor beyond its end. If the
pinned person has no room, the task comes out as `pinned-person-unavailable` and
is visible in triage — which is the correct outcome, and better than the pair
being silently torn apart.

### Recorded, not fixed

`RotationLedger.assignedCount` is a lifetime total that is never windowed, and
`compareForTask` ranks on it first. A new joiner therefore sits at 0 for every
template in their department and is preferred for nearly all of it until they
catch up. The comment at `assign.ts:182` says this is intentional — "newcomers
get a turn" — and it is a judgement call rather than a defect, so it is not
being changed here. Ranking on a rolling window (say 90 days), or seeding a
joiner's ledger at the department median, are the two obvious remedies if it
ever bites.

---

## Testing

- **Part 1.** `follow.test.ts` gains DAG cases: a node with two parents appearing
  under both leaders' chains, `wouldCycle` catching a cycle that only exists
  through the *second* parent, `depthOf` returning the longest path. Generation
  is covered by `verify-follow.ts` extended to the two-leader case, asserting two
  distinct tasks with distinct external keys and correctly suffixed titles.
- **Part 2.** Action-level tests for `createReport` (context captured server-side,
  empty body refused) and for close. The CLI is thin enough that the action tests
  carry it.
- **Part 3.** The three probes above become regression tests in `assign.test.ts`,
  each asserting the corrected placement. The full suite must stay green — the
  ordering fix in particular touches every grouped assignment, and the existing
  1415-line `assign.test.ts` is the check that it changed only what it should.

## Sequencing

Part 3 before Part 1. Defect 3 is a fix to how followers are placed, and Part 1
changes how followers are *generated*; landing the fix first means its regression
test is written against the model everyone already understands, and Part 1 then
has a correct placement path to build on. Part 2 is independent of both and can
land at any point — first, if a working report button is wanted while the rest is
still in progress.
