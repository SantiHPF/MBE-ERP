# task-erp

Internal ERP that turns recurring work, a task catalogue, a job spreadsheet and
the weekly meeting into a scheduled day for each person — and tracks the time
they actually spend on it.

Interface in Spanish or English, chosen per person.

## What it does

- **Materializes work.** Recurring rules ("stock count every Monday and
  Thursday", "payroll on the last Monday of the month") become dated task
  instances. A Google Sheet of client jobs is polled into tasks. Weekly meeting
  action items become tasks when the meeting is finalised. New joiners generate
  their own induction interviews.
- **Assigns it automatically.** Capacity is a hard constraint and fair rotation
  is the ranking rule within it: a task only goes to somebody with room for it
  that day, and among those it goes to whoever has had that job least, and
  least recently. Must-do work is the exception — it is assigned even when
  everybody is full, so the overload is visible rather than the task vanishing.
- **Lets people plan their own week.** A task-by-day grid where you take the
  work you want. Anything nobody takes is handed out by the engine when the
  week starts, so choosing not to plan never means work goes missing.
- **Fits it to real hours.** Everyone's working pattern differs by weekday,
  including split shifts and Saturdays. Tasks are placed in actual free windows,
  around lunch, never past somebody's finishing time.
- **Tracks time, and why it stops.** One timer per person. The day runs in
  order. Pausing requires a category *and* a written reason; skipping ahead
  requires saying what stopped you and when you will do it instead.
- **Reacts to absences without guessing.** Reporting an absence takes effect
  immediately for sickness and flags the work it displaces. Nothing is
  reassigned automatically; a manager decides each one, with the viable options
  already worked out for them.
- **Runs the weekly meeting.** Notes and decisions are captured while it
  happens; the report writes itself and the actions become real tasks.
- **Records mistakes as P1Ns.** "Pasa 1 vez, no vuelve a pasar" — what went
  wrong, why, and the fix that would stop it recurring.

## Running it locally

Requires Node 22+ and PostgreSQL 17.

```bash
cp .env.example .env      # defaults work for local development
npm install
npm run db:start          # creates and starts a local Postgres cluster
npx prisma migrate dev
npm run seed              # departments + founding accounts
npm run import:catalogue  # 134 tasks from fixtures/catalogue.json
npm run import:recurring  # HR's schedule from fixtures/recurring-hr.json
npm run schedule          # materialize and assign the next two weeks
npm run dev               # http://localhost:3000
```

Sign in as `santi` / `task-erp-2026`.

The seed creates the founding accounts without employment dates, so no
induction interviews are generated for them. Set the dates in **HR → People**;
people created through that screen get their interviews immediately.

> **After a machine restart, run `npm run db:start` before `npm run dev`.**
> The database does not come back on its own, and every page fails without it.

To see the sheet ingest without Google credentials:

```bash
npx tsx scripts/demo-sheet-source.ts
npm run ingest -- --csv fixtures/example-job-sheet.csv
```

`npm run seed:demo` replaces everything with throwaway sample data — eight
people across two invented departments, useful for exercising rotation, which
needs more than one person in a department to show anything.

### About the local database

There is no Docker on the machine this was built on, and the system-wide
Postgres 17 install needs `sudo` to start. So `npm run db:start` creates a
cluster **owned by the current user** in `.pgdata` (gitignored), on port
**5433** so it never collides with a system Postgres on 5432. Development
convenience only — see Deployment. Set `PGBIN` if your Postgres binaries are
not at `/Library/PostgreSQL/17/bin`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | 120 unit tests |
| `npm run schedule [YYYY-MM-DD]` | Materialize + assign a two-week window. Safe to re-run |
| `npm run ingest [-- --csv path]` | Pull sheet sources into tasks |
| `npm run import:catalogue` | Load `fixtures/catalogue.json` |
| `npm run import:recurring [file]` | Load a department's schedule |
| `npm run seed` / `seed:demo` | Real founding data / throwaway sample data |
| `npm run db:start` / `db:stop` / `db:status` | Local Postgres cluster |
| `npm run db:studio` | Prisma Studio, to inspect data |
| `npx tsx scripts/show-availability.ts` | Print a week's real capacity per person |

## Screens

| Route | Who | What |
| --- | --- | --- |
| `/my-day` | everyone | Today in order, timer, pause-with-reason, meeting mode, drag to reorder |
| `/plan` | everyone | Next week as task × day; take work, set quantities |
| `/my-calendar` | everyone | Your week, and absence requests |
| `/me` | everyone | Tenure, hours, estimate accuracy, P1N count, language |
| `/p1n` | everyone | Report and read mistakes and their fixes |
| `/meetings` | everyone | Meeting list, live notes, reports |
| `/team` | manager+ | The department's week |
| `/triage` | manager+ | Orphaned work, stalled tasks, unassignable work |
| `/catalogue` | manager+ | Task catalogue and schedules, any department |
| `/hr/people` | HR, admin | Accounts, hours, employment dates |
| `/hr/absences` | HR, admin | Approve or reject absence requests |

## Roles

`WORKER` → `MANAGER` → `ADMIN` is a rank; **`HR` sits alongside `MANAGER`, not
above it.** HR runs people operations across every department — creating
accounts, deciding absences — but does not run anyone else's schedule. Those
powers are explicit capability checks (`canManagePeople`, `canDecideAbsences`),
not rungs on the ladder.

Any manager can *view* every department's catalogue; only that department's
managers, or an admin, can change it.

## How the scheduling works

`src/lib/scheduling/` is split into pure logic and database access, so the
parts worth trusting can be tested without a database.

- **`availability.ts`** — `computeAvailability()` resolves WorkingPattern →
  DayOverride → Absence and returns *free windows*, not just a minute count.
  Everything else asks this rather than reading those tables, so there is
  exactly one answer to "can this person take work on Thursday".
- **`materialize.ts`** — expands recurring rules into dated instances, weekly
  by weekday or monthly by nth-weekday / day-of-month, keyed on
  rule + date + instance so regenerating never duplicates.
- **`assign.ts`** — filters to people with capacity, ranks by priority then
  rotation, packs tasks into free windows.
- **`run.ts`** — loads the data, calls the above, writes the results, and keeps
  joiners' induction interviews topped up.

### Properties worth preserving

All three were bugs first, and none is visible until the engine runs twice. If
you change `run.ts`, keep them:

1. **Rotation history is counted strictly *before* the window being
   scheduled.** Ranking must not read the ledger it also writes, or run two
   sees run one's output and chooses differently — the schedule then reshuffles
   under people every time the engine fires.
2. **`RotationLedger` is a cache, not a source of truth.** It is recomputed
   from the tasks by `refreshRotationLedger()`. Incrementing per run
   double-counts.
3. **Recurring rules are updated in place, never replaced.** Generated tasks are
   keyed on the rule's id, so deleting and recreating a rule gives every future
   task a new key and leaves the old ones behind — two of everything.

Re-running `npm run schedule` over the same window must produce byte-identical
assignments. That is the property to check after touching any of this.

## Deployment

A standard Next.js app plus a Postgres database.

- **Database**: any PostgreSQL 15+. Set `DATABASE_URL`. Run
  `npx prisma migrate deploy` on release.
- **Secrets**: set `SESSION_SECRET` to a real random value. Sessions are
  httpOnly cookies, `secure` in production.
- **Timezone**: `SCHEDULE_TIMEZONE` (default `Europe/Madrid`). Working hours are
  stored as minutes-from-midnight wall-clock, which keeps the arithmetic free
  of DST edge cases.
- **Scheduled jobs**: `npm run schedule` and `npm run ingest` are plain scripts.
  Run them from cron — nightly for scheduling, as often as the sheet changes
  for ingest. Both are safe to re-run.
- **Google Sheets**: create a service account, download its JSON key, set
  `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, and share the sheet with the service
  account's email. Read-only scope; no OAuth flow.

### Known issues

- `npm audit` reports vulnerabilities in `sharp`/libvips, pulled in
  transitively by Next.js for image optimization. This app serves no images.
  Re-check at upgrade time rather than pinning around it.
- **Prisma 7 refuses to generate migrations non-interactively** when it wants
  to warn about something. Several migrations here were produced with
  `prisma migrate diff`, applied with `psql`, and recorded with
  `prisma migrate resolve --applied`. They are normal migrations in the folder.
- **The seeded password is in git history.** Change it before this reaches a
  real machine.

## Translation

`src/lib/i18n/`. Server components use `getT()`; client components use the
`useT()` hook fed by a provider in the app shell. **Getting that the wrong way
round builds fine and fails only at render** — check which side a component is
on before adding either.

Only the interface is translated. Task names, catalogue warnings, meeting notes
and pause reasons stay exactly as typed. The English dictionary is the type, so
a missing Spanish key is a compile error rather than a blank label.

## Data protection

If the team is in Spain, daily working-time records are legally required
(RD 8/2019) and must be retained four years. Pause reasons, absence categories
and P1N reports are personal data under GDPR.

Consequently: absence categories are coarse (`SICK`, `HOLIDAY`, `PERSONAL`,
`OTHER`) with an optional note — deliberately not a medical detail field. Time
entries and pause events should not be hard-deleted. Tell people what is
recorded and why; a timer that doubles as surveillance destroys the data
quality the whole system depends on.

## Still to build

- **Schedules for ADE, ATIC and MYD.** Their catalogues are loaded with
  durations, priorities and per-go flags, but they have no recurring rules, so
  those departments generate no daily work. Build them in `/catalogue`, or
  export their calendars and extend `fixtures/recurring-hr.json`.
- **Estimate-vs-actual reporting for managers.** Individuals see their own
  drift on `/me`; nothing surfaces it per task across a department, which is
  what would let the catalogue durations get better.
- **Notifications.** Nothing tells a manager that work landed in triage, or HR
  that a request is waiting, beyond a badge they have to look at.
- **Dark mode verification.** The tokens exist and the app is usable dark, but
  it has not been checked screen by screen.

## Decisions on record

Recorded so they are not silently reversed:

- **Fair rotation, with capacity as a hard limit.** Rotation alone would hand
  somebody six hours of work on a three-hour day.
- **No idle-flagging.** The brief originally said "make sure everyone is always
  doing something". Instead of a dashboard of who has no timer running, the
  system asks *why* a task stopped. Same data, points at the cause rather than
  the person.
- **Absences never rehome work automatically.** They take effect immediately so
  the schedule is honest, but a human decides what happens to the displaced
  tasks.
- **Sickness does not wait for approval; leave does.** Somebody phoning in at
  07:00 is not at work whether or not HR has looked at it.
- **The day runs in order, and overriding costs an explanation.** Not to trap
  people — they can always go on — but so a schedule that keeps slipping is
  answerable.
- **Meeting drafts create nothing.** Action items become tasks only on
  finalisation, so an abandoned meeting leaves no phantom work.
- **P1N causes are split into "the person" and "the process".** They need
  opposite fixes, and the second is worth more.
