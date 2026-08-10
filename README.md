# MBE ERP

Internal ERP that turns recurring work, a task catalogue, a job spreadsheet and
the weekly meeting into a scheduled day for each person — and tracks the time
they actually spend on it.

Interface in Spanish or English, chosen per person; light or dark, per device.

> ### ⚠️ Putting this live? Do not start from this file.
>
> Read **[CUTOVER.md](CUTOVER.md)** first — its opening section is a list of
> blockers. Replacing the ERP already in use is **a data migration, not a
> deployment**: there is a live database of real working hours, the import that
> moves them is not written yet, and nothing here has ever run in production.
>
> This README explains how the system works. It is not a deployment guide, and
> following it alone will lose data.

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
  around lunch, never past somebody's finishing time. A set clock time outranks
  a point in the shift, so a 09:00 job keeps 09:00 and the "on arrival" work
  stacks behind it; and a task belongs to its half of the day, so "before the
  break" is never placed after it. A catalogue entry can also just say morning
  or afternoon without naming an hour.
- **Tracks time, and why it stops.** One timer per person. The day runs in
  order. Pausing requires a category *and* a written reason; skipping ahead
  requires saying what stopped you and when you will do it instead.
- **Splits work too long for one sitting.** A ten-hour job cannot fit any free
  window, so it becomes a parent holding sittings laid across the days up to its
  deadline. Each sitting is an ordinary task; the job shows as one row on the
  plan board with "2/4" on the days it is worked. Finishing early stands the
  rest down and gives those days back.
- **Lets people say they cannot do something.** Write what happened — the person
  you were meeting is not in, the job is waiting on somebody outside — then
  choose: move it, hand it back, set it aside, or ask for it to be cancelled.
  Set-aside work stops holding up the rest of the day. The manager sees the
  reason and the choice in triage.
- **Reacts to absences without guessing.** Reporting an absence takes effect
  immediately for sickness and flags the work it displaces. Nothing is
  reassigned automatically; a manager decides each one, with the viable options
  already worked out for them.
- **Runs the weekly meeting.** Notes and decisions are captured while it
  happens; the report writes itself and the actions become real tasks.
- **Records mistakes as P1Ns.** "Pasa 1 vez, no vuelve a pasar" — what went
  wrong, why, and the fix that would stop it recurring.
- **Records attendance.** Login, first task, last task and logout are kept
  separately and resolved into an arrival and a departure. The day ends with a
  deliberate *Cerrar el día*; a day nobody closes is inferred conservatively
  and flagged for confirmation rather than assumed. Lunch is clocked the same
  way, against the break on the timetable, so leaving at 12:41 for a one
  o'clock lunch is something the record can show. Operational record, not a
  legal *registro de jornada* — see MERGE.md.
- **Runs two CRMs for HR.** Universities and job portals with their contacts,
  and candidates through selection. The system works out who is owed a call and
  raises one batched call task holding the list, rather than a task per person.
  Each university has its own page holding every call ever made to anybody
  inside it, not just the last one.
- **Lets people message each other.** For the things a task status cannot say —
  "I'm giving you Tuesday because I'll be at the fair". An inbox, an unread
  badge that keeps itself fresh, and an optional note when handing work over.
- **Keeps the current task in front of you.** A bar fixed to the bottom of
  every page: what is running, whether the day is still reachable, and the
  controls to pause, finish, start the next one or close the day.
- **Keeps work that goes hand in hand together.** A catalogue entry can say it
  comes after another. Plan the first and the second arrives with it, slotted
  immediately after, given to the same person, and refused until the first is
  done. Defer one and both move; drop one and both go.
- **Fills free time with the right work.** When a gap opens — you finished
  early, a meeting fell through — you are offered one task that actually fits
  it, chosen debt-first: work owed today, then work an absence dropped, then
  pulling something forward from later in the week, and only then spare-time
  filler. Overdue outranks important, so nothing rots quietly. It is an offer,
  never an assignment: nothing is written until you accept.

## Running it locally

Requires Node 22+ and PostgreSQL 17.

