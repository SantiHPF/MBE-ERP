# task-erp

Internal ERP that turns recurring work, a task catalogue, a job spreadsheet and
the weekly meeting into a scheduled day for each person — and tracks the time
they actually spend on it.

## What it does

- **Materializes work.** Recurring rules ("stock count every Monday and
  Thursday") become dated task instances. A Google Sheet of client jobs is
  polled into tasks. Weekly meeting action items become tasks when the meeting
  is finalised.
- **Assigns it automatically.** Capacity is a hard constraint and fair rotation
  is the ranking rule within it: a task only goes to somebody with room for it
  that day, and among those it goes to whoever has had that job least, and
  least recently.
- **Fits it to real hours.** Everyone's working pattern differs by weekday.
  Tasks are placed in actual free windows, around lunch, and never past
  somebody's finishing time.
- **Tracks time, and why it stops.** One timer per person. Pausing requires a
  category *and* a written reason — the system surfaces why work stalled rather
  than who was idle.
- **Reacts to absences without guessing.** Marking yourself away takes effect
  immediately and flags the work it displaces. Nothing is reassigned
  automatically; a manager decides each one, with the viable options already
  worked out for them.

## Running it locally

Requires Node 22+ and PostgreSQL 17.

```bash
cp .env.example .env      # defaults work for local development
npm install
npm run db:start          # creates and starts a local Postgres cluster
npx prisma migrate dev
npm run seed
npm run schedule          # materialize and assign the next two weeks
npm run dev               # http://localhost:3000
```

Sign in as `santi` / `password` (admin). Every seeded account uses `password`:
`marta` and `carmen` are managers, `luis`, `ana`, `pau`, `diego` and `elena`
are workers.

To see the sheet ingest without Google credentials:

```bash
npx tsx scripts/demo-sheet-source.ts
npm run ingest -- --csv fixtures/example-job-sheet.csv
```

### About the local database

There is no Docker on the machine this was built on, and the system-wide
Postgres 17 install needs `sudo` to start. So `npm run db:start` creates a
cluster **owned by the current user** in `.pgdata` (gitignored), listening on
port **5433** so it never collides with a system Postgres on 5432.

This is a development convenience only — see Deployment. If your Postgres
binaries are somewhere other than `/Library/PostgreSQL/17/bin`, set `PGBIN`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | 81 unit tests (scheduling, availability, time tracking, sheet parsing) |
| `npm run schedule [YYYY-MM-DD]` | Materialize + assign a two-week window. Safe to re-run |
| `npm run ingest [-- --csv path]` | Pull sheet sources into tasks |
| `npm run seed` | Wipe and rebuild demo data |
| `npm run db:start` / `db:stop` / `db:status` | Local Postgres cluster |
| `npm run db:studio` | Prisma Studio, to inspect data |
| `npx tsx scripts/show-availability.ts` | Print a week's real capacity per person |

## How the scheduling works

`src/lib/scheduling/` is deliberately split into pure logic and database access,
so the parts worth trusting can be tested without a database.

- **`availability.ts`** — `computeAvailability()` resolves WorkingPattern →
  DayOverride → Absence and returns *free windows*, not just a minute count.
  Everything else in the system asks this rather than reading those tables, so
  there is exactly one answer to "can this person take work on Thursday".
- **`materialize.ts`** — expands recurring rules into dated instances, keyed on
  rule + date + instance so regenerating never duplicates.
- **`assign.ts`** — filters to people with capacity, ranks by rotation, packs
  tasks into free windows. Fixed-window tasks first, then longest-first, since
  big jobs are hardest to fit.
- **`run.ts`** — loads the data, calls the above, writes the results.

### Two properties worth preserving

Both were bugs first, found by running the engine against real data rather than
only tests. If you change `run.ts`, keep them:

1. **Rotation history is counted strictly *before* the window being
   scheduled.** Ranking must not read the ledger it also writes, or run two
   sees run one's output and chooses differently — the schedule then reshuffles
   under people every time the engine fires. Counting only prior work makes a
   run a pure function of history, so re-running is a no-op.
2. **`RotationLedger` is a cache, not a source of truth.** It is recomputed
   from the tasks by `refreshRotationLedger()`. Incrementing it per run
   double-counts and inflates the fairness counters.

Re-running `npm run schedule` over the same window must produce byte-identical
assignments. That is the property to check after touching any of this.

## Deployment

Nothing here is deployment-specific — it is a standard Next.js app plus a
Postgres database.

- **Database**: any PostgreSQL 15+. Set `DATABASE_URL`. Run
  `npx prisma migrate deploy` on release.
- **Secrets**: set `SESSION_SECRET` to a real random value. Sessions are
  httpOnly cookies, `secure` in production.
- **Timezone**: `SCHEDULE_TIMEZONE` (default `Europe/Madrid`). Working hours are
  stored as minutes-from-midnight wall-clock, which keeps the arithmetic free
  of DST edge cases.
- **Scheduled jobs**: `npm run schedule` and `npm run ingest` are plain scripts.
  Run them from cron — nightly for scheduling, and as often as the sheet
  changes for ingest. Both are safe to re-run.
- **Google Sheets**: create a service account, download its JSON key, set
  `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, and share the sheet with the service
  account's email address. Read-only scope; no OAuth flow needed.

### Known issue

`npm audit` reports vulnerabilities in `sharp`/libvips, pulled in transitively
by Next.js for image optimization. This app serves no images. It clears when
Next ships an updated `sharp` — worth re-checking at upgrade time rather than
pinning around it.

## Data protection

If the team is in Spain, daily working-time records are legally required
(RD 8/2019) and must be retained four years. Pause reasons and absence
categories are personal data under GDPR.

Consequently: absence categories are coarse (`SICK`, `HOLIDAY`, `PERSONAL`,
`OTHER`) with an optional free-text note — deliberately not a medical detail
field. Time entries and pause events should not be hard-deleted. Tell people
what is recorded and why; a timer that doubles as surveillance destroys the
data quality the whole system depends on.

## Still to build

- **Admin screens.** Departments, users, working patterns, day overrides, the
  task catalogue, recurring rules and sheet sources currently come from the
  seed script or Prisma Studio. The schema and server actions are all in place;
  this is CRUD over existing models.
- **Estimate-vs-actual reporting.** The data is captured (`TimeEntry` against
  `Task.estimatedMinutes`) but nothing surfaces the drift yet. This is what
  makes the catalogue durations get better over time.
- **Notifications.** Nothing tells a manager that a task landed in triage; they
  have to look.

## Decisions on record

Recorded so they are not silently reversed later:

- **Fair rotation, with capacity as a hard limit.** Rotation alone would hand
  somebody six hours of work on a three-hour day.
- **No idle-flagging.** The brief originally said "make sure everyone is always
  doing something". Instead of a dashboard of who has no timer running, the
  system asks *why* a task stopped. Same data, points at the cause rather than
  the person.
- **Absences never rehome work automatically.** They take effect immediately so
  the schedule is honest, but a human decides what happens to the displaced
  tasks.
- **Meeting drafts create nothing.** Action items become tasks only on
  finalisation, so an abandoned meeting leaves no phantom work.
