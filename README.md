# task-erp

Internal ERP for work: assigns tasks automatically by department, tracks time
per task, and handles pauses.

Status: **not started.** This repo currently holds the brief and the open
questions, nothing else. Stack is deliberately undecided until the questions
below are answered.

## The brief (as described 2026-07-27)

- Tasks are assigned automatically, based on the assignee's department.
- Time spent on each task is tracked.
- Users can pause a task (breaks, blockers, interruptions) and resume it.
- Original framing included "make sure everyone is always doing something" —
  see [Open question 6](#open-questions) before this becomes a requirement.

## Open questions

These block the first design pass. Roughly in order of how much they change
the build:

1. **Scale.** How many people, how many departments? 15 people and 300 people
   are different architectures.
2. **Assignment inputs.** What does auto-assignment key off — an incoming queue
   of work, a project plan, recurring schedules? And what makes one person the
   right assignee: availability, skill, round-robin, current load?
3. **Hosting and ops.** Internal network or hosted? Is there someone to
   maintain it, or does it need to be near-zero-ops?
4. **Integrations.** Projects currently live in Notion. Does this replace that,
   sync with it, or ignore it?
5. **Jurisdiction.** Where are the users based? Time tracking that doubles as
   activity monitoring has disclosure/consent obligations under GDPR in the EU
   and various US state laws.
6. **Utilization enforcement — decide deliberately.** "Always doing something"
   means the system flags idle people. Concerns: idle time is often the
   system's fault (blocked, waiting on a client, empty queue), not the
   person's; and once a timer becomes an idleness detector, people pad
   estimates and stop reporting real blockers, which destroys the data quality
   the ERP depends on. The same schema supports a better framing — surface
   *why work is stalled* rather than *who is idle*. Santi's call either way;
   this note exists so it's a decision and not a default.

## Not a starting point

The tools looked at in the session where this came up (`fetcher-mcp`,
`youtube-transcript-api`) are content-fetching utilities and have nothing to do
with this. Noted here so the idea doesn't get retried.