```bash
cp .env.example .env      # defaults work for local development
npm install
npm run db:start          # creates and starts a local Postgres cluster
npx prisma migrate deploy   # several migrations are hand-written; see MERGE.md
npm run seed              # departments + founding accounts
npm run import:catalogue  # 134 tasks from fixtures/catalogue.json
npm run import:recurring  # HR's schedule from fixtures/recurring-hr.json
npm run schedule          # materialize and assign the next two weeks
npm run dev               # http://localhost:3000
```

Sign in as `santi`. The seed prints the password once at the end of its run —
it is generated randomly unless you set `SEED_PASSWORD`, so that no usable
credential lives in this repository. An existing database keeps whatever
password it already had.

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
| `npm test` | 393 unit tests |
| `npm run schedule [YYYY-MM-DD]` | Materialize + assign a two-week window. Safe to re-run |
| `npm run ingest [-- --csv path]` | Pull sheet sources into tasks |
| `npm run import:catalogue` | Load `fixtures/catalogue.json` |
| `npm run import:recurring [file]` | Load a department's schedule |
| `npm run seed` / `seed:demo` | Real founding data / throwaway sample data |
| `npm run db:start` / `db:stop` / `db:status` | Local Postgres cluster |
| `npm run db:studio` | Prisma Studio, to inspect data |
| `npm run verify:attendance` | End-to-end: abandoned timers, the sweep, the caps |
| `npm run verify:crm` | End-to-end: call generation and contact rotation |
| `npm run verify:anchors` | End-to-end: shift-anchored repetitions |
| `npm run verify:concurrency` | Two concurrent starts, against the real DB guards |
| `npm run verify:gaps` | End-to-end: the four gap-filler pools and their race guards |
| `npm run verify:follow` | End-to-end: work that goes hand in hand, and its cascades |
| `npm run verify:sessions` | End-to-end: long work split into sittings, and re-run idempotence |
| `npx tsx scripts/show-availability.ts` | Print a week's real capacity per person |

## Screens

| Route | Who | What |
| --- | --- | --- |
| `/my-day` | everyone | Today in order, timer, pause-with-reason, meeting mode, drag to reorder, file a P1N, fill free time |
| `/plan` | everyone | Next week as task × day; take work, set quantities |
| `/my-calendar` | everyone | Your week, and absence requests |
| `/me` | everyone | Tenure, hours, estimate accuracy, P1N count, language |
| `/p1n` | everyone | Report and read mistakes and their fixes |
| `/meetings` | everyone | Meeting list, live notes, reports |
| `/messages` | everyone | Write to a colleague; unread badge in the nav |
| `/team` | manager+ | The department's week, and lunches off the timetable |
| `/triage` | manager+ | People stuck, orphaned work, stalled tasks, why the week slipped, unplaceable work |
| `/catalogue` | manager+ | Task catalogue, schedules and what follows what, any department |
| `/hr/people` | HR, admin | Accounts, hours, employment dates |
| `/hr/absences` | HR, admin | Approve or reject absence requests |
| `/crm/sources` | HR, admin | Universities and portals, their contacts, call logging |
| `/crm/candidates` | HR, admin | The selection pipeline |

## Roles

`WORKER` → `MANAGER` → `ADMIN` is a rank; **`HR` sits alongside `MANAGER`, not
above it.** HR runs people operations across every department — creating
accounts, deciding absences — but does not run anyone else's schedule. Those
powers are explicit capability checks (`canManagePeople`, `canDecideAbsences`),
not rungs on the ladder.

Any manager can *view* every department's catalogue; only that department's
managers, or an admin, can change it.

## How it works, step by step

The system answers one question all the way through: *what should this person
be doing right now, and did it happen?* Each step feeds the next.

**1 · Who works when.** `WorkingPattern` holds one row per person per weekday;
`DayOverride` replaces a single day; `Absence` subtracts from whatever those
produced. `computeAvailability()` resolves the three in that order and returns
**free windows**, not a minute total. Everything else asks this function rather
than reading the tables, so there is exactly one answer to "can this person take
work on Thursday". Times are minutes from midnight in `SCHEDULE_TIMEZONE`, which
is what keeps the scheduler free of DST arithmetic.

**2 · What work exists.** `TaskTemplate` is the catalogue — name, estimate,
priority, warnings shown while doing it. `RecurringRule` says when a template
happens: weekly by weekday, monthly by nth-weekday or day-of-month, or at
**shift anchors** (on arrival, before the break, after the break, before
leaving) for jobs done several times a day at points in the shift.

