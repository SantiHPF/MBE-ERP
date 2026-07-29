# Replacing the old ERP with this one

This app **replaces** the one currently hosted. Its code and its interface
become the whole product; the old front end is retired. What has to survive the
swap is the old system's **data**, which lives in a real database with real
people's hours in it.

So this is not a code merge. It is a **data migration plus a cutover**, and
everything below is ordered around that.

> Written in English to match the rest of the repository. Say the word and I
> will produce a Spanish version — the interface itself is Spanish-first and
> stays that way.

---

## Health of this codebase

| | |
|---|---|
| Tests | **290 passing**, 16 files (`npm test`) |
| Build | clean (`npm run build`) |
| Migrations | 17, all applied; `prisma migrate status` reports no drift |
| End-to-end checks | 4 scripts, all passing (`verify:attendance`, `verify:crm`, `verify:anchors`, `verify:concurrency`) |
| Stack | Next.js 16 (App Router), React 19, Prisma 7, PostgreSQL, Tailwind v4 |

> ### ⚠️ Before anything else
>
> **The last three sessions of work are not committed.** The most recent commit
> is `026e558` (2026-07-28 10:59). Since then roughly 100 files have changed —
> attendance, the CRM, the brand rework, the global now-bar and the filters are
> all sitting in the working tree only. `git status` for the exact figure.
>
> There is also **no git remote**. This exists on one machine, with no backup.
>
> Commit and push before planning a cutover. Everything below assumes the code
> is somewhere other than one laptop.

---

## The interface does not change

This app's look is the product, and none of the old interface comes across:

- the MBE palette, Blue Stone accent and Gantari face in
  [globals.css](src/app/globals.css) and [layout.tsx](src/app/layout.tsx);
- the grouped sidebar and the fixed now-bar in the app shell;
- light and dark, chosen per device;
- Spanish and English, chosen per person.

If the old ERP has a screen this one does not, **it gets rebuilt in this design
system** — the component classes in `globals.css` (`.card`, `.btn`, `.field`,
`.badge`, `.eyebrow`) and the existing screens are the reference. Pasting the
old markup in would import a second visual language and undo the work.

Two things to check on anything new, because both have caught real bugs here:

- **Every foreground/background pair must clear 4.5:1 in both themes.** Three
  of the brand's secondary colours are print colours and fail as screen text;
  that is why the palette uses shades of the brand hue rather than the swatches
  themselves.
- **Never nest `@theme`.** Tailwind v4 hoists every `@theme` block to the top
  level, so a nested one silently replaces the palette instead of overriding
  it. The dark theme uses `light-dark()` plus `color-scheme` for this reason.

---

## What I do not know, and you must find out first

I have never seen the old system. These are the answers the whole plan depends
on, and none of them can be guessed:

