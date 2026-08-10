# Putting this live

There is an older ERP, but **it is unused and holds no data worth keeping**.
So this is not a data migration and not a cutover in the usual sense. It is a
**first launch**: an empty database, filled deliberately, before anyone signs in.

That makes it far simpler than it would otherwise be — no legacy schema to
read, no import to write, no foreign password hashes, no historic timestamps in
an unknown timezone. Earlier versions of this document assumed all of those.
They no longer apply.

What replaces them is a smaller but real job: **the system starts with nothing
in it, and an empty system looks exactly like a broken one.** Everything below
is ordered around getting the founding data in before the first morning.

> Written in English to match the rest of the repository. Say the word and I
> will produce a Spanish version — the interface itself is Spanish-first and
> stays that way.

---

## ⚠️ Read this before you touch anything

**To whoever is putting this live:** this section is the warning. The rest of
the document is the detail behind it.

**1. Nothing in this repository has ever run in production, and nobody except
its author has reviewed the code.** The tests pass (511 of them) and it builds
cleanly, but that only means the tested behaviour is intact. It is not evidence
that a launch works. Assume you are the first person to run this for real,
because you are.

**2. The database starts empty, and an empty system fails silently.** Somebody
who logs in before the founding data exists does not see an error. They see a
working app with nothing in it, and conclude it is broken. The
[founding data](#what-must-exist-before-anyone-signs-in) is the actual work of
launching this.

**3. Only HR has a schedule. The other four departments get empty days.** This
is measured, not predicted — see [the rehearsal](#this-has-been-rehearsed).
Recurring rules exist only for HR (`fixtures/recurring-hr.json`: 28 rules).
ADE, ATIC, MYD and ACA have **zero**, and a department with no recurring rules
generates no daily work — ever, silently, with no error anywhere.

ACA (Academics) is worse off still: it has no catalogue either, so there is
nothing even to build rules from.

Either build those rules in `/catalogue` before launch, or launch HR first and
be explicit that the rest are not live yet. **This is the single most likely
way for the launch to look like a failure.**

**4. Nobody has a password until you create one, and there is no self-service
reset.** `npm run seed` creates two founding accounts and prints their password
once. Every other person is created by hand in HR → People. If somebody is
locked out, HR resets it from that screen — there is no "forgot password" link
to fall back on.

**5. Run `npx prisma migrate deploy` on every release.** Not `migrate dev`,
which is a development command and will prompt or reset. There are 26
migrations.

**6. Rehearse the whole sequence on a throwaway database first, timed.** It is
short, but you want to have run it once before the morning it matters.

**7. Before switching the old ERP off, confirm it really is unused** — that
nobody has quietly kept typing into it — and check whether it was ever the
legal *registro de jornada*. If it was, its records are legally retained for
four years even if nobody uses it. Export before decommissioning. See
[Time records](#time-records-and-the-law).

**One thing that is easy to waste time on:** `SESSION_SECRET` appears in
`.env.example` and in older notes. **No code reads it.** Sessions are random
tokens stored as SHA-256 hashes in the database; there is nothing to sign.

---

## Where the code is

**Repository:** `git@github.com:SantiHPF/MBE-ERP.git` — branch **`main`**.

`main` is the whole product. Clone it and you have everything; there is no
other branch to remember and nothing sitting uncommitted on a laptop. This was
not true before 2026-08-10, and any older copy of this document says so.

## Health of this codebase

Measured on `main`, 2026-08-10:

| | |
|---|---|
| Tests | **511 passing**, 27 files (`npm test`) |
| Build | clean (`npm run build`) |
| Migrations | **26**, all applied; `prisma migrate status` reports no drift |
| End-to-end checks | 7 scripts (`verify:attendance`, `verify:crm`, `verify:anchors`, `verify:concurrency`, `verify:gaps`, `verify:follow`, `verify:sessions`) |
| Stack | Next.js 16 (App Router), React 19, Prisma 7, PostgreSQL, Tailwind v4 |

---

## This has been rehearsed

On 2026-08-10 the launch sequence below was run end to end against an empty
database on `main`. It is not a paper exercise: every command completed, and
the numbers here are its actual output.

| Step | Result |
|---|---|
| `prisma migrate deploy` | 26 migrations applied, no errors |
| `npm run seed` | **5** departments, 2 founding accounts, password printed once |
| `import-catalogue.ts` | 134 tasks — ATIC 37, ADE 43, HR 39, MYD 15, **ACA 0** |
| `import-recurring.ts fixtures/recurring-hr.json` | 28 rules, HR only |
| `npm run schedule` | 104 tasks created, 102 assigned, 2 unassigned, 514ms |

**A seeded HR person got a real day** — ten tasks, 362 minutes, laid out from
09:00 with work scheduled around the midday break, not through it.

**A seeded ATIC person got nothing at all.** Not an error, not a warning: an
empty day. That is warning 3 above, demonstrated.

**About those 2 unassigned tasks.** Both are "Reunión Semanal y Prep", one per
week. The HR fixture pins it to Monday 10:00 and also pins "Reunion Calendar"
to Monday 10:00 — two rules, one slot. With a single HR person, one of them
cannot be placed, and the engine correctly declines to place it rather than
double-booking. With a real HR team it lands on somebody else. **This is a
conflict in the fixture data, not a bug**, but if HR is still one person at
launch, expect it and fix the rule rather than chasing the scheduler.

The rehearsal ran on a throwaway database, which was dropped afterwards. To
repeat it, point `DATABASE_URL` at an empty database and run the steps in
[the runbook](#launch).

---

## What must exist before anyone signs in

Somebody logging in on the first morning sees a real day only if all of this
exists. In dependency order — each row needs the one above it:

| Needed | How it gets there | Without it |
|---|---|---|
| `Department` | `npm run seed` | nothing works; everything is department-scoped |
| `User` with a password | `npm run seed` for the founders, then HR → People | nobody can sign in |
| `WorkingPattern` per person | set when creating the person | **no capacity → empty day, silently** |
| `TaskTemplate` (the catalogue) | `npx tsx scripts/import-catalogue.ts` | there is no work to draw from |
| `RecurringRule` | `npx tsx scripts/import-recurring.ts fixtures/recurring-hr.json`, or built by hand in `/catalogue` | **nothing is ever generated** |
| Assigned tasks | `npm run schedule`, before people arrive | the catalogue exists but no day is laid out |

The two rows in bold are the quiet failures. Neither shows an error; both just
produce an empty day, which reads to the person in front of it as "this thing
does not work."

**What the fixtures cover.** `fixtures/catalogue.json` has entries for ADE (43),
ATIC (37), HR (39) and MYD (15) — 134 tasks, but **nothing for ACA**.
`fixtures/recurring-hr.json` covers HR alone (28 rules). So after running both
imports: HR has a real working day, three departments have a catalogue with no
schedule attached, and ACA has neither.

Both importers are safe to re-run: the catalogue matches on department + name
and deactivates rather than deletes, and recurring rules are keyed by template
so a second run replaces a schedule instead of stacking a duplicate on top of
it.

`npm run seed` creates only the founding accounts — everybody else is meant to
be created through HR → People, which is why that screen exists. It reads
`SEED_PASSWORD` if set, otherwise generates a password and **prints it once**.
Capture it at that moment; it is not stored anywhere.

---

## Passwords

This app hashes with **Argon2id** ([password.ts](src/lib/auth/password.ts)).
With no legacy accounts to bring across, there is no hash-compatibility problem
to solve — the hard part of most launches simply does not exist here.

What remains is distribution:

- The seed prints the founding password once.
- HR creates everybody else and sets an initial password for each.
- Those passwords have to reach people through a channel you trust.

**There is no self-service password reset.** HR resets from `/hr/people`, which
also ends that person's sessions. For a handful of people that is fine. If a
whole company is signing in for the first time on one morning, it becomes a
queue at somebody's desk — plan for who is staffing it, or build the reset flow
before launch rather than after.

---

## Time records and the law

If the team is in Spain, daily working-time records are required by RD 8/2019
and must be kept for four years.

Two separate questions, and both need a deliberate answer:

**The old system.** Even unused, if it was ever the legal record, its existing
data is subject to that retention period. Export it to cold storage before
decommissioning. "Nobody uses it" is not the same as "nothing in it matters."

**This system, going forward.** `AttendanceDay` here is an *operational* record,
not a legal one. It is editable after the fact and has no retention guarantee —
deliberately, because the nightly sweep has to be able to correct a day nobody
closed. If this app is to *become* the legal *registro de jornada*, that needs
an append-only correction history instead of in-place edits. That is a schema
change and a decision to make on purpose — not something to inherit by accident
on launch day.

`TimeEntry` and `PauseEvent` are the other records with no way to reconstruct
them after the fact.

---

## The launch runbook

### Beforehand

- Confirm the old ERP is genuinely unused, and export anything legally retained.
- Provision the host: **Node 22+**, **PostgreSQL 15+**.
- Decide whether ADE, ATIC and MYD launch with HR or later. If with HR,
  their recurring rules must be built in `/catalogue` first — this is the
  long pole, and it is data entry, not engineering.
- Run the whole sequence below against a throwaway database, end to end, and
  sign in as a real person afterwards to confirm the day looks sensible.

### Launch

1. Create the production database.
2. `npx prisma migrate deploy`
3. `npm run seed` — **capture the printed password.**
4. `npx tsx scripts/import-catalogue.ts`
5. `npx tsx scripts/import-recurring.ts fixtures/recurring-hr.json`
6. Build any remaining recurring rules in `/catalogue`.
7. Create the real people in HR → People, **each with a working pattern.**
8. `npm run schedule` — lays out and assigns the fortnight ahead.
9. Spot-check by hand: headcount, one person's working pattern against hours you
   already know, the catalogue size, and one person's `/my-day`.
10. Deploy the app. Set `DATABASE_URL`, `SCHEDULE_TIMEZONE`, and
    `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` if the sheet ingest is in use. Leave
    `SEED_PASSWORD` unset.
11. Set up cron: `npm run schedule` nightly, `npm run ingest` as often as the
    sheet changes. Both are safe to re-run.
12. Switch the old ERP off.

### The first morning

Be present. The two things that will go wrong are **people who cannot sign in**
and **people with an empty day** — the second almost always a missing
`WorkingPattern`, or a department with no recurring rules. Both are fixable
live from `/hr/people` and `/catalogue`.

### Rollback

Genuinely easy here, and worth knowing: with no migrated data, rolling back
means switching the old ERP back on and walking away from whatever was entered
in the new one. The only thing at risk is data recorded since launch, so the
cost of rolling back grows by the day. Decide within the first week.

---

## Deployment requirements

- **Node 22+**, **PostgreSQL 15+**.
- `npx prisma migrate deploy` on every release. Several migrations here were
  hand-written because Prisma 7 refuses to generate them non-interactively when
  it wants to warn about something; they are normal migrations in the folder.
- **Sessions need no secret.** The cookie carries a 32-byte random token and the
  database stores only its SHA-256, so a stolen dump does not hand over live
  sessions. Cookies are httpOnly, `sameSite=lax`, `secure` in production, 30
  days. `SESSION_SECRET` is in `.env.example` but **is not read by any code**.
- `SCHEDULE_TIMEZONE` (default `Europe/Madrid`). Working hours are stored as
  minutes-from-midnight wall-clock, which keeps the scheduler free of DST
  arithmetic.
- Leave `SEED_PASSWORD` unset in production.
- The local Postgres in `npm run db:start` is a **development convenience** — a
  cluster in `.pgdata` on port 5433 owned by the current user. It is not how
  this should run in production.
- **A hard-coded seed password is in git history** up to commit `1627779`. The
  seed now generates one instead; make sure the old one never reaches
  production.

---

## What landed in the most recent round

Two rounds of work, 44 commits, merged to `main` on 2026-08-10. Specs and plans
are in `docs/superpowers/`.

**Scheduling and workflow** (`2026-07-31-round-three-design.md`) — paired tasks
placed together, with the second half staying put once the first is under way;
tasks held behind a predecessor the engine is not itself placing; long jobs
split across sittings; a gap in the day offering something useful to fill it;
"I cannot do this one", with a reason and a choice of what happens next;
messages between people; lunch clock-in and clock-out; contact details for a
source institution; bug and suggestion reports raised from inside the app. Plus
seven scheduling fixes — deadlines now bind in fallback placement, must-do work
no longer loses the day to a routine, anchored work lands at its anchor, a rule
tops up what you planned rather than adding to it, and catalogue tasks stay in
their half of the day.

**The shell** (`2026-08-03-shell-redesign-design.md`) — a new sidebar and top
bar, with the top bar naming the page you are on; a notifications bell folding
triage's alerts into one ordered list, in Madrid time; and a command palette on
⌘K that jumps to a task, a person or a P1N.

**Nine new migrations:** `follow_on_tasks`, `shift_half`, `work_sessions`,
`messages`, `task_blocks`, `break_clock`, `source_contact`, `reports`,
`notifications_seen_at`.

---

## If a screen has to be added

This app's look is the product. Anything new gets built in **this** design
system — the component classes in `globals.css` (`.card`, `.btn`, `.field`,
`.badge`, `.eyebrow`) and the existing screens are the reference. Pasting markup
in from elsewhere imports a second visual language and undoes the work.

Two things to check on anything new, because both have caught real bugs here:

- **Every foreground/background pair must clear 4.5:1 in both themes.** Three
  of the brand's secondary colours are print colours and fail as screen text;
  that is why the palette uses shades of the brand hue rather than the swatches
  themselves.
- **Never nest `@theme`.** Tailwind v4 hoists every `@theme` block to the top
  level, so a nested one silently replaces the palette instead of overriding it.
  The dark theme uses `light-dark()` plus `color-scheme` for this reason.

---

## Invariants that must survive

All of these were bugs first, and none is visible until the system runs twice.

1. **Rotation history is counted strictly before the window being scheduled.**
   Ranking must not read the ledger it also writes, or the second run sees the
   first run's output and chooses differently — and the schedule reshuffles
   under people every time the engine fires.
2. **`RotationLedger` is a cache, not a source of truth.** It is recomputed from
   the tasks by `refreshRotationLedger()` in
   [run.ts](src/lib/scheduling/run.ts); incrementing per run double-counts.
3. **Recurring rules are updated in place, never replaced.** Generated tasks are
   keyed on the rule's id; deleting and recreating a rule gives every future
   task a new key and leaves the old ones behind — two of everything.
4. **One running timer per person is enforced by the database**, by a partial
   unique index on `TimeEntry` that Prisma cannot express and that lives in
   `20260728140000_concurrency_guards`. If the schema is ever rebuilt from
   `schema.prisma` alone, that index disappears silently and concurrent starts
   double-count time again.
5. **An open `TimeEntry` is capped when read** (`MAX_OPEN_SECONDS` in
   [elapsed.ts](src/lib/tasks/elapsed.ts)) and closed by the attendance sweep.
   Without both, a task started on Friday and abandoned reports ~72 hours by
   Monday and corrupts every average built on it. Measured at 79h in a real run
   before the fix.
6. **Anchored repetitions credit the rotation once per group**, not once per
   repetition.
7. **Re-running `npm run schedule` over the same window must produce identical
   assignments.** The single property to check after touching the engine.
8. **A deadline binds in every placement path, including the fallback.** The
   fallback pass originally ignored it, so a task due by 11:00 could be placed
   at 16:00 only when the main pass had already given up — a bug that appears
   solely on busy days.
9. **The second half of a pair does not move once the first is under way.**
   Re-running the engine mid-morning must not relocate work somebody has
   already started against.
10. **A recurring rule tops up what a human planned; it does not add to it.**
    The opposite reading double-books the day, and only on days somebody had
    already planned by hand.

`verify:gaps`, `verify:follow` and `verify:sessions` exist to hold 8–10. Run
them after any change to `src/lib/scheduling/`.

---

## Traps that have already cost time here

- **The Prisma client is cached on `globalThis`** ([db.ts](src/lib/db.ts)).
  After any schema change, **restart the dev server** — a hot reload keeps the
  stale client and every page 500s with "unknown model". This has caught us
  twice.
- **Pure logic and database access live in separate files** (`attendance.ts` /
  `attendance-db.ts`, `now.ts` / `now-db.ts`). The pure half is unit-tested
  without a database and is safe to import from client components. Mixing them
  breaks the browser build: Prisma pulls in `pg`, which does not bundle.
- **Tailwind v4 hoists `@theme`** — see above.
- `npm audit` flags `sharp`/libvips, pulled in transitively by Next for image
  optimization. This app serves no images.

---

## Known gaps to weigh before committing to a date

None of these blocks a launch, but each is worth knowing about in advance:

- **Only HR has recurring rules.** ADE, ATIC and MYD have catalogues loaded but
  no schedules, so they generate no daily work until somebody builds rules in
  `/catalogue`. ACA has no catalogue either. Measured in the rehearsal: HR 104
  tasks over the fortnight, every other department 0. The most consequential
  item on this list — see warning 3.
- **No self-service password reset.** HR resets from `/hr/people`.
- **Mobile is unfinished.** The one hard blocker is a missing viewport meta tag
  in `src/app/layout.tsx`; after that, touch targets and turning the sidebar
  into a drawer. If people need this on a phone from day one, do that first.
- **Attendance is manager-thin.** `/team` lists lunches that did not match the
  timetable, but the full record is still personal-only. The model is
  department-scoped through `User`, so it is a screen to build, not a migration.
- **Notifications do not leave the app.** The bell folds triage's alerts into
  one list, but there is no email and no push — anyone not signed in that day
  hears nothing.
- **No estimate-vs-actual reporting per task across a department** — what would
  let the catalogue durations get better over time.
- **Growing a split job.** `setTaskQuantity` refuses on a parent; making a long
  job longer means deferring or adding separately.

---

## How the system works

For the step-by-step explanation of availability, materialisation, assignment,
the working day, attendance, triage, meetings and the CRM, see the
[README](README.md). This document assumes it.