**3 · Rules become dated tasks.** `materialize.ts` expands them over a window.
Every generated task carries an `externalKey` of rule + date + instance, so
running it twice creates nothing the second time — which matters because it runs
nightly *and* by hand. Three other things create tasks: the Google Sheet ingest,
meeting action items on finalisation, and a joiner's induction interviews.

**4 · Tasks are handed out.** `assign.ts`. Capacity is a hard constraint, fair
rotation the ranking rule within it. `MUST` work is the exception — assigned
even when everyone is full, so the overload is visible rather than the task
vanishing. Anchored repetitions go to one person as a group, and credit the
rotation once rather than four times.

**5 · The working day.** `/my-day` shows **one task**: the one running, or the
earliest still owed — deliberately the same one the ordering rule would let you
start. The rest is folded behind a "quedan 7 · 4h 20m" line that still holds
drag-to-reorder. One timer per person, enforced by a database index rather than
only by code. A bar fixed to the bottom of *every* page carries what is running,
whether the day is still reachable, and the controls to pause, finish, start the
next or close the day.

**6 · Attendance.** `AttendanceDay` keeps four signals apart — first login,
first task, last task, logout — and derives the in/out pair from them, so the
record can say "arrived 08:00, started work 09:40". The day ends with a
deliberate *Cerrar el día* that offers to reschedule what is left; a day nobody
closes is inferred at `min(last activity, end of shift)` and flagged for
confirmation rather than assumed.

Lunch is clocked the same way. `WorkingPattern` has always said when the break
*should* be, and `computeAvailability()` duly carved it out of capacity, but
nobody clocked it — so there was no way to see somebody leaving at 12:41 for a
one o'clock lunch. `breakStartedAt`/`breakEndedAt` record what actually
happened, `breakDrift()` compares it to the timetable, and `/team` lists the
ones that did not match. Going to lunch pauses whatever is running, with a
fixed reason: the pause dialog exists to catch *unplanned* stoppages, and being
made to justify lunch would be an odd thing for the app to do.

A day where nobody clocked lunch is read as lunch taken exactly to the
timetable. Nothing is flagged, and it comes off the total either way, so
everybody's hours stay honest and only recorded deviations show up.

> **This changed a number people had already seen.** `presentMinutes()` used to
> return the whole span with lunch included, so a nine-to-six day with an hour
> for lunch reported nine hours present. It now takes lunch off — clocked when
> there is one, rostered otherwise — so the same day reads eight.

**7 · When things go wrong.** Sickness takes effect immediately, leave waits for
HR. Displaced work becomes `ORPHANED` and goes to `/triage` with the colleagues
who genuinely have room already worked out — **nothing is reassigned
automatically**. Mistakes are recorded as P1Ns, with the cause split into "the
person" and "the process" because they need opposite fixes.

**8 · Meetings.** Notes captured live, the report writes itself. A draft creates
nothing; action items become tasks only on finalisation, so an abandoned meeting
leaves no phantom work.

**9 · The CRM.** Universities and portals get a call every two months, rotating
through their contacts. Candidates in the *Call* stage get one attempt. Calls
become **one batched task** holding the list of who to ring, resolved live when
the panel renders — who is due next Tuesday is not knowable today.

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

### Where in the day work goes

`src/lib/scheduling/half.ts` owns "which part of the day is this allowed in".
Three kinds of constraint, in decreasing strength:

1. **A clock time** — `RecurringRule.fixedStartMinutes`. Placed first, so a 09:00
   job keeps 09:00. This used to lose: anchors sorted on `ANCHOR_ORDER * 1e4` to push
   them past any minute-of-day, but `ARRIVAL` is `0`, so every "al llegar" task sorted
   ahead of 540 and took the morning.
2. **An anchor** — a point in *that person's* shift. It is both a starting point and a
   **bound**: `findSlot` walks on into later windows when the one it starts in is
   full, which is how "antes del descanso" resolved to 13:30, found the morning taken
   and landed at 16:30. `anchorFallbackWindows()` keeps it in its own half; if that
   half is full it goes unplaced and the day reads as over, which is honest.