1. **Its schema.** Get a dump of a copy and introspect it (Step 1).
2. **How it hashes passwords.** This decides whether anyone can log in on day
   one. See [Passwords](#passwords--the-thing-most-likely-to-sink-launch-day).
3. **What timezone its timestamps are in.** UTC, `Europe/Madrid`, or naive
   local time with no zone at all. Getting this wrong shifts every historic
   hour by one or two.
4. **Whether it is the legal *registro de jornada*.** If yes, its time records
   are legally retained for four years and cannot simply be dropped — and this
   app is not currently built to be that record either. See
   [Time records](#time-records-and-the-law).
5. **Where and how it is hosted**, and whether the same place can run Node 22
   and a PostgreSQL 15+ instance.

---

## Step 1 · Read the old database

On a **restored copy**, never the live one:

```bash
# In a scratch checkout, or on a branch -- db pull overwrites the schema file.
DATABASE_URL="<copy of the old database>" npx prisma db pull
```

That gives you the old shape as a Prisma schema. Diff it against
`prisma/schema.prisma` here and write down, table by table, where each piece of
old data lands. **That mapping document is the deliverable of this step**, and
everything after it depends on being able to read it.

Expect the old system to have *fewer* concepts than this one, not more. Tables
like `AttendanceDay`, `RecurringRule`, `P1n` and the CRM will simply start
empty, and that is fine.

## Step 2 · Decide the identity mapping

`Department` and `User` first — nothing else can be mapped until people and
departments are, because everything in this schema hangs off those two by
foreign key.

Give the import a way to be **re-run without duplicating**: either match on a
natural key the old system already has (a username, an employee number), or add
a nullable `legacyId` column to `User` and `Department` in a small migration of
your own. The second is cleaner and makes dry runs repeatable, which you will
want more than once.

## Step 3 · Write the import

Model it on [prisma/seed.ts](prisma/seed.ts), which already does this shape of
work: create departments, create users with hashed passwords, create their
working patterns.

`scripts/import-legacy.ts`, run with `npx tsx`. **Order matters** — foreign
keys:

```
Department
  └─ User                      (needs departmentId)
       ├─ WorkingPattern        ← without this nobody has capacity and the
       │                          scheduler will assign them nothing
       ├─ Absence
       ├─ TimeEntry → PauseEvent
       └─ AttendanceDay
TaskTemplate                    (the catalogue)
  └─ RecurringRule              (when each template happens)
Task                            (historic, if worth keeping)
```

Make it **idempotent** — `upsert` on the natural or legacy key, never `create`.
You will run it several times against restored copies before you run it once
for real.

Do **not** import `RotationLedger`. It is a cache of a derivable fact;
`refreshRotationLedger()` in [run.ts](src/lib/scheduling/run.ts) recomputes it
from the tasks. Importing it would seed the fairness ranking with numbers that
do not match the task history.

## Step 4 · The minimum for a usable day one

Somebody logging in on the first morning sees a real day only if all of this
exists:

| Needed | Why |
|---|---|
| `Department` | everything is department-scoped |
| `User` with a working `passwordHash` | see below |
| `WorkingPattern` per person | no pattern → no capacity → no work assigned, and `/my-day` says "you are not scheduled to work today" |
| `TaskTemplate` | the catalogue of what work exists |
| `RecurringRule` | otherwise nothing is ever generated |
| `npm run schedule` **before people arrive** | materialises and assigns the fortnight |

Missing working patterns is the quiet failure: the app looks like it is working
and simply gives everybody an empty day.

---

## Passwords — the thing most likely to sink launch day

This app hashes with **Argon2id** ([password.ts](src/lib/auth/password.ts)).
The old system almost certainly does not; bcrypt is the usual answer.

`verifyPassword()` deliberately returns `false` rather than throwing when it
meets a hash it cannot parse, so a malformed record reads as "wrong password"
instead of crashing the login form. That is right for a login form and
**exactly wrong for a migration**: copy bcrypt hashes into `passwordHash` and
every single person gets "wrong details", with nothing in the logs saying why.

Pick one, deliberately, before the cutover:

- **Temporary passwords.** The import sets a per-person random password, hashed
  properly, and everyone is told theirs through a channel you trust. Simplest,
  and no foreign hash ever enters this database.
- **Rehash on first login.** If you can verify the old hashes, keep them in a
  separate column, verify against it on sign-in, and write a fresh Argon2 hash
  on success. Invisible to users. Needs a small change to `login()` in
  [login/actions.ts](src/app/login/actions.ts) and one extra column.

**There is no self-service password reset in this app.** HR resets a password
from `/hr/people`, which also kills that person's sessions. For a handful of
people that is fine; for a whole company on one morning it is a queue at
somebody's desk. If the team is large, build the reset flow *before* the
cutover, not after.

---

## Time records and the law

If the team is in Spain, daily working-time records are required by RD 8/2019
and must be kept for four years.

**This app's `AttendanceDay` is an operational record, not that.** It is
editable after the fact and has no retention guarantee — deliberately, because
the sweep has to be able to correct a day nobody closed.

So decide explicitly:

- If the old system was the legal record, its time data must be **retained**,
  whether or not it is imported here. Exporting it to cold storage before the
  swap is the minimum.
- If this system is to *become* the legal record, `AttendanceDay` needs an
  append-only correction history rather than in-place edits. That is a schema
  change and a deliberate decision — do not inherit the current behaviour by
  accident.

`TimeEntry` and `PauseEvent` are the other records with no way to reconstruct
them. Alongside `Absence` (including who decided it and when), `P1n`, and
`Meeting`/`ActionItem`, they are the data worth the most care.

---

## Step 5 · The cutover runbook

### T-7 days

- Code committed and pushed to a real remote.
- Import script written and run against a **restored copy**, end to end.
- Log in as three real people on that copy — a worker, a manager, an HR user —
  and confirm each sees a sensible day.
- `npm run build` on the target host. Confirm Node 22+ and PostgreSQL 15+.
- Decide the password strategy, and if it needs code, write it now.

### T-1 day

- Full rehearsal on a fresh restore, **timed**. You want to know whether the
  import takes four minutes or four hours before the morning you need it.
- `npm run verify:attendance`, `verify:crm`, `verify:anchors`,
  `verify:concurrency` against the rehearsed database.
- Write the rollback steps down, with the commands filled in.

### T-0, out of hours

1. Put the old ERP in read-only mode, or take it down. **No writes from here
   on** — anything typed into the old system after this point is lost.
2. **Take a fresh dump and verify it restores.** A dump you have not restored
   is not a backup.
3. Create the new database. `npx prisma migrate deploy`.
4. Run the import. Read its output rather than trusting the exit code.
5. Spot-check by hand: headcount, one person's working pattern against hours
   you already know, an absence you can verify, the catalogue size.
6. `npm run schedule` — materialise and assign the fortnight ahead.
7. Deploy. Set `DATABASE_URL`, `SESSION_SECRET` (a real random value),
   `SCHEDULE_TIMEZONE`, and `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` if the sheet
   ingest is in use.
8. Set up cron: `npm run schedule` nightly, `npm run ingest` as often as the
   sheet changes. Both are safe to re-run.
9. Sign in as one real person per department and walk `/my-day`.

### T+1, the first morning

Be present. The two things that will go wrong are **people who cannot log in**
and **people with an empty day** — the second almost always meaning a missing
`WorkingPattern`. Both are fixable live from `/hr/people`.

### Rollback

Viable only until people start entering data in the new system, which is the
first morning. Before that: point DNS back at the old app and restore the dump
from step 2. After that, rolling back means losing whatever has been recorded
since. The decision point is real, and it is early.

---

## Deployment requirements

- **Node 22+**, **PostgreSQL 15+**.
- `npx prisma migrate deploy` on every release. Several migrations here were
  hand-written because Prisma 7 refuses to generate them non-interactively when
  it wants to warn about something; they are normal migrations in the folder.
- `SESSION_SECRET` must be a real random value. Sessions are httpOnly cookies,
  `secure` in production, 30 days.
- `SCHEDULE_TIMEZONE` (default `Europe/Madrid`). Working hours are stored as
  minutes-from-midnight wall-clock, which keeps the scheduler free of DST
  arithmetic.
- The local Postgres in `npm run db:start` is a **development convenience** — a
  cluster in `.pgdata` on port 5433 owned by the current user. It is not how
  this should run in production.
- **A hard-coded seed password is in git history** up to commit `1627779`. The
  seed now generates one instead; make sure the old one never reaches production.

---

## Invariants that must survive

All of these were bugs first, and none is visible until the system runs twice.

1. **Rotation history is counted strictly before the window being scheduled.**
   Ranking must not read the ledger it also writes, or the second run sees the
   first run's output and chooses differently — and the schedule reshuffles
   under people every time the engine fires.
2. **`RotationLedger` is a cache, not a source of truth.** Recomputed from the
   tasks; incrementing per run double-counts. Do not import it.
3. **Recurring rules are updated in place, never replaced.** Generated tasks
   are keyed on the rule's id; deleting and recreating a rule gives every
   future task a new key and leaves the old ones behind — two of everything.
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
- **Tailwind v4 hoists `@theme`** — see the interface section above.
- `npm audit` flags `sharp`/libvips, pulled in transitively by Next for image
  optimization. This app serves no images.

---

## Known gaps to weigh before committing to a date

None of these blocks a cutover, but each may be something the old system
already does that this one does not:

- **No self-service password reset.** HR resets from `/hr/people`.
- **No notifications.** Nothing tells a manager work landed in triage, or HR
  that a request is waiting, beyond a badge they have to look at.
- **Mobile is unfinished.** The hard blocker is a missing viewport meta tag in
  `src/app/layout.tsx`; after that, touch targets and turning the sidebar into
  a drawer. If people need this on a phone from day one, do that first.
- **Attendance is personal-only.** No manager or HR view yet. The model is
  department-scoped through `User`, so it is a screen, not a migration.
- **Only HR has recurring rules.** ADE, ATIC and MYD have catalogues loaded but
  no schedules, so those departments generate no daily work until somebody
  builds them in `/catalogue`.
- **No estimate-vs-actual reporting per task across a department** — what would
  let the catalogue durations get better over time.

---

## How the system works

For the step-by-step explanation of availability, materialisation, assignment,
the working day, attendance, triage, meetings and the CRM, see the
[README](README.md). This document assumes it.