3. **A shift preference** — `TaskTemplate.shiftHalf`, morning or afternoon with no
   hour named. Splits at `SHIFT_SPLIT_MINUTES` (14:00) for everybody, because a
   manager ticking "morning" is saying something about the business, not about
   whoever picks the task up. An anchor overrides it, being more specific.

The anchor bound and the preference use different definitions of "half" on purpose —
the anchor follows the person's own break, the preference follows the company clock.
They coincide here, since every working pattern breaks at 840.

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

## Work that goes hand in hand

`TaskTemplate.followsId` says "this entry comes after that one". The link lives on
the **follower**, so one leader can have several — reviewing the portals may produce
both a report and a Gantt update. At runtime `Task.followsTaskId` records the same
thing for one day's instances.

- **`src/lib/plan/follow.ts`** (pure) — walking the tree. `chainFrom()` returns what
  hangs off a leader in the order it has to happen, depth-first, so `a → (b → c), d`
  reads a, b, c, d rather than a, b, d, c. `wouldCycle()` and `depthOf()` are what the
  catalogue checks a new link against.
- **`src/lib/plan/follow-db.ts`** — `createFollowers()` raises the chain and places
  each one after the last. Keyed on the leader's `externalKey`, so re-running the
  scheduler finds them rather than making more. `followersOf()` is what the cascades
  ask.

Called from the two places a template becomes a task: the plan board
(`toggleTaskDay`) and the engine (`runSchedule`, before assignment, so the followers'
minutes count against the day rather than turning up on one already full).

Three rules hold the pair together, and each was a separate assumption that tasks are
independent:

1. **`blockingTask()`** checks the link directly, not just the clock. The follower
   usually sorts later anyway — but not once either end loses its slot, and unplaced
   work blocks nothing.
2. **`reorderDay()`** refuses an order that puts a follower above its leader, rather
   than silently re-sorting, which would make the drag look broken.
3. **`isOfferable()`** keeps a follower out of the gap-filler while its leader is
   unfinished. It is not free work; it is the second half of something.

The engine treats the chain as a group, reusing the `groupKey` machinery the anchored
shift routines already use — that is what guarantees one person gets both. What is new
is that `placeAll()` gives a follower `notBefore` = its leader's end, because plain
first-fit would happily drop the report into a gap earlier than the review it reports
on. `MAX_CHAIN` is 5: longer than that is a process, and the catalogue is the wrong
place to model one.

`npm run verify:follow` proves the whole path against a real database.

## Long work, split into sittings

A ten-hour job cannot be placed. `findSlot()` wants one contiguous free window
and nobody has one that long, so the task lands `UNASSIGNED` with the reason
thrown away. At ATIC, where the work is project-shaped rather than
routine-shaped, that is the normal case rather than the exception.

Teaching the placer to fragment a task would mean every reader of
`scheduledStart`/`scheduledEnd` learning that a task might have several slots —
My Day, the now-bar, pace, `/team`, `reorderDay`, the gap-filler. So a long task
becomes a **parent** (`status = SPLIT`) holding a run of ordinary child tasks,
one per sitting. Each child is a normal placeable `Task`, which is what lets
pause, defer, orphan, reorder, `blockingTask()` and the gap-filler keep working
with no change at all.

**The load-bearing invariant: a parent never has `scheduledDate`,
`scheduledStart` or `scheduledEnd`.** Every day-scoped query in the app filters
on `scheduledDate`, so that one fact keeps the parent out of all of them without
any of them being touched, and it is why nothing double-counts.
`verify:sessions` asserts no `SPLIT` row anywhere holds a slot.

- **`src/lib/plan/sessions.ts`** (pure) — `planSessions()` cuts an estimate into
  even lengths (600 → `4 × 150`, never `3 × 180 + 60`; a stub at the end is a
  twenty-minute hole somebody's Friday has to be built around). The remainder is
  handed out a minute at a time so the parts always add back up to the estimate.
  `planRepeatableSessions()` splits by *goes* instead, because half a phone call
  is not a unit of work. `spreadSessions()` walks a monotone forward cursor over
  `(day, minute)` — sitting 3 can never land before sitting 2, or the day reads
  backwards and `blockingTask()` refuses to start any of it.
- **`src/lib/plan/sessions-db.ts`** — `ensureSessions()` (idempotent, called
  wherever a task acquires an owner), `respreadSessions()`, `finishSplitJob()`.

Chunk size lives on `TaskTemplate.sessionMinutes`, not on whoever picks the job
up: sizing a sitting from one person's free windows would make run two split
differently from run one, which is exactly the reshuffling "Properties worth
preserving" exists to forbid. Default 180 minutes.

**Never split**: CRM call batches (they resolve their list off the task id and
are recreated nightly), meetings, and anything with an `anchor` or a fixed
start — work owed to a clock has no business being spread, so sittings inherit
neither the anchor nor the shift half.

To the engine a sitting is *in flight*, like a paused task: its minutes go to
`committedMinutes` and its slot to `busy`, so `assignDay` schedules around it
rather than through it. That is what makes a re-run leave a split job
byte-identical.

Finishing early is an explicit action — "that is the whole job" — because three
sittings instead of four is the ordinary case, and leaving the fourth on Friday
would hold time that is actually free.

`npm run verify:sessions` proves the whole path, including idempotence.

## "I cannot do this one"

The meeting you turned up for and the other person was not in. Until now the
only honest exits were finish, pause-with-reason, or defer-with-reason, and
two things were wrong with that.

The reasons went nowhere: `TaskDeferral.reason` had been written on every
deferral since the feature shipped and read by nothing at all. And a task you
cannot do stops the day, because `blockingTask()` will not let you start
anything below it.

So `reportBlocked()` takes an account of what happened and the person's own
choice of what should become of it — move it, hand it back, set it aside, or
ask for it to be cancelled — and writes a `TaskBlock`. The choice is theirs
deliberately: they know whether the person they were meant to meet is back
tomorrow or gone for a fortnight, and waiting for an answer would leave the rest
of the day stalled. Cancelling outright is the one thing not on offer.

`TaskStatus.SET_ASIDE` is the new status: still owed, still theirs, still on
today, but absent from `OUTSTANDING` so it stops holding up everything after it.

`/triage` gained three sections above the old ones: what people are stuck on,
recent slips (finally reading those deferral reasons), and a real list of work
nobody had room for — `assignDay` works out a reason for every task it cannot
place and `run.ts` used to discard it, so that section was a bare count. It is
now persisted to `Task.unplacedReason`, and tells `needs-splitting` apart from
a merely fragmented day.

## Messages

The first thing here that is a notification rather than a record, and
deliberately small: no threads, no groups, no attachments. What was missing was
the ability to say *why* — "I'm giving you Tuesday because I'll be at the fair" —
and that is one sentence to one person.

One `Message` row per message, and no threads table: a conversation is every
message between two people in either direction, ordered by time. That keeps the
unread badge, which runs on every page load, a single indexed count.

The badge is server-rendered in the `(app)` layout like the pending-absence one,
and also polled every 30 seconds by `MessageBadge` through the read-only
`unreadCount()` server action — the same idiom `offerFillers()` already uses,
rather than introducing this codebase's first route handler for a number. The
poll only runs while the tab is visible; a dozen idle tabs overnight would
otherwise be a dozen requests a minute, all night, for nothing.

Reassigning from triage carries an optional note, sent on as a message against
the task.

## Filling free time

The engine packs the day up front and then the day is frozen; reality is not. A
task finishes early, a meeting is cancelled, an absence leaves a hole.
`src/lib/gaps/` turns that hole into a concrete offer.

- **`gap.ts`** (pure) — is there a gap, and what shape is it? Being behind
  schedule is not free time and neither is lunch, so both give `null` rather
  than inviting somebody to work through them. Free stretches are returned as
  *segments*: forty minutes split by lunch is fifteen and twenty-five, and a
  thirty-five minute job fits neither. Finished work only holds the time it
  actually took, which is what makes finishing early produce a gap at all.
- **`eligible.ts`** (pure) — is this work even free to move? Two kinds are not:

  - **Owed to an hour** — a `Task.anchor`, a rule's `fixedStartMinutes`, or a
    meeting. Never offered, in any tier. You cannot honour "on arrival" or
    "09:00" in a random gap, and a meeting is not yours alone to move.
  - **Owed to a rhythm** — `RECURRING` (which includes onboarding interviews)
    and the daily `CRM` call batch. Offered *only on the day it is due*: never
    dragged forward, never caught up afterwards. A two-monthly interview means
    every two months; doing March's in July is not catching up, it is doing the
    wrong thing.

  Orphans are exempt from the rhythm rule and only from that one — an absence
  means the occurrence is lost unless somebody takes it, which is the point of
  triage, and is a different thing from pulling a cadence forward.
- **`score.ts`** (pure) — which task to offer. Two rules stacked, and the order
  matters more than either:

  1. **The tier is a hard sort key.** Owed today → orphaned → pull forward from
     later this week → spare-time filler. A `NORMAL` in tier 1 beats a `MUST` in
     tier 3 on purpose: clear today's debt before borrowing from tomorrow, and
     never offer filler while real work sits unplaced.
  2. **Inside a tier, a score** of priority + urgency + fit. The urgency term is
     why this exists — `MUST`/`NORMAL`/`SPARE_TIME` is the right vocabulary for
     the nightly engine, which places work on the day it is due, but it cannot
     say "late", and a `NORMAL` due yesterday really should beat a `MUST` due
     next week.
- **`offer-db.ts`** — the four pool queries, bounded by the gap so nothing
  longer than the time available is ever read, and by the eligibility rules
  above. Called when the dialog opens, never from `getNowState()`, which runs
  on every page.
- **`pickOffers()`** in `score.ts` — every non-empty tier gets one slot before
  rank fills the rest. Without it a department with a dozen things owed today
  fills every slot from tier 1 and the work sitting in triage is never seen,
  which is exactly how a queue of stale interviews hid a fortnight of dropped
  work.
- **`actions.ts`** — `takeFiller()`. Nothing is written until somebody accepts,
  and the gap is recomputed then, because the offer was worked out when the
  dialog opened and a colleague may have taken it since.

Two things worth knowing before changing it:

- **Every path writes through a guard only one of two racing people can pass** —
  a conditional `updateMany` whose `count === 0` means somebody got there first,
  or, for catalogue work, the partial unique index via `claimTemplate()`.
- **An orphan taken this way still writes a `TriageAction`.** It is the only way
  one leaves `/triage` without a manager seeing it first, and the queue is how
  they know work was dropped — so it must also be how they know it came back.

The bar shows a gap as a button, never a popup: a modal every time somebody has
twenty spare minutes would train them to dismiss it. The one exception is
finishing the last task on the list, where the dialog opens by itself — there is
no next task to offer, and it is the one moment somebody is actually looking for
what to do.

`npm run verify:gaps` proves the pools and the race guards against a real
database; the ranking rules are unit-tested.

## Deployment

A standard Next.js app plus a Postgres database.

- **Database**: any PostgreSQL 15+. Set `DATABASE_URL`. Run
  `npx prisma migrate deploy` on release.
- **Secrets**: none required. The session cookie carries a random token and the
  database stores only its SHA-256; there is nothing to sign. Cookies are
  httpOnly, `secure` in production. `SESSION_SECRET` is still in
  `.env.example` but no code reads it.
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
- **A hard-coded seed password is in git history**, up to commit `1627779`. It
  was never deployed and the seed now generates one instead, but it must not
  come back.

## Translation

`src/lib/i18n/`. Server components use `getT()`; client components use the
`useT()` hook fed by a provider in the app shell. **Getting that the wrong way
round builds fine and fails only at render** — check which side a component is
on before adding either.

The login page has no account to read a preference from, so `getLoginT()`
defaults it to Spanish and switches to English only when the browser asks for
English ahead of Spanish. Its strings are passed into the form as props —
there is no i18n provider before sign-in.

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
- **Notifications outside the app.** The bell now folds triage's alerts into one
  ordered list, so work landing in triage does raise something. Nothing leaves
  the app, though — no email and no push, so anyone not signed in that day
  hears nothing.
- **Mobile.** The one real blocker is the missing viewport meta tag in
  `src/app/layout.tsx`; after that, touch targets and turning the sidebar into
  a drawer.
- **Manager and HR views of attendance.** `/team` now lists lunches that did not
  match the timetable, but the full record is still personal-only.
- **Growing a split job.** `setTaskQuantity` refuses on a parent. Making a long
  job longer should add a sitting; for now it is deferred or added separately.

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
