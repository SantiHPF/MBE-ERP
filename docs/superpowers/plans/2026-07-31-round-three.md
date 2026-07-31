# Round Three Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three confirmed defects in the auto-assign engine, add an in-app bug/suggestion report readable from the command line, and let a catalogue entry come after more than one other entry.

**Architecture:** Three independent slices of an existing Next.js 16 + Prisma 7 ERP. The assign fixes are surgical changes to a pure function (`assignDay`) plus its database caller (`runSchedule`). Reports are a new self-contained module (`src/lib/reports/`) plus a shell button, an admin page and a CLI script. Multi-predecessor replaces a `followsId` column with an explicit join table and generalises the pure chain arithmetic in `src/lib/plan/follow.ts` from a forest to a DAG.

**Tech Stack:** TypeScript, Next.js 16 (App Router, server actions), React 19, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Zod 4, Vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-07-31-round-three-design.md`

## Global Constraints

- **Never break the suite.** `npm test` runs 478 tests across 23 files and is green at the start of this plan. It must be green at the end of every task.
- **Tests are pure.** Vitest never touches the database. Anything needing Postgres is verified by a `scripts/verify-*.ts` script run by hand against a dev database (`npm run db:start` first).
- **Every user-facing string is translated.** Add the key to both the `en` and the `es` object in `src/lib/i18n/dictionary.ts`. Never hardcode English in a component.
- **Comments explain why, not what.** This codebase's comments justify decisions and name the bug that motivated them. Match that register. Do not write comments that restate the code.
- **`MAX_CHAIN = 5`** stays exactly 5 and keeps its existing meaning.
- **Report body limit is 4000 characters**, trimmed, non-empty.
- **Migrations are hand-named** `prisma/migrations/YYYYMMDDHHMMSS_snake_case_name/migration.sql`, matching the existing sequence (latest is `20260730190000_source_contact`).
- **Commit after every task.** Conventional-commit prefixes (`fix:`, `feat:`, `docs:`), and the existing style writes the subject in plain sentence case describing behaviour, not implementation.

---

# Part A — The three assign fixes

Landing first, per the spec's sequencing: Task 4 fixes how followers are *placed*, and Part C changes how they are *generated*.

---

### Task 1: A must-do task stops losing to a routine

**Files:**
- Modify: `src/lib/scheduling/assign.ts:423-478` (grouping and the group loop) and `:670` (the singles loop)
- Test: `src/lib/scheduling/assign.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no signature changes. `assignDay(input): AssignResult` is unchanged externally. Internally introduces a function declaration `assignSingle(task: TaskInput): void`.

**Background.** `assignDay` currently runs every grouped task to completion before it looks at a single one:

```ts
for (const members of groups.values()) {   // assign.ts:476
  assignGroup(orderChain(members));
}
// ... 190 lines later ...
for (const task of singles) {              // assign.ts:670
```

`orderTasks` sorts by priority *within* each bucket and never across them, so a SPARE_TIME routine takes the day before a MUST task is considered. That contradicts `TaskInput.priority`'s own doc comment ("MUST is placed first and never dropped") and the `Priority` enum's ("SPARE_TIME ... only appears once everything else has been placed").

- [ ] **Step 1: Write the failing test**

Append to `src/lib/scheduling/assign.test.ts`:

```ts
describe("priority across routines and single tasks", () => {
  it("gives a must-do task the day before a spare-time routine", () => {
    // One person, 09:00-11:00. The routine wants two hours; the must-do task
    // wants one. Backlog work must not be what fills the day.
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo", { end: at(11) })],
      tasks: [
        task("spare-a", {
          priority: "SPARE_TIME",
          templateId: "tpl-spare",
          groupKey: "routine",
        }),
        task("spare-b", {
          priority: "SPARE_TIME",
          templateId: "tpl-spare",
          groupKey: "routine",
        }),
        task("must", { priority: "MUST", templateId: "tpl-must" }),
      ],
    });

    const must = result.assignments.find((a) => a.taskId === "must");
    expect(must?.start).toBe(at(9));
    expect(must?.overCapacity).toBeUndefined();
  });

  it("gives a must-do task the day before a normal routine", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo", { end: at(11) })],
      tasks: [
        task("routine-a", { templateId: "tpl-routine", groupKey: "routine" }),
        task("routine-b", { templateId: "tpl-routine", groupKey: "routine" }),
        task("must", { priority: "MUST", templateId: "tpl-must" }),
      ],
    });

    const must = result.assignments.find((a) => a.taskId === "must");
    expect(must?.start).toBe(at(9));
  });

  it("still places a routine before a spare-time single", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo", { end: at(10) })],
      tasks: [
        task("spare", { priority: "SPARE_TIME", templateId: "tpl-spare" }),
        task("routine", { templateId: "tpl-routine", groupKey: "routine" }),
      ],
    });

    const routine = result.assignments.find((a) => a.taskId === "routine");
    expect(routine?.start).toBe(at(9));
  });
});
```

- [ ] **Step 2: Run the tests to verify the first two fail**

Run: `npx vitest run src/lib/scheduling/assign.test.ts -t "priority across routines"`
Expected: the first two FAIL — `must?.start` is `null` and `overCapacity` is `true`, because the routine took the day. The third PASSES already.

- [ ] **Step 3: Build one ordered list of units instead of two lists**

In `src/lib/scheduling/assign.ts`, replace the grouping block that currently reads:

```ts
  const groups = new Map<string, TaskInput[]>();
  const singles: TaskInput[] = [];
  for (const task of orderTasks(input.tasks)) {
    if (!task.groupKey) {
      singles.push(task);
      continue;
    }
    const list = groups.get(task.groupKey);
    if (list) list.push(task);
    else groups.set(task.groupKey, [task]);
  }
```

with:

```ts
  /**
   * One list, in the order things are actually placed.
   *
   * Routines used to be a separate list run to completion before any single
   * task was considered, which meant a *backlog* routine could take the whole
   * day and leave a must-do task with no slot -- the exact opposite of what
   * the priorities promise. A routine is now a unit of many and a single task
   * a unit of one, and both queue by the same rule.
   *
   * A unit takes its place from its highest-priority member, because
   * orderTasks() has already sorted and a group first appears here at its most
   * important task. The members array is shared with `groups`, so later
   * members join the unit already sitting in the right place.
   */
  const groups = new Map<string, TaskInput[]>();
  const units: { grouped: boolean; members: TaskInput[] }[] = [];
  for (const task of orderTasks(input.tasks)) {
    if (!task.groupKey) {
      units.push({ grouped: false, members: [task] });
      continue;
    }
    const list = groups.get(task.groupKey);
    if (list) {
      list.push(task);
      continue;
    }
    const members = [task];
    groups.set(task.groupKey, members);
    units.push({ grouped: true, members });
  }
```

- [ ] **Step 4: Delete the early group loop**

Remove these three lines (currently at `assign.ts:476-478`, immediately after the `orderChain` function declaration):

```ts
  for (const members of groups.values()) {
    assignGroup(orderChain(members));
  }
```

- [ ] **Step 5: Turn the singles loop into a function declaration**

Change the header of the singles loop from:

```ts
  for (const task of singles) {
    const place = (candidate: WorkingCandidate): Window | null => {
```

to:

```ts
  function assignSingle(task: TaskInput): void {
    const place = (candidate: WorkingCandidate): Window | null => {
```

Inside that body, every `continue;` is now a `return;` — there are five of them:
the pinned branch, the `no-one-in-department` branch, the two `forceOnSomebody()`
branches (`if (... && forceOnSomebody()) continue;`), and the `withCapacity.length === 0`
branch. The `break` inside the inner `for (const candidate of ranked)` loop stays a `break`.
The `continue` inside `for (const candidate of ranked)` (`if (!slot) continue;`) also stays.

- [ ] **Step 6: Run the units in order, after the definitions**

Immediately after the closing brace of `assignSingle`, and before `return { assignments, unassigned, collapsed };`, add:

```ts
  for (const unit of units) {
    if (unit.grouped) assignGroup(orderChain(unit.members));
    else assignSingle(unit.members[0]);
  }
```

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run src/lib/scheduling/assign.test.ts -t "priority across routines"`
Expected: PASS, all three.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: 478 + 3 = 481 tests pass, 23 files. This step is the real check — the ordering change touches every grouped assignment, and the existing 1415-line `assign.test.ts` is what proves it changed only what it should. If anything else fails, stop and read it: a genuine ordering expectation may need updating, but a fairness or placement failure means the refactor is wrong.

- [ ] **Step 9: Commit**

```bash
git add src/lib/scheduling/assign.ts src/lib/scheduling/assign.test.ts
git commit -m "fix: must-do work no longer loses the day to a routine"
```

---

### Task 2: A deadline is respected when no start time is set

**Files:**
- Modify: `src/lib/scheduling/assign.ts:349-354` (`placeFor`)
- Test: `src/lib/scheduling/assign.test.ts`

**Interfaces:**
- Consumes: `assignSingle` from Task 1 (no direct use; this task only edits `placeFor`).
- Produces: no signature changes.

**Background.** `placeFor` honours `fixedEndMinutes` only when there is a wanted start:

```ts
const from = wantedStart(task, candidate);
if (from == null) return findSlot(free, task.estimatedMinutes);  // limit dropped
const slot = findSlot(free, task.estimatedMinutes, from);
if (!slot) return null;
return slot.end <= limit ? slot : null;
```

A task that must merely *finish* by a time, with no opinion about when it starts, has its deadline silently discarded.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/scheduling/assign.test.ts`:

```ts
describe("a deadline with no start time", () => {
  it("refuses a slot that would finish after it", () => {
    // Finish by 10:00, but 09:00-10:30 is already taken. There is no honest
    // slot, so it must go to triage rather than land at 10:30 pretending.
    const result = assignDay({
      date: MON,
      candidates: [
        candidate("solo", { busy: [{ start: at(9), end: at(10, 30) }] }),
      ],
      tasks: [task("due-by-ten", { templateId: null, fixedEndMinutes: at(10) })],
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned).toEqual([
      { taskId: "due-by-ten", reason: "no-slot-fits" },
    ]);
  });

  it("takes a slot that finishes in time", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("solo")],
      tasks: [task("due-by-ten", { templateId: null, fixedEndMinutes: at(10) })],
    });

    expect(result.assignments[0].start).toBe(at(9));
    expect(result.assignments[0].end).toBe(at(10));
  });
});
```

- [ ] **Step 2: Run it to verify the first case fails**

Run: `npx vitest run src/lib/scheduling/assign.test.ts -t "a deadline with no start time"`
Expected: the first FAILS — the task is assigned at 10:30–11:30. The second PASSES.

- [ ] **Step 3: Check the limit on that branch too**

In `placeFor`, replace:

```ts
    const from = wantedStart(task, candidate);
    if (from == null) return findSlot(free, task.estimatedMinutes);
```

with:

```ts
    const from = wantedStart(task, candidate);
    if (from == null) {
      /**
       * A deadline binds even when nothing says where to start.
       *
       * The limit used to be checked only on the branch below, so a task that
       * merely had to be *finished* by ten was placed at half past and the
       * deadline was never mentioned again. findSlot returns the earliest
       * fitting slot, so if that one busts the deadline no later one can
       * save it -- null is the honest answer, and triage shows it.
       */
      const slot = findSlot(free, task.estimatedMinutes);
      return slot && slot.end <= limit ? slot : null;
    }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/scheduling/assign.test.ts -t "a deadline with no start time"`
Expected: PASS, both.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduling/assign.ts src/lib/scheduling/assign.test.ts
git commit -m "fix: a task due by a time no longer lands after it"
```

---

### Task 3: The engine can hold a task behind work it is not placing

**Files:**
- Modify: `src/lib/scheduling/assign.ts` — `TaskInput` (~line 87), `placeFor`, `fallbackFor`, `assignGroup`, `placeAll`
- Test: `src/lib/scheduling/assign.test.ts`

**Interfaces:**
- Consumes: `assignSingle` and the `units` loop from Task 1.
- Produces:
  - `TaskInput.notBeforeMinutes?: number | null` — a floor on the start, in minutes from midnight.
  - `assignGroup` honours `pinnedAssigneeId` on any member, fixing the whole unit to that person.
  - Task 4 sets both from `run.ts`.

**Background.** This is the pure half of the orphaned-follower fix. A follower whose leader is already `IN_PROGRESS` is currently placed by first-fit, so it can land before its leader and go to somebody else entirely. The engine has no way to say "this belongs to that person, and not before this minute" — that is what this task adds. Task 4 wires it up.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/scheduling/assign.test.ts`:

```ts
describe("work held behind a task this run is not placing", () => {
  it("keeps it with the pinned person and after the given minute", () => {
    // The leader is running 14:00-16:00 on someone else's calendar, so it is
    // not in this run at all. The follower must still be theirs, and after.
    const result = assignDay({
      date: MON,
      candidates: [
        candidate("leader-owner", { busy: [{ start: at(14), end: at(16) }] }),
        candidate("somebody-else"),
      ],
      tasks: [
        task("follower", {
          estimatedMinutes: 30,
          groupKey: "follows:leader",
          followsTaskId: "leader",
          pinnedAssigneeId: "leader-owner",
          notBeforeMinutes: at(16),
        }),
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].userId).toBe("leader-owner");
    expect(result.assignments[0].start).toBe(at(16));
  });

  it("holds a whole chain behind it, in order", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("leader-owner"), candidate("somebody-else")],
      tasks: [
        task("head", {
          estimatedMinutes: 30,
          groupKey: "follows:leader",
          followsTaskId: "leader",
          pinnedAssigneeId: "leader-owner",
          notBeforeMinutes: at(15),
        }),
        task("tail", {
          estimatedMinutes: 30,
          groupKey: "follows:leader",
          followsTaskId: "head",
        }),
      ],
    });

    const head = result.assignments.find((a) => a.taskId === "head");
    const tail = result.assignments.find((a) => a.taskId === "tail");
    expect(head?.start).toBe(at(15));
    expect(tail?.userId).toBe("leader-owner");
    expect(tail?.start).toBe(at(15, 30));
  });

  it("says so plainly when the pinned person is gone", () => {
    const result = assignDay({
      date: MON,
      candidates: [candidate("somebody-else")],
      tasks: [
        task("follower", {
          groupKey: "follows:leader",
          followsTaskId: "leader",
          pinnedAssigneeId: "leader-owner",
          notBeforeMinutes: at(16),
        }),
      ],
    });

    expect(result.unassigned).toEqual([
      { taskId: "follower", reason: "pinned-person-unavailable" },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/scheduling/assign.test.ts -t "work held behind a task"`
Expected: FAIL. TypeScript rejects `notBeforeMinutes` as an unknown property of `TaskInput`, and the pinned person is ignored by the group path.

- [ ] **Step 3: Add the field to TaskInput**

In `src/lib/scheduling/assign.ts`, immediately after the `followsTaskId` field in `TaskInput`, add:

```ts
  /**
   * The earliest minute this may start.
   *
   * Set when the thing it comes after is not in this run -- somebody is doing
   * it right now, so the engine will not move it, and it is therefore invisible
   * to the placement below. Without this floor the follower first-fits into the
   * morning and the pair reads backwards.
   */
  notBeforeMinutes?: number | null;
```

- [ ] **Step 4: Honour the floor when placing**

In `placeFor`, change the deadline branch added in Task 2 and the branch below it so both respect the floor. The whole tail of `placeFor` becomes:

```ts
    const floor = task.notBeforeMinutes ?? null;

    const from = wantedStart(task, candidate);
    const start = from == null ? floor : floor == null ? from : Math.max(from, floor);

    if (start == null) {
      const slot = findSlot(free, task.estimatedMinutes);
      return slot && slot.end <= limit ? slot : null;
    }

    const slot = findSlot(free, task.estimatedMinutes, start);
    if (!slot) return null;
    return slot.end <= limit ? slot : null;
```

And in the backward-packing branch above it, pass the floor to `findLastSlot`'s
fourth parameter (`notBefore`), replacing:

```ts
    if (task.anchor && anchorPacksBackward(task.anchor)) {
      const slot = findLastSlot(free, task.estimatedMinutes, limit);
      return slot;
    }
```

with:

```ts
    if (task.anchor && anchorPacksBackward(task.anchor)) {
      return findLastSlot(
        free,
        task.estimatedMinutes,
        limit,
        task.notBeforeMinutes ?? 0,
      );
    }
```

In `fallbackFor`, apply the same floor:

```ts
  const fallbackFor = (
    task: TaskInput,
    candidate: WorkingCandidate,
  ): Window | null => {
    const free = allowedFree(task, candidate);
    const floor = task.notBeforeMinutes ?? 0;
    // Same rule as placeFor: a deadline anchor searches from the end of its
    // half. Falling back forwards is what the bound was added to prevent.
    return task.anchor && anchorPacksBackward(task.anchor)
      ? findLastSlot(free, task.estimatedMinutes, Infinity, floor)
      : findSlot(free, task.estimatedMinutes, floor);
  };
```

- [ ] **Step 5: Carry the floor through a chain in placeAll**

In `placeAll`, replace:

```ts
      const after = task.followsTaskId ? endOf.get(task.followsTaskId) : undefined;
```

with:

```ts
      /**
       * Its leader's end when the leader is in this group, and otherwise the
       * floor the caller set for it -- which is the same fact, for a leader
       * this run is not placing.
       */
      const after =
        (task.followsTaskId ? endOf.get(task.followsTaskId) : undefined) ??
        task.notBeforeMinutes ??
        undefined;
```

- [ ] **Step 6: Honour a pinned person in assignGroup**

In `assignGroup`, immediately after the `inDepartment.length === 0` guard and
before `const ranked = ...`, add:

```ts
    /**
     * A member pinned to somebody fixes the whole unit to them.
     *
     * A chain whose leader is already being worked on is one person's job by
     * definition -- ranking it would hand the second half to whoever happened
     * to be free. Placed even when their day is full, for the same reason
     * must-do work is: a visible overload beats a pair torn in two.
     */
    const pinnedTo = members.find((m) => m.pinnedAssigneeId)?.pinnedAssigneeId;
    if (pinnedTo) {
      const target = inDepartment.find((c) => c.userId === pinnedTo);
      if (!target) {
        for (const m of members) {
          unassigned.push({ taskId: m.id, reason: "pinned-person-unavailable" });
        }
        return;
      }
      const needed = minutesFor(collapseFor(members, target).keep);
      placeGroup(members, target, target.remaining < needed);
      return;
    }
```

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run src/lib/scheduling/assign.test.ts -t "work held behind a task"`
Expected: PASS, all three.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/scheduling/assign.ts src/lib/scheduling/assign.test.ts
git commit -m "feat: the engine can hold work behind a task it is not placing"
```

---

### Task 4: A follower is no longer abandoned when its leader starts

**Files:**
- Modify: `src/lib/scheduling/run.ts` — the `chainRoot` block and the `taskInputs` map that follows it
- Verify: `scripts/verify-follow.ts` (run by hand; extended in Task 11)

**Interfaces:**
- Consumes: `TaskInput.notBeforeMinutes` and pinned-group support from Task 3.
- Produces: nothing new; this is the database-side wiring.

**Background.** `run.ts` walks each schedulable task up to a chain root and keys the whole chain on it, so one person gets the pair. The walk uses `schedulable.find(...)`, so once the leader is `IN_PROGRESS` it is not found: the follower keeps a `groupKey` naming a task that is not in the run and a `followsTaskId` that `placeAll` cannot resolve, and first-fits. Reproduced: the follower went to a different person, at 09:00, while its leader ran 14:00–16:00.

The fix stops the walk at the highest ancestor this run is *actually placing*, and records the in-flight leader's owner and end time for the chain's head.

- [ ] **Step 1: Replace the chainRoot block**

In `src/lib/scheduling/run.ts`, replace the whole block that currently begins
`const chainRoot = new Map<string, string>();` and ends with the closing brace of
its `for (const t of schedulable)` loop, with:

```ts
    const schedulableById = new Map(schedulable.map((t) => [t.id, t]));
    const heldById = new Map(inFlight.map((t) => [t.id, t]));

    /**
     * A pair that goes hand in hand is one unit of work, so it reuses the
     * grouping the anchored routines already have: the whole chain is keyed on
     * the task at the top of it, which sends it to one person.
     *
     * "The top" means the highest ancestor this run is placing, not the
     * absolute root. Once somebody starts the leader it becomes immovable and
     * drops out of `schedulable`, and this walk used to lose it -- leaving the
     * follower in a group of one, pointing at a task the engine could not see,
     * to be first-fit to whoever was free. The second half of a pair went to a
     * different person, in the morning, while the first half was being done in
     * the afternoon.
     */
    const chainRoot = new Map<string, string>();

    /**
     * Chain heads whose leader is in flight: who owns it, and when it ends.
     * Enough for the engine to keep the pair together and in order without
     * being able to move the half somebody is holding.
     */
    const detached = new Map<
      string,
      { assigneeId: string | null; end: number | null }
    >();

    for (const t of schedulable) {
      if (!t.followsTaskId) continue;

      let root = t.id;
      const seen = new Set<string>([t.id]);

      // Bounded by MAX_CHAIN's worth of hops, and by `seen`, so a cycle in the
      // stored links stops rather than spinning.
      for (let hop = 0; hop < 5; hop++) {
        const parentId = schedulableById.get(root)?.followsTaskId;
        if (!parentId || seen.has(parentId)) break;

        if (!schedulableById.has(parentId)) {
          const leader = heldById.get(parentId);
          if (leader) {
            detached.set(root, {
              assigneeId: leader.assigneeId,
              end: leader.scheduledEnd,
            });
          }
          break;
        }

        seen.add(parentId);
        root = parentId;
      }

      chainRoot.set(t.id, root);
      chainRoot.set(root, root);
    }
```

- [ ] **Step 2: Pass the pin and the floor into the engine**

In the `taskInputs` map immediately below, add the lookup and the two fields.
The mapper becomes:

```ts
    const taskInputs: TaskInput[] = schedulable.map((t) => {
      const fixed = t.externalKey ? fixedByKey.get(t.externalKey) : undefined;
      const root = chainRoot.get(t.id);
      const detach = detached.get(t.id);
      return {
        id: t.id,
        departmentId: t.departmentId,
        estimatedMinutes: t.estimatedMinutes,
        templateId: t.templateId,
        priority: t.priority,
        // A meeting naming somebody wins over an inherited owner: it is a
        // decision a person made, not one the calendar implies.
        pinnedAssigneeId:
          t.actionItem?.pinnedAssigneeId ?? detach?.assigneeId ?? null,
        notBeforeMinutes: detach?.end ?? null,
        fixedStartMinutes: fixed?.start ?? null,
        fixedEndMinutes: fixed?.end ?? null,
        // The task's own anchor is authoritative -- it survives a rule being
        // edited between the run that created it and this one.
        anchor: t.anchor,
        shiftHalf: t.shiftHalf,
        groupKey: root
          ? `follows:${root}`
          : t.anchor
            ? (fixed?.groupKey ?? null)
            : null,
        followsTaskId: t.followsTaskId,
      };
    });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `scheduledEnd` is `number | null` on `Task` and `notBeforeMinutes` accepts `number | null`, so this compiles only if Task 3 landed.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: all pass. `run.ts` has no unit tests of its own (it is the I/O half); the suite here is a regression check.

- [ ] **Step 5: Verify against a real database**

Run:
```bash
npm run db:start
npx tsx scripts/verify-follow.ts
```
Expected: every check reports `ok`, and the script cleans up after itself. This proves the existing pair behaviour still holds end to end. The in-flight-leader case is added to this script in Task 11, once the multi-leader work gives it a reason to be rewritten.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduling/run.ts
git commit -m "fix: the second half of a pair stays put when the first is under way"
```

---

# Part B — Report a bug or a suggestion from any page

Independent of Parts A and C. Can be moved to the front if a working report button is wanted while the rest is in progress.

---

### Task 5: The Report record

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260731100000_reports/migration.sql`

**Interfaces:**
- Produces: the `Report` model, `ReportKind` (`BUG` | `IDEA`) and `ReportStatus` (`OPEN` | `CLOSED`) enums, and `Report.number` as a unique autoincrementing `Int`. Every later task in Part B reads these.

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma`, after the `P1n` model and before the
`// ---- meetings` divider:

```prisma
// --------------------------------------------------------------- reports

/// What somebody is telling us. A defect and an idea want the same box and
/// the same list; only the reader's expectation differs.
enum ReportKind {
  BUG
  IDEA
}

enum ReportStatus {
  OPEN
  CLOSED
}

/// Something noticed while using the ERP, filed from wherever it was noticed.
///
/// The point of it is that reporting costs one sentence. Everything that would
/// otherwise have to be typed out -- which page, which account, which language,
/// what was running -- is captured here instead, on the server, where it cannot
/// be got wrong or forged.
model Report {
  id String @id @default(cuid())

  /// A short handle, because closing a report from the command line by cuid
  /// is not something anybody would do twice.
  number Int @unique @default(autoincrement())

  kind   ReportKind   @default(BUG)
  body   String
  status ReportStatus @default(OPEN)

  /// The page it was filed from.
  path   String
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// Kept as written rather than read back off the user: a report that only
  /// happens to a WORKER, or only in Spanish, is a different report, and
  /// neither fact survives the account being changed.
  role   Role
  locale String

  /// Whatever was running when it was filed, when anything was.
  taskId String?
  task   Task?   @relation(fields: [taskId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())

  closedAt   DateTime?
  closedById String?
  /// Null for a close from the command line. The CLI is not a session, and
  /// putting a name against something that person did not do would be worse
  /// than leaving it blank.
  closedBy   User?     @relation("ReportCloser", fields: [closedById], references: [id])
  closedNote String?

  @@index([status, createdAt])
}
```

- [ ] **Step 2: Add the other side of each relation**

Prisma requires both sides. In the `User` model, alongside its other relation
lists, add:

```prisma
  reports       Report[]
  closedReports Report[] @relation("ReportCloser")
```

In the `Task` model, alongside `p1ns`, add:

```prisma
  reports Report[]
```

- [ ] **Step 3: Write the migration by hand**

Create `prisma/migrations/20260731100000_reports/migration.sql`:

```sql
CREATE TYPE "ReportKind" AS ENUM ('BUG', 'IDEA');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" "ReportKind" NOT NULL DEFAULT 'BUG',
    "body" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "path" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "locale" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedNote" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Report_number_key" ON "Report"("number");
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply it and regenerate the client**

Run:
```bash
npm run db:start
npx prisma migrate deploy
npx prisma generate
```
Expected: the migration applies cleanly and the client regenerates. If `migrate deploy` reports drift, do **not** reset the database — check the SQL against the schema and fix the SQL.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260731100000_reports
git commit -m "feat: a record for a bug or a suggestion raised from inside"
```

---

### Task 6: Filing and closing a report

**Files:**
- Create: `src/lib/reports/actions.ts`
- Create: `src/lib/reports/db.ts`
- Create: `src/lib/reports/body.ts`
- Create: `src/lib/reports/body.test.ts`

**Interfaces:**
- Consumes: the `Report` model from Task 5.
- Produces:
  - `src/lib/reports/body.ts`: `export const MAX_BODY = 4000` and
    `export function readBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string }`
  - `src/lib/reports/actions.ts`: `export type ReportState = { error?: string; sent?: boolean }` and
    `export async function createReport(prev: ReportState, formData: FormData): Promise<ReportState>`,
    plus `export async function closeReport(prev: ReportState, formData: FormData): Promise<ReportState>`
  - `src/lib/reports/db.ts`:
    `export type ReportFilter = { status?: "OPEN" | "CLOSED"; kind?: "BUG" | "IDEA" }` and
    `export async function listReports(filter?: ReportFilter): Promise<ReportRow[]>`,
    `export async function findReport(number: number): Promise<ReportRow | null>`,
    `export async function closeByNumber(number: number, note: string | null): Promise<boolean>`
- The CLI (Task 8) and the admin page (Task 9) both read `db.ts`. Only the page uses `actions.ts`.

**Why the split.** `body.ts` is the only part with logic worth unit-testing without a database; keeping it separate is what lets the validation rule be tested at all, since Vitest never touches Postgres here.

- [ ] **Step 1: Write the failing test**

Create `src/lib/reports/body.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_BODY, readBody } from "./body";

describe("readBody", () => {
  it("takes an ordinary report", () => {
    expect(readBody("  the timer kept counting  ")).toEqual({
      ok: true,
      body: "the timer kept counting",
    });
  });

  it("refuses an empty one", () => {
    expect(readBody("   ")).toEqual({ ok: false, error: "errors.reportEmpty" });
  });

  it("refuses anything that is not text", () => {
    expect(readBody(null)).toEqual({ ok: false, error: "errors.reportEmpty" });
  });

  it("refuses a paste accident", () => {
    expect(readBody("x".repeat(MAX_BODY + 1))).toEqual({
      ok: false,
      error: "errors.reportTooLong",
    });
  });

  it("takes one exactly at the limit", () => {
    const body = "x".repeat(MAX_BODY);
    expect(readBody(body)).toEqual({ ok: true, body });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/reports/body.test.ts`
Expected: FAIL — `Failed to resolve import "./body"`.

- [ ] **Step 3: Write the validation**

Create `src/lib/reports/body.ts`:

```ts
import { z } from "zod";

/**
 * Long enough for anybody to say what went wrong and how to reproduce it,
 * short enough that a mis-aimed paste cannot put a log file in the database.
 */
export const MAX_BODY = 4000;

const Body = z.string().trim().min(1, "errors.reportEmpty").max(MAX_BODY, "errors.reportTooLong");

/**
 * The one field a report actually asks for.
 *
 * Split out from the action so the rule can be tested without a database --
 * everything else in a report is captured on the server and has nothing to
 * decide.
 */
export function readBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false; error: string } {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  return { ok: true, body: parsed.data };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/reports/body.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the queries**

Create `src/lib/reports/db.ts`:

```ts
import { prisma } from "@/lib/db";

/**
 * Reading reports.
 *
 * Shared by the admin page and the command line, which is the whole point of
 * the feature: what somebody notices while testing has to reach whoever is
 * fixing it without being copied out by hand.
 */

export type ReportFilter = {
  status?: "OPEN" | "CLOSED";
  kind?: "BUG" | "IDEA";
};

const shape = {
  id: true,
  number: true,
  kind: true,
  body: true,
  status: true,
  path: true,
  role: true,
  locale: true,
  createdAt: true,
  closedAt: true,
  closedNote: true,
  user: { select: { displayName: true } },
  task: { select: { title: true, status: true } },
} as const;

export type ReportRow = Awaited<ReturnType<typeof listReports>>[number];

export async function listReports(filter: ReportFilter = {}) {
  return prisma.report.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
    },
    select: shape,
    orderBy: { createdAt: "desc" },
  });
}

export async function findReport(number: number) {
  return prisma.report.findUnique({ where: { number }, select: shape });
}

/**
 * Close one by its short number. Returns false when there is no such report,
 * so the command line can say so rather than silently doing nothing.
 *
 * `closedById` is deliberately left alone -- see the schema.
 */
export async function closeByNumber(
  number: number,
  note: string | null,
): Promise<boolean> {
  const result = await prisma.report.updateMany({
    where: { number, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date(), closedNote: note },
  });
  return result.count > 0;
}
```

- [ ] **Step 6: Write the actions**

Create `src/lib/reports/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/auth/guards";
import { getT } from "@/lib/i18n/server";
import { readBody } from "./body";

export type ReportState = { error?: string; sent?: boolean };

/**
 * File a report from wherever it was noticed.
 *
 * Every role may file one: the person who trips over a bug is whoever happened
 * to be using the page, and a form only a manager can reach would not be there
 * when it was needed.
 *
 * Only the body and the page come off the form. The account, the role, the
 * language and the running task are read here, on the server, because a client
 * that can choose them can get them wrong -- and the whole value of this is
 * that the context is right without anybody typing it.
 */
export async function createReport(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const { t, locale } = await getT();
  const user = await requireUser();

  const body = readBody(formData.get("body"));
  if (!body.ok) return { error: t(body.error) };

  const kind = formData.get("kind") === "IDEA" ? "IDEA" : "BUG";
  const path = String(formData.get("path") ?? "").slice(0, 200) || "/";

  const running = await prisma.task.findFirst({
    where: { assigneeId: user.id, status: { in: ["IN_PROGRESS", "PAUSED"] } },
    select: { id: true },
  });

  await prisma.report.create({
    data: {
      kind,
      body: body.body,
      path,
      userId: user.id,
      role: user.role,
      locale,
      taskId: running?.id ?? null,
    },
  });

  return { sent: true };
}

/** Close one from the admin page. The command line has its own path. */
export async function closeReport(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const { t } = await getT();
  const actor = await requireRole("ADMIN");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: t("errors.notFound") };

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  await prisma.report.updateMany({
    where: { id, status: "OPEN" },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: actor.id,
      closedNote: note || null,
    },
  });

  revalidatePath("/admin/reports");
  return { sent: true };
}
```

- [ ] **Step 7: Add the `notFound` error key**

`errors.notFound` does not exist yet — `closeReport` above is its first use. Add
it to the `errors` group of `src/lib/i18n/dictionary.ts`, in **both** objects:

```ts
    notFound: "Not found",
```

```ts
    notFound: "No encontrado",
```

(The other two new error keys, `reportEmpty` and `reportTooLong`, are added in
Task 7 Step 1 alongside the rest of the report strings.)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `getT()` returns `{ t, locale }` and `requireUser()`
returns a `SessionUser` carrying `id` and `role`.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: all pass, with 5 new tests in a new file (24 files).

- [ ] **Step 10: Commit**

```bash
git add src/lib/reports
git commit -m "feat: filing a report captures the context so you do not have to"
```

---

### Task 7: The button on every page

**Files:**
- Create: `src/app/(app)/report-button.tsx`
- Modify: `src/app/(app)/layout.tsx` (the bottom cluster, beside sign-out and the theme toggle)
- Modify: `src/lib/i18n/dictionary.ts` (both `en` and `es`)

**Interfaces:**
- Consumes: `createReport` and `ReportState` from Task 6.
- Produces: `export function ReportButton(): JSX.Element` — a client component taking no props. It reads the path itself with `usePathname()`.

**Why the sidebar.** The sidebar is the shell, so a button in it is on every page for every role by construction. A floating corner button would fight the fixed now-bar, which is already pinned to the bottom of every page.

- [ ] **Step 1: Add the strings, both languages**

In `src/lib/i18n/dictionary.ts`, add a `report` group to the `en` object
(alongside the other screen groups):

```ts
  report: {
    open: "Report",
    title: "Report something",
    hint: "Where you are, who you are and what is running are attached automatically.",
    bug: "Bug",
    idea: "Suggestion",
    placeholderBug: "What happened, and what you expected instead",
    placeholderIdea: "What would make this better",
    send: "Send",
    cancel: "Cancel",
    sent: "Thank you — noted.",
  },
```

and the same group to `es`:

```ts
  report: {
    open: "Reportar",
    title: "Reportar algo",
    hint: "Dónde estás, quién eres y qué está en marcha se adjuntan solos.",
    bug: "Fallo",
    idea: "Sugerencia",
    placeholderBug: "Qué ha pasado, y qué esperabas en su lugar",
    placeholderIdea: "Qué lo mejoraría",
    send: "Enviar",
    cancel: "Cancelar",
    sent: "Gracias, queda anotado.",
  },
```

In the `errors` group of **both** objects, add:

```ts
    reportEmpty: "Write what happened first",
    reportTooLong: "That is too long — 4000 characters at most",
```

```ts
    reportEmpty: "Escribe primero qué ha pasado",
    reportTooLong: "Es demasiado largo: 4000 caracteres como máximo",
```

Plus `notFound` in both, if Task 6 Step 7 found it missing.

- [ ] **Step 2: Write the component**

Create `src/app/(app)/report-button.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createReport, type ReportState } from "@/lib/reports/actions";
import { useT } from "@/lib/i18n/client";

const initial: ReportState = {};

/**
 * One quiet button in the sidebar footer, so anything noticed can be said
 * where it was noticed.
 *
 * It lives in the shell rather than on each page because the point is that it
 * is always there -- a report you have to navigate to is one you write down on
 * paper instead. A bug and a suggestion share the box: they are the same act,
 * and asking somebody to decide which they have before they can type it is a
 * reason not to bother.
 */
export function ReportButton() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"BUG" | "IDEA">("BUG");
  const dialog = useRef<HTMLDialogElement>(null);

  const [state, submit, pending] = useActionState(createReport, initial);

  // The path is read here rather than on the server: a server action has no
  // idea which page called it.
  const path = usePathname();

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  // Closing on the way out of a successful send, rather than on a timer, so
  // the acknowledgement is seen and the box is empty next time.
  useEffect(() => {
    if (!state.sent) return;
    const id = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(id);
  }, [state.sent]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("report.title")}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        aria-label={t("report.title")}
      >
        <svg
          width={15}
          height={15}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        >
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 4.8v3.6" />
          <path d="M8 11.1v.1" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="w-[min(440px,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <form action={submit} className="flex flex-col gap-3 p-4">
          <p className="text-[13px] font-semibold">{t("report.title")}</p>

          <div className="flex gap-1">
            {(["BUG", "IDEA"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`btn btn-sm ${kind === option ? "border-accent text-accent" : ""}`}
              >
                {t(`report.${option === "BUG" ? "bug" : "idea"}`)}
              </button>
            ))}
          </div>

          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="path" value={path} />

          <textarea
            name="body"
            rows={5}
            required
            maxLength={4000}
            placeholder={t(
              kind === "BUG" ? "report.placeholderBug" : "report.placeholderIdea",
            )}
            className="field text-[12.5px]"
          />

          <p className="text-[11.5px] text-muted">{t("report.hint")}</p>

          {state.error && (
            <p className="text-[12px] text-pause">{state.error}</p>
          )}
          {state.sent && (
            <p className="text-[12px] text-accent">{t("report.sent")}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-sm"
            >
              {t("report.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="btn btn-sm border-accent text-accent disabled:opacity-50"
            >
              {t("report.send")}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
```

- [ ] **Step 3: Put it in the shell**

In `src/app/(app)/layout.tsx`, add the import beside the `ThemeToggle` one:

```ts
import { ReportButton } from "./report-button";
```

and render it next to the theme toggle in the bottom row, changing:

```tsx
              <div className="flex items-center gap-1 lg:w-full">
                <form action={logout} className="lg:min-w-0 lg:flex-1">
```

so that the row ends:

```tsx
                <ReportButton />
                <ThemeToggle current={theme} />
              </div>
```

(the `<ReportButton />` goes immediately before `<ThemeToggle ... />`, inside the
same `div`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: See it working**

Run: `npm run dev`, sign in, and from any page press the report button, choose
Suggestion, type a sentence and send. Expected: the acknowledgement appears and
the dialog closes. Then check it landed:

```bash
npx prisma studio
```
and look at the `Report` table: one row, `kind = IDEA`, `path` matching the page
you were on, `role` and `locale` filled in, `taskId` set if a task was running.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/report-button.tsx" "src/app/(app)/layout.tsx" src/lib/i18n/dictionary.ts
git commit -m "feat: a report button on every page, for a bug or an idea"
```

---

### Task 8: Reading reports from the command line

**Files:**
- Create: `scripts/reports.ts`
- Modify: `package.json` (the `scripts` block)

**Interfaces:**
- Consumes: `listReports`, `findReport`, `closeByNumber`, `ReportFilter` from Task 6.
- Produces: `npm run bugs` with the sub-commands below.

**Why.** This is the reason the feature exists: a report filed while testing has to reach whoever is fixing it without being pasted anywhere.

`src/lib/db.ts` does not import `server-only`, and `tsx` resolves the `@/` alias — `scripts/verify-follow.ts` already imports `src/lib/plan/follow-db.ts`, which imports `@/lib/db`, and runs. So this script can reuse `src/lib/reports/db.ts` rather than opening its own client. The imports are dynamic and inside `main()` so that `dotenv/config` has run before `createClient()` reads `DATABASE_URL`.

- [ ] **Step 1: Write the script**

Create `scripts/reports.ts`:

```ts
/**
 * Reports, from the command line.
 *
 * The point of the report button is that what somebody notices while testing
 * reaches whoever is fixing it directly. This is that end of it.
 *
 *   npm run bugs                      open reports, newest first
 *   npm run bugs -- all               open and closed
 *   npm run bugs -- bugs              open defects only
 *   npm run bugs -- ideas             open suggestions only
 *   npm run bugs -- show 7            one report in full
 *   npm run bugs -- close 7 "note"    close it, with a note
 */
import "dotenv/config";

const [command, ...rest] = process.argv.slice(2);

function line(r: {
  number: number;
  status: string;
  kind: string;
  path: string;
  createdAt: Date;
  user: { displayName: string };
}) {
  const when = r.createdAt.toISOString().slice(0, 16).replace("T", " ");
  return `#${String(r.number).padEnd(4)} ${r.status.padEnd(6)} ${r.kind.padEnd(4)} ${r.path.padEnd(22)} ${r.user.displayName.padEnd(18)} ${when}`;
}

async function main() {
  const { listReports, findReport, closeByNumber } = await import(
    "../src/lib/reports/db"
  );

  if (command === "close") {
    const number = Number(rest[0]);
    if (!Number.isInteger(number)) {
      console.error("Which one? npm run bugs -- close 7 \"what you did\"");
      process.exitCode = 1;
      return;
    }
    const note = rest.slice(1).join(" ").trim() || null;
    const closed = await closeByNumber(number, note);
    console.log(
      closed ? `closed #${number}` : `#${number} is not an open report`,
    );
    if (!closed) process.exitCode = 1;
    return;
  }

  if (command === "show") {
    const number = Number(rest[0]);
    const report = await findReport(number);
    if (!report) {
      console.error(`no report #${rest[0]}`);
      process.exitCode = 1;
      return;
    }
    console.log(line(report));
    console.log(`  by      ${report.user.displayName} (${report.role}, ${report.locale})`);
    if (report.task) {
      console.log(`  running ${report.task.title} [${report.task.status}]`);
    }
    if (report.closedAt) {
      console.log(`  closed  ${report.closedAt.toISOString().slice(0, 16).replace("T", " ")} — ${report.closedNote ?? "no note"}`);
    }
    console.log("");
    for (const l of report.body.split("\n")) console.log(`  ${l}`);
    return;
  }

  const filter =
    command === "all"
      ? {}
      : command === "bugs"
        ? { status: "OPEN" as const, kind: "BUG" as const }
        : command === "ideas"
          ? { status: "OPEN" as const, kind: "IDEA" as const }
          : { status: "OPEN" as const };

  const reports = await listReports(filter);
  if (reports.length === 0) {
    console.log("nothing to look at");
    return;
  }

  for (const r of reports) {
    console.log(line(r));
    // One line of the body is enough to know whether to run `show`.
    const first = r.body.split("\n")[0];
    console.log(`      ${first.length > 96 ? `${first.slice(0, 96)}…` : first}`);
  }
  console.log(`\n${reports.length} report${reports.length === 1 ? "" : "s"}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Wire up the npm script**

In `package.json`, in the `scripts` block, add after `"verify:sessions"`:

```json
    "bugs": "tsx scripts/reports.ts"
```

(remembering the comma on the preceding line).

- [ ] **Step 3: Try it**

With the report you filed in Task 7 still in the database, run:

```bash
npm run bugs
npm run bugs -- ideas
npm run bugs -- show 1
npm run bugs -- close 1 "just testing the button"
npm run bugs
```

Expected: the list shows your report; `show 1` prints the full body with the
page, role, locale and running task; `close 1` prints `closed #1`; and the final
`npm run bugs` says `nothing to look at`. Then `npm run bugs -- all` still shows
it, marked CLOSED with the note.

- [ ] **Step 4: Check the failure paths**

Run: `npm run bugs -- close 999 "nope"`
Expected: `#999 is not an open report`, and a non-zero exit code.

- [ ] **Step 5: Commit**

```bash
git add scripts/reports.ts package.json
git commit -m "feat: read and close reports from the command line"
```

---

### Task 9: The admin list

**Files:**
- Create: `src/app/(app)/admin/reports/page.tsx`
- Create: `src/app/(app)/admin/reports/close-form.tsx`
- Modify: `src/app/(app)/layout.tsx` (a nav link, ADMIN only)
- Modify: `src/lib/i18n/dictionary.ts` (both `en` and `es`)

**Interfaces:**
- Consumes: `listReports` from Task 6, `closeReport` and `ReportState` from Task 6.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the strings, both languages**

Extend the `report` group in `en`:

```ts
    listTitle: "Reports",
    filterOpen: "Open",
    filterClosed: "Closed",
    filterAll: "All",
    empty: "Nothing reported.",
    close: "Close",
    closeNote: "What you did",
    closedOn: "Closed",
    running: "Running at the time",
```

and in `es`:

```ts
    listTitle: "Reportes",
    filterOpen: "Abiertos",
    filterClosed: "Cerrados",
    filterAll: "Todos",
    empty: "No hay nada reportado.",
    close: "Cerrar",
    closeNote: "Qué has hecho",
    closedOn: "Cerrado",
    running: "En marcha en ese momento",
```

Add to the `nav` group in `en`: `reports: "Reports",` and in `es`:
`reports: "Reportes",`.

- [ ] **Step 2: Write the close form**

Create `src/app/(app)/admin/reports/close-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { closeReport, type ReportState } from "@/lib/reports/actions";
import { useT } from "@/lib/i18n/client";

const initial: ReportState = {};

export function CloseForm({ id }: { id: string }) {
  const { t } = useT();
  const [state, submit, pending] = useActionState(closeReport, initial);

  return (
    <form action={submit} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="note"
        maxLength={500}
        placeholder={t("report.closeNote")}
        className="field min-w-[220px] flex-1 py-1 text-[12.5px]"
      />
      <button type="submit" disabled={pending} className="btn btn-sm disabled:opacity-50">
        {t("report.close")}
      </button>
      {state.error && <span className="text-[12px] text-pause">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 3: Write the page**

Create `src/app/(app)/admin/reports/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/guards";
import { getT } from "@/lib/i18n/server";
import { listReports } from "@/lib/reports/db";
import { CloseForm } from "./close-form";

/**
 * The same reports the command line reads, for when reading them in the app
 * is easier than running a script.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireRole("ADMIN");
  const { t } = await getT();
  const { show } = await searchParams;

  const filter =
    show === "closed"
      ? { status: "CLOSED" as const }
      : show === "all"
        ? {}
        : { status: "OPEN" as const };

  const reports = await listReports(filter);

  const tabs: { key: string; href: string; label: string }[] = [
    { key: "open", href: "/admin/reports", label: t("report.filterOpen") },
    { key: "closed", href: "/admin/reports?show=closed", label: t("report.filterClosed") },
    { key: "all", href: "/admin/reports?show=all", label: t("report.filterAll") },
  ];
  const active = show === "closed" ? "closed" : show === "all" ? "all" : "open";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[19px] font-semibold">{t("report.listTitle")}</h1>

      <div className="flex gap-1">
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            className={`btn btn-sm ${tab.key === active ? "border-accent text-accent" : ""}`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {reports.length === 0 ? (
        <p className="text-[13px] text-muted">{t("report.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded border border-line bg-surface-2 p-3">
              <p className="flex flex-wrap items-baseline gap-2 text-[11.5px] text-faint">
                <span className="num font-semibold text-muted">#{r.number}</span>
                <span>{r.kind}</span>
                <span className="num">{r.path}</span>
                <span>{r.user.displayName}</span>
                <span>{r.role}</span>
                <span>{r.locale}</span>
                <span className="num">
                  {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </p>

              <p className="mt-1.5 text-[13px] whitespace-pre-wrap">{r.body}</p>

              {r.task && (
                <p className="mt-1.5 text-[11.5px] text-muted">
                  {t("report.running")}: {r.task.title}
                </p>
              )}

              {r.status === "OPEN" ? (
                <CloseForm id={r.id} />
              ) : (
                <p className="mt-1.5 text-[11.5px] text-faint">
                  {t("report.closedOn")}
                  {r.closedNote ? ` — ${r.closedNote}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the nav link, ADMIN only**

In `src/app/(app)/layout.tsx`, near the other role flags at the top, add:

```ts
  const isAdmin = hasRole(user, "ADMIN");
```

and in the `groups` array, append a fourth group after the HR one:

```tsx
    {
      label: t("nav.groupTeam"),
      links: isAdmin
        ? [
            <NavLink key="reports" href="/admin/reports">
              {t("nav.reports")}
            </NavLink>,
          ]
        : [],
    },
```

A group with no links does not render, so this is invisible to everyone else.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: See it working**

Run `npm run dev` and visit `/admin/reports` as an ADMIN. Expected: the report
you filed and closed in Task 8 appears under **Closed** and **All**, with its
note, and nothing under **Open**. File another from any page and confirm it
appears under Open with a working Close button. Then sign in as a WORKER and
confirm `/admin/reports` refuses and the nav link is absent.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/admin" "src/app/(app)/layout.tsx" src/lib/i18n/dictionary.ts
git commit -m "feat: an admin list of what has been reported"
```

---

# Part C — A task can come after several others

---

### Task 10: Comes-after becomes a graph

**One task, five parts, in order.** Dropping `TaskTemplate.followsId` breaks
`follow.ts`, `follow-db.ts`, `catalogue/actions.ts`, `catalogue/page.tsx`,
`catalogue-form.tsx` and `catalogue-list.tsx` at once, so there is no smaller
change that leaves the tree typechecking. Commit after each part if you like —
the task is judged on its whole diff — but **the task is not done until
`npx tsc --noEmit` is clean and `npm test` is green.**

Part 2 applies a database migration. Run `npm run db:start` before it and do not
run `prisma migrate reset` at any point.

**Files across all five parts:**
- Modify: `src/lib/plan/follow.ts`, `src/lib/plan/follow.test.ts`
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/20260731110000_template_follows/migration.sql`
- Modify: `src/lib/plan/follow-db.ts`
- Modify: `src/lib/catalogue/actions.ts`, `src/app/(app)/catalogue/page.tsx`
- Modify: `src/app/(app)/catalogue/catalogue-form.tsx`, `src/app/(app)/catalogue/catalogue-list.tsx`
- Modify: `src/lib/i18n/dictionary.ts`

---

#### Part 1 — The chain arithmetic becomes a graph

**Files:**
- Modify: `src/lib/plan/follow.ts`
- Modify: `src/lib/plan/follow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces — every signature in this file changes shape, and Parts 3 and 4 depend on the exact names:
  - `export type FollowLink = { followerId: string; leaderId: string }`
  - `export type ChainStep = { templateId: string; afterTemplateId: string }`
  - `export function chainFrom(leaderId: string, links: FollowLink[]): ChainStep[]`
  - `export function wouldCycle(followerId: string, leaderId: string, links: FollowLink[]): boolean`
  - `export function depthOf(id: string, links: FollowLink[]): number`
  - `export const MAX_CHAIN = 5` and `buildFollowKey` are unchanged.

**Two changes at once, deliberately.** `chainFrom` now returns each follower
*with the parent it actually comes after*, not just a flat list. Today the caller
links each generated task to whatever preceded it in the walk, so for
`A → (B, D)` the task for D is linked to B rather than to A. That was survivable
with one parent per node and is not once a node can have several.

- [ ] **Step 1: Rewrite the tests**

Replace the whole of `src/lib/plan/follow.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  buildFollowKey,
  chainFrom,
  depthOf,
  MAX_CHAIN,
  wouldCycle,
  type FollowLink,
} from "./follow";

/** "b follows a" reads as [b, a] -- the follower first, as it is spoken. */
function links(...pairs: [string, string][]): FollowLink[] {
  return pairs.map(([followerId, leaderId]) => ({ followerId, leaderId }));
}

/** Just the ids, for the cases where the parent is not what is being tested. */
function ids(steps: { templateId: string }[]): string[] {
  return steps.map((s) => s.templateId);
}

describe("chainFrom", () => {
  it("finds nothing for a task that stands on its own", () => {
    expect(chainFrom("a", links(["b", "x"]))).toEqual([]);
  });

  it("finds the one task that comes after", () => {
    expect(chainFrom("a", links(["b", "a"]))).toEqual([
      { templateId: "b", afterTemplateId: "a" },
    ]);
  });

  it("finds every task hanging off the same leader", () => {
    // Reviewing the portals produces both a report and a Gantt update.
    const l = links(["report", "a"], ["gantt", "a"]);
    expect(ids(chainFrom("a", l))).toEqual(["report", "gantt"]);
  });

  it("walks depth-first, so a follower's own follower comes next", () => {
    // a -> (b -> c), d is worked as b, c, d -- not b, d, c.
    const l = links(["b", "a"], ["c", "b"], ["d", "a"]);
    expect(chainFrom("a", l)).toEqual([
      { templateId: "b", afterTemplateId: "a" },
      { templateId: "c", afterTemplateId: "b" },
      { templateId: "d", afterTemplateId: "a" },
    ]);
  });

  it("names the leader each one actually comes after", () => {
    // The bug this return shape exists to fix: d comes after a, not after b.
    const steps = chainFrom("a", links(["b", "a"], ["d", "a"]));
    expect(steps.find((s) => s.templateId === "d")?.afterTemplateId).toBe("a");
  });

  it("ignores chains belonging to a different leader", () => {
    const l = links(["b", "a"], ["y", "x"]);
    expect(ids(chainFrom("a", l))).toEqual(["b"]);
  });

  it("gives a follower with two leaders to each of them", () => {
    // Debriefing comes after Proceso and after Proceso LATAM. Each one brings
    // its own debriefing -- one debriefing per thing being debriefed.
    const l = links(["debrief", "proceso"], ["debrief", "latam"]);
    expect(chainFrom("proceso", l)).toEqual([
      { templateId: "debrief", afterTemplateId: "proceso" },
    ]);
    expect(chainFrom("latam", l)).toEqual([
      { templateId: "debrief", afterTemplateId: "latam" },
    ]);
  });

  it("survives a cycle the catalogue let through", () => {
    // Never reachable through the UI, but a direct database edit could do it,
    // and walking it forever would take the scheduler down.
    const l = links(["a", "c"], ["b", "a"], ["c", "b"]);
    expect(ids(chainFrom("a", l))).toEqual(["b", "c"]);
  });

  it("stops at the depth cap rather than generating an unbounded day", () => {
    const l: FollowLink[] = [];
    for (let i = 1; i <= 20; i++) {
      l.push({ followerId: `t${i}`, leaderId: `t${i - 1}` });
    }
    expect(chainFrom("t0", l)).toHaveLength(MAX_CHAIN);
  });
});

describe("wouldCycle", () => {
  it("refuses a task pointed at itself", () => {
    expect(wouldCycle("a", "a", [])).toBe(true);
  });

  it("refuses a link that closes a loop", () => {
    // b already follows a. Pointing a at b would make each wait on the other.
    expect(wouldCycle("a", "b", links(["b", "a"]))).toBe(true);
  });

  it("refuses a loop that only closes through the second parent", () => {
    // c follows a and also follows b; b follows x. Pointing x at c loops
    // through the b side, which a single-parent walk would never reach.
    const l = links(["c", "a"], ["c", "b"], ["b", "x"]);
    expect(wouldCycle("x", "c", l)).toBe(true);
  });

  it("allows a link that does not", () => {
    expect(wouldCycle("c", "a", links(["b", "a"]))).toBe(false);
  });

  it("allows a second leader that shares no ancestry", () => {
    expect(wouldCycle("debrief", "latam", links(["debrief", "proceso"]))).toBe(
      false,
    );
  });

  it("stops on a cycle that already exists upstream", () => {
    const l = links(["a", "b"], ["b", "a"]);
    expect(wouldCycle("z", "a", l)).toBe(false);
  });
});

describe("depthOf", () => {
  it("counts a task with no leader as the top", () => {
    expect(depthOf("a", [])).toBe(1);
  });

  it("counts the steps above it", () => {
    expect(depthOf("c", links(["b", "a"], ["c", "b"]))).toBe(3);
  });

  it("takes the longest way up when there are two", () => {
    // d follows b (which follows a) and also follows x, which is a root. The
    // long way is what the cap has to be measured against.
    const l = links(["b", "a"], ["d", "b"], ["d", "x"]);
    expect(depthOf("d", l)).toBe(3);
  });

  it("stops on a cycle rather than counting forever", () => {
    expect(depthOf("a", links(["a", "b"], ["b", "a"]))).toBeLessThanOrEqual(3);
  });
});

describe("buildFollowKey", () => {
  it("is stable for the same leader and follower", () => {
    expect(buildFollowKey("rule:1:2026-07-27", "tpl-report")).toBe(
      buildFollowKey("rule:1:2026-07-27", "tpl-report"),
    );
  });

  it("differs per leader, so two leaders make two tasks", () => {
    expect(buildFollowKey("proceso-key", "tpl-debrief")).not.toBe(
      buildFollowKey("latam-key", "tpl-debrief"),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/plan/follow.test.ts`
Expected: FAIL — TypeScript rejects `FollowLink` objects with `followerId`/`leaderId`.

- [ ] **Step 3: Rewrite follow.ts**

Replace everything in `src/lib/plan/follow.ts` from the `FollowLink` type
declaration down to (but not including) `buildFollowKey` with:

```ts
export type FollowLink = {
  /** The one that comes after. */
  followerId: string;
  /** The one it comes after. */
  leaderId: string;
};

/** A follower, and the entry it actually comes after. */
export type ChainStep = {
  templateId: string;
  afterTemplateId: string;
};

/** Followers by leader, which is the direction every walk down goes. */
function byLeader(links: FollowLink[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of links) {
    const list = map.get(link.leaderId);
    if (list) list.push(link.followerId);
    else map.set(link.leaderId, [link.followerId]);
  }
  return map;
}

/** Leaders by follower, for the walks that go up. */
function byFollower(links: FollowLink[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of links) {
    const list = map.get(link.followerId);
    if (list) list.push(link.leaderId);
    else map.set(link.followerId, [link.leaderId]);
  }
  return map;
}

/**
 * Everything that hangs off `leaderId`, in the order it has to happen, each
 * paired with the entry it comes straight after.
 *
 * Depth-first, so a follower's own followers come immediately after it rather
 * than after all its siblings: A -> (B -> C), D reads B, C, D. That is the
 * order somebody would actually work in.
 *
 * The parent is returned rather than inferred from position because an entry
 * can now come after several others. Reading it off the sequence was already
 * subtly wrong -- for A -> (B, D) it made D follow B -- and with a second
 * parent in play there is no position to read it off at all.
 *
 * Anything deeper than MAX_CHAIN is dropped rather than throwing. A chain that
 * long is a catalogue mistake, and refusing to plan the day because of it would
 * punish the wrong person -- the tasks that do fit still get made.
 */
export function chainFrom(leaderId: string, links: FollowLink[]): ChainStep[] {
  const followers = byLeader(links);

  const out: ChainStep[] = [];
  // Guards against a cycle the catalogue let through: without it, A -> B -> A
  // would walk forever.
  const seen = new Set<string>([leaderId]);

  const walk = (id: string, depth: number) => {
    if (depth >= MAX_CHAIN) return;
    for (const follower of followers.get(id) ?? []) {
      if (seen.has(follower)) continue;
      seen.add(follower);
      out.push({ templateId: follower, afterTemplateId: id });
      walk(follower, depth + 1);
    }
  };

  walk(leaderId, 0);
  return out;
}

/**
 * Would pointing `followerId` at `leaderId` create a cycle?
 *
 * Walks up from the proposed leader through *every* parent looking for the
 * follower. One pointer per entry used to make this a single path; an entry
 * with two leaders has two ways up, and a loop that closes through the second
 * one is exactly as broken as a loop that closes through the first.
 *
 * Pointing an entry at itself is the degenerate case and is caught first.
 */
export function wouldCycle(
  followerId: string,
  leaderId: string,
  links: FollowLink[],
): boolean {
  if (followerId === leaderId) return true;

  const leaders = byFollower(links);
  const frontier = [leaderId];
  const seen = new Set<string>();

  while (frontier.length > 0) {
    const cursor = frontier.pop()!;
    if (cursor === followerId) return true;
    // A cycle that already exists upstream: stop rather than spin.
    if (seen.has(cursor)) continue;
    seen.add(cursor);
    frontier.push(...(leaders.get(cursor) ?? []));
  }

  return false;
}

/**
 * How many steps deep `id` sits, counting the entry at the top as 1.
 *
 * The *longest* way up, now that there can be more than one. MAX_CHAIN bounds
 * the whole structure, so the deepest path is the one it has to be measured
 * against -- taking the short way would let a link through that makes a
 * six-step chain by another route.
 *
 * Used to refuse a link that would push an existing chain past MAX_CHAIN from
 * the middle, which walking downwards from the new follower would miss.
 */
export function depthOf(id: string, links: FollowLink[]): number {
  const leaders = byFollower(links);

  const deepest = (cursor: string, seen: Set<string>): number => {
    let best = 1;
    for (const leader of leaders.get(cursor) ?? []) {
      if (seen.has(leader)) continue;
      seen.add(leader);
      best = Math.max(best, 1 + deepest(leader, seen));
      seen.delete(leader);
    }
    return best;
  };

  return deepest(id, new Set([id]));
}
```

Leave `MAX_CHAIN` and `buildFollowKey` exactly as they are, and update the file's
top doc comment: the sentence "The link is stored on the follower, so a leader
may have several" now reads "Links are stored as edges, so an entry may come
after several others and a leader may have several followers. That makes the
runtime shape a directed graph rather than a tree".

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/plan/follow.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Note what is now broken, and leave it**

Run: `npx tsc --noEmit`
Expected: errors in `src/lib/plan/follow-db.ts` and `src/lib/catalogue/actions.ts`,
which still pass `{ id, followsId }` links. That is expected at this point —
Parts 3 and 4 fix them. Do not patch them here; do not move on until the
`follow.test.ts` run above is green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan/follow.ts src/lib/plan/follow.test.ts
git commit -m "feat: the chain arithmetic works on a graph, not a tree"
```

---

#### Part 2 — The join table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260731110000_template_follows/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `TemplateFollow { followerId, leaderId }` with a composite primary key. `TaskTemplate.followsId`, `follows` and `followers` are gone; `TaskTemplate.leaders` and `TaskTemplate.followers` replace them.

- [ ] **Step 1: Replace the relation in the schema**

In `prisma/schema.prisma`, inside `model TaskTemplate`, delete these four lines:

```prisma
  followsId String?
  follows   TaskTemplate?  @relation("TemplateFollows", fields: [followsId], references: [id], onDelete: SetNull)
  followers TaskTemplate[] @relation("TemplateFollows")
```

and the index line:

```prisma
  @@index([followsId])
```

Replace the relation lines with:

```prisma
  /// What this one comes after, and what comes after it. An entry may come
  /// after several others -- the debriefing follows both the process and the
  /// LATAM process -- and each leader brings its own copy of it, because you
  /// debrief the thing you did, not the pair of them.
  leaders   TemplateFollow[] @relation("FollowFollower")
  followers TemplateFollow[] @relation("FollowLeader")
```

Update the doc comment above them: the old "This one comes after that one. Set on
the follower, so several entries may hang off the same leader" is replaced by the
comment above.

- [ ] **Step 2: Add the join model**

Immediately after `model TaskTemplate`'s closing brace, add:

```prisma
/// "This one comes after that one", as an edge rather than a column.
///
/// Both sides cascade: a link to an entry that no longer exists is not a link.
/// This is a change from the column it replaces, which could only ever null
/// itself out -- an option that stops making sense once the link is a row.
model TemplateFollow {
  followerId String
  follower   TaskTemplate @relation("FollowFollower", fields: [followerId], references: [id], onDelete: Cascade)
  leaderId   String
  leader     TaskTemplate @relation("FollowLeader", fields: [leaderId], references: [id], onDelete: Cascade)

  @@id([followerId, leaderId])
  @@index([leaderId])
}
```

- [ ] **Step 3: Write the migration by hand**

Create `prisma/migrations/20260731110000_template_follows/migration.sql`:

```sql
CREATE TABLE "TemplateFollow" (
    "followerId" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,

    CONSTRAINT "TemplateFollow_pkey" PRIMARY KEY ("followerId", "leaderId")
);

CREATE INDEX "TemplateFollow_leaderId_idx" ON "TemplateFollow"("leaderId");

ALTER TABLE "TemplateFollow" ADD CONSTRAINT "TemplateFollow_followerId_fkey"
    FOREIGN KEY ("followerId") REFERENCES "TaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateFollow" ADD CONSTRAINT "TemplateFollow_leaderId_fkey"
    FOREIGN KEY ("leaderId") REFERENCES "TaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing link becomes one row. Done before the column is dropped, so
-- nothing anybody configured is lost.
INSERT INTO "TemplateFollow" ("followerId", "leaderId")
SELECT "id", "followsId" FROM "TaskTemplate" WHERE "followsId" IS NOT NULL;

DROP INDEX IF EXISTS "TaskTemplate_followsId_idx";
ALTER TABLE "TaskTemplate" DROP CONSTRAINT IF EXISTS "TaskTemplate_followsId_fkey";
ALTER TABLE "TaskTemplate" DROP COLUMN "followsId";
```

- [ ] **Step 4: Check what the existing links are, before migrating**

Run:
```bash
npm run db:start
npx tsx -e 'import("dotenv/config").then(async()=>{const {PrismaClient}=await import("@prisma/client");const {PrismaPg}=await import("@prisma/adapter-pg");const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});console.log(await p.$queryRawUnsafe(`SELECT id, name, "followsId" FROM "TaskTemplate" WHERE "followsId" IS NOT NULL`));await p.$disconnect()})'
```
Expected: a list of the current links. **Write down how many rows there are** —
the next step checks the same number came out the other side.

- [ ] **Step 5: Apply it and regenerate**

Run:
```bash
npx prisma migrate deploy
npx prisma generate
```
Expected: applies cleanly.

- [ ] **Step 6: Check the backfill**

Run:
```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const {PrismaClient}=await import("@prisma/client");const {PrismaPg}=await import("@prisma/adapter-pg");const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});console.log(await p.templateFollow.findMany());await p.$disconnect()})'
```
Expected: exactly the rows from Step 4, with `followsId` now appearing as
`leaderId`. If the count differs, stop — the migration lost something.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260731110000_template_follows
git commit -m "feat: comes-after becomes a link table, so there can be several"
```

---

#### Part 3 — Generating one follower per leader

**Files:**
- Modify: `src/lib/plan/follow-db.ts`

**Interfaces:**
- Consumes: `chainFrom`, `ChainStep`, `FollowLink`, `buildFollowKey` from Part 1; `TemplateFollow` from Part 2.
- Produces: `createFollowers(leader: Task): Promise<Task[]>` and `followersOf(taskIds: string[]): Promise<Task[]>` — both signatures unchanged.

**Note.** `followersOf` needs no change at all: it walks `Task.followsTaskId`, which is still a single link. Do not touch it.

- [ ] **Step 1: Read the links from the join table**

In `src/lib/plan/follow-db.ts`, replace `linksFor` with:

```ts
/** The department's links, which is all chainFrom() needs. */
async function linksFor(departmentId: string): Promise<FollowLink[]> {
  const rows = await prisma.templateFollow.findMany({
    where: {
      follower: { departmentId, active: true },
      leader: { departmentId, active: true },
    },
    select: { followerId: true, leaderId: true },
  });
  return rows;
}
```

- [ ] **Step 2: Rewrite the generation loop**

Replace the body of `createFollowers` from `const links = await linksFor(...)`
to the closing `return created;` with:

```ts
  const links = await linksFor(leader.departmentId);
  const steps = chainFrom(leader.templateId, links);
  if (steps.length === 0) return [];

  /**
   * The leader's own template is fetched alongside the followers', because the
   * disambiguating title needs its name and `steps` never includes the leader
   * itself.
   */
  const templates = await prisma.taskTemplate.findMany({
    where: {
      id: { in: [leader.templateId, ...steps.map((s) => s.templateId)] },
      active: true,
    },
  });
  const byId = new Map(templates.map((t) => [t.id, t]));

  /**
   * How many entries each follower comes after, so a name is only disambiguated
   * where it is actually ambiguous. One leader is the ordinary case and the
   * task keeps the catalogue's name, exactly as it always has.
   */
  const leaderCount = new Map<string, number>();
  for (const link of links) {
    leaderCount.set(link.followerId, (leaderCount.get(link.followerId) ?? 0) + 1);
  }

  const leaderKey = leader.externalKey ?? `task:${leader.id}`;
  const created: Task[] = [];

  /**
   * The task generated for each template in this walk, so a follower links to
   * the thing it actually comes after.
   *
   * It used to link to whatever preceded it in the sequence, which for
   * A -> (B, D) made D follow B. Survivable while every entry had one leader;
   * meaningless now that the walk is over a graph.
   */
  const taskFor = new Map<string, Task>([[leader.templateId, leader]]);

  for (const step of steps) {
    const template = byId.get(step.templateId);
    if (!template) continue;

    const after = taskFor.get(step.afterTemplateId);
    // Its leader was inactive and skipped, so there is nothing to come after.
    if (!after) continue;

    const externalKey = buildFollowKey(leaderKey, step.templateId);

    const existing = await prisma.task.findUnique({ where: { externalKey } });
    if (existing) {
      taskFor.set(step.templateId, existing);
      continue;
    }

    /**
     * "Debriefing proceso — Proceso LATAM".
     *
     * Two leaders raise two debriefings on the same day, and two identical rows
     * is the app declining to say which is which. Only when there really are
     * two: with one leader the name is left exactly alone.
     */
    const leaderName = byId.get(step.afterTemplateId)?.name ?? null;
    const ambiguous = (leaderCount.get(step.templateId) ?? 0) > 1;
    const title =
      ambiguous && leaderName
        ? `${template.name} — ${leaderName}`
        : ambiguous
          ? `${template.name} — ${after.title}`
          : template.name;

    const follower = await prisma.task.create({
      data: {
        externalKey,
        title,
        estimatedMinutes: template.estimatedMinutes,
        dueDate: leader.dueDate,
        departmentId: leader.departmentId,
        templateId: template.id,
        priority: template.priority,
        shiftHalf: template.shiftHalf,
        origin: leader.origin,
        // Unowned work cannot be "after" anything in particular, so a follower
        // of an unassigned leader waits unassigned too and the engine places
        // the pair together.
        assigneeId: leader.assigneeId,
        status: leader.assigneeId ? "ASSIGNED" : "UNASSIGNED",
        scheduledDate: leader.assigneeId ? leader.scheduledDate : null,
        followsTaskId: after.id,
      },
    });

    // Immediately after whatever it follows, when the leader has a slot at all.
    if (leader.assigneeId && leader.scheduledDate) {
      await placeOnDay(
        follower.id,
        leader.assigneeId,
        leader.scheduledDate,
        after.scheduledEnd ?? 0,
      );
    }

    const placed = await prisma.task.findUniqueOrThrow({
      where: { id: follower.id },
    });
    created.push(placed);
    taskFor.set(step.templateId, placed);
  }

  return created;
```

- [ ] **Step 3: Update the file's doc comment**

The opening comment says "A catalogue entry can say it comes after another one".
Change that paragraph to say it can come after several, and that each leader
raises its own copy — one debriefing per thing being debriefed, not one
debriefing waiting on both.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: the only remaining errors are in `src/lib/catalogue/actions.ts`, fixed
in Part 4. `follow-db.ts` itself must be clean.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all pass (nothing unit-tests `follow-db.ts`; it is verified by script
in Task 11).

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan/follow-db.ts
git commit -m "feat: each leader raises its own copy of what comes after it"
```

---

#### Part 4 — Saving several leaders from the catalogue

**Files:**
- Modify: `src/lib/catalogue/actions.ts`
- Modify: `src/app/(app)/catalogue/page.tsx` (the entry query feeding the form)

**Interfaces:**
- Consumes: `wouldCycle`, `depthOf`, `MAX_CHAIN`, `FollowLink` from Part 1; `TemplateFollow` from Part 2.
- Produces: `saveCatalogueEntry` now reads `formData.getAll("leaderIds")`. The `CatalogueEntry` type gains `leaderIds: string[]` and loses `followsId` — Part 5 consumes both.

- [ ] **Step 1: Take a list in the schema**

In `src/lib/catalogue/actions.ts`, in the `Entry` zod object, replace:

```ts
  followsId: z.string().optional(),
```

with:

```ts
  /// The entries this one comes straight after. Several, because a debriefing
  /// can follow both the process and the LATAM process.
  leaderIds: z.array(z.string()).default([]),
```

and in the `Entry.safeParse({...})` call, replace:

```ts
      followsId: formData.get("followsId") || undefined,
```

with:

```ts
      leaderIds: formData.getAll("leaderIds").map(String).filter(Boolean),
```

- [ ] **Step 2: Validate every proposed link**

Replace the whole `if (input.followsId) { ... }` block with:

```ts
    /**
     * "Comes after" has to stay acyclic.
     *
     * A cycle would make chainFrom() walk for ever if it were not guarded, and
     * would describe a day nobody could ever start. Checked here, at the only
     * point a link is created, rather than defended at every point one is read.
     *
     * Each proposed link is checked against the set as it would be *after* the
     * save, not one at a time against the old set: two new leaders can be
     * individually harmless and together close a loop.
     */
    if (input.leaderIds.length > 0) {
      const leaders = await prisma.taskTemplate.findMany({
        where: { id: { in: input.leaderIds } },
        select: { id: true, departmentId: true },
      });
      if (leaders.length !== input.leaderIds.length) {
        return { error: t("errors.notInCatalogue") };
      }
      if (leaders.some((l) => l.departmentId !== input.departmentId)) {
        // The pair is done by one person, so it cannot span two departments.
        return { error: t("errors.followLeaderOtherDepartment") };
      }
      if (input.templateId && input.leaderIds.includes(input.templateId)) {
        return { error: t("errors.followsItself") };
      }

      const existing = await prisma.templateFollow.findMany({
        where: { follower: { departmentId: input.departmentId } },
        select: { followerId: true, leaderId: true },
      });

      // A new entry has no id yet, so it cannot be part of a cycle; only an
      // edit can close one. It can still be too deep, though.
      const id = input.templateId;
      const proposed: FollowLink[] = id
        ? [
            ...existing.filter((l) => l.followerId !== id),
            ...input.leaderIds.map((leaderId) => ({ followerId: id, leaderId })),
          ]
        : existing;

      if (id) {
        for (const leaderId of input.leaderIds) {
          if (wouldCycle(id, leaderId, existing.filter((l) => l.followerId !== id))) {
            return { error: t("errors.followWouldLoop") };
          }
        }
        if (depthOf(id, proposed) > MAX_CHAIN) {
          return { error: t("errors.followChainTooLong", MAX_CHAIN) };
        }
      } else {
        for (const leaderId of input.leaderIds) {
          if (depthOf(leaderId, proposed) >= MAX_CHAIN) {
            return { error: t("errors.followChainTooLong", MAX_CHAIN) };
          }
        }
      }
    }
```

- [ ] **Step 3: Stop writing the dead column**

In the `data` object, delete the line:

```ts
      followsId: input.followsId || null,
```

- [ ] **Step 4: Write the links after the template is saved**

Immediately after the `const template = input.templateId ? ... : ...` assignment,
add:

```ts
    /**
     * Replaced as a set rather than diffed: the form always submits the whole
     * list, so what is not in it was removed, and a delete-then-insert says
     * that in two lines instead of ten.
     */
    await prisma.$transaction([
      prisma.templateFollow.deleteMany({ where: { followerId: template.id } }),
      ...(input.leaderIds.length > 0
        ? [
            prisma.templateFollow.createMany({
              data: input.leaderIds.map((leaderId) => ({
                followerId: template.id,
                leaderId,
              })),
            }),
          ]
        : []),
    ]);
```

- [ ] **Step 5: Fix the import**

At the top of the file, the import from `@/lib/plan/follow` must now read:

```ts
import { depthOf, MAX_CHAIN, wouldCycle, type FollowLink } from "@/lib/plan/follow";
```

- [ ] **Step 6: Feed the form the new shape**

`src/app/(app)/catalogue/page.tsx:86` maps a template into the `CatalogueEntry`
shape with `followsId: tpl.followsId`. Replace that line with:

```ts
            leaderIds: tpl.leaders.map((l) => l.leaderId),
```

and include the relation in whichever `findMany` loads `tpl` — add to its
`include` (or `select`, matching whichever the query already uses):

```ts
        leaders: { select: { leaderId: true } },
```

If the query uses neither and takes the whole model, add an `include` with just
that relation.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: the only remaining errors are in
`src/app/(app)/catalogue/catalogue-form.tsx` and `catalogue-list.tsx`, fixed in
Part 5.

- [ ] **Step 8: Commit**

```bash
git add src/lib/catalogue/actions.ts "src/app/(app)/catalogue/page.tsx"
git commit -m "feat: a catalogue entry can be saved with several things before it"
```

---

#### Part 5 — Choosing several leaders in the form

**Files:**
- Modify: `src/app/(app)/catalogue/catalogue-form.tsx`
- Modify: `src/app/(app)/catalogue/catalogue-list.tsx` (wherever it reads `followsId`)
- Modify: `src/lib/i18n/dictionary.ts` (both `en` and `es`)

**Interfaces:**
- Consumes: `CatalogueEntry.leaderIds` from Part 4; `wouldCycle` and `FollowLink` from Part 1.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the strings, both languages**

In the `catalogue` group of `en`, add:

```ts
    comesAfterSeveral: "It can come after more than one — each one raises its own copy.",
```

and in `es`:

```ts
    comesAfterSeveral: "Puede ir después de más de una: cada una genera su propia copia.",
```

- [ ] **Step 2: Update the entry type**

In `catalogue-form.tsx`, in the `CatalogueEntry` type, replace:

```ts
  /** The entry this one comes straight after, when two jobs go hand in hand. */
  followsId: string | null;
```

with:

```ts
  /** The entries this one comes straight after. Each raises its own copy. */
  leaderIds: string[];
```

- [ ] **Step 3: Rebuild the options list on the graph**

Replace the `leaderOptions` memo with:

```ts
  /**
   * Which entries may be chosen as leaders.
   *
   * Itself is excluded, and so is anything already downstream of it -- picking
   * one of those would close a loop, and offering a choice the server is bound
   * to reject is worse than not offering it. The server checks again anyway:
   * this list was built when the form opened.
   *
   * Asked of wouldCycle rather than walked here, now that "downstream" can
   * arrive by more than one route.
   */
  const leaderOptions = useMemo(() => {
    const links: FollowLink[] = siblings.flatMap((s) =>
      s.leaderIds.map((leaderId) => ({ followerId: s.id, leaderId })),
    );
    return siblings
      .filter((s) => s.active)
      .filter((s) => !entry || (s.id !== entry.id && !wouldCycle(entry.id, s.id, links)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [siblings, entry]);
```

and add to the file's imports:

```ts
import { wouldCycle, type FollowLink } from "@/lib/plan/follow";
```

(`follow.ts` is pure — no `server-only`, no Prisma — so a client component may
import it.)

- [ ] **Step 4: Replace the select with a checkbox list**

Replace the `<label>` holding the `followsId` select with:

```tsx
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] text-muted">
            {t("catalogue.comesAfter")}
          </span>
          {leaderOptions.length === 0 ? (
            <p className="text-[12px] text-faint">
              {t("catalogue.comesAfterNothing")}
            </p>
          ) : (
            <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded border border-line bg-surface p-1.5">
              {leaderOptions.map((option) => (
                <label
                  key={option.id}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    name="leaderIds"
                    value={option.id}
                    defaultChecked={entry?.leaderIds.includes(option.id) ?? false}
                  />
                  {option.name}
                </label>
              ))}
            </div>
          )}
        </div>
```

and change the hint below it from `catalogue.comesAfterHint` to render both:

```tsx
        <p className="mt-1.5 text-[11.5px] text-muted">
          {t("catalogue.comesAfterHint")} {t("catalogue.comesAfterSeveral")}
        </p>
```

- [ ] **Step 5: Fix the list view**

`src/app/(app)/catalogue/catalogue-list.tsx:206-210` shows what an entry comes
after by looking one name up:

```tsx
              {entry.followsId && (
                  ...
                    entries.find((e) => e.id === entry.followsId)?.name ?? "—",
```

Change the condition to `entry.leaderIds.length > 0` and the lookup to join every
name, so an entry with two leaders says both:

```tsx
                    entry.leaderIds
                      .map((id) => entries.find((e) => e.id === id)?.name)
                      .filter(Boolean)
                      .join(", ") || "—",
```

Keep the surrounding markup exactly as it is — only the condition and the
expression that produces the name change.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: **no errors anywhere.** This is the step that closes the window opened
in Part 1.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: See it working**

Run `npm run dev` and open the catalogue as a MANAGER. Create or edit an entry,
tick two leaders, save. Expected: it saves. Reopen it — both are still ticked.
Then try to tick a leader that would loop: it should not be offered, and if you
force it (by editing the two entries in the other order) the server refuses with
the loop message.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/catalogue" src/lib/i18n/dictionary.ts
git commit -m "feat: pick more than one thing a task comes after"
```

---

### Task 11: Proving it end to end

**Files:**
- Modify: `scripts/verify-follow.ts`

**Interfaces:**
- Consumes: everything from Tasks 3, 4 and 10.
- Produces: nothing.

**Why a script and not a test.** Vitest never touches Postgres in this project.
What only a database can show is that two leaders really do raise two distinct
debriefings with the right titles and the right links, and that a follower whose
leader is in flight stays with its owner.

- [ ] **Step 1: Move the existing setup to the join table**

In `scripts/verify-follow.ts`, the catalogue it builds (review → report → file,
plus gantt off review) currently sets `followsId` on create. Replace each of those
with an explicit link after the templates exist, e.g.:

```ts
  await prisma.templateFollow.createMany({
    data: [
      { followerId: report.id, leaderId: review.id },
      { followerId: file.id, leaderId: report.id },
      { followerId: gantt.id, leaderId: review.id },
    ],
  });
```

- [ ] **Step 2: Add the two-leader case**

After the existing checks, add:

```ts
  // ------------------------------------------- a debriefing with two leaders
  const proceso = await prisma.taskTemplate.create({
    data: { name: `${MARK} proceso`, estimatedMinutes: 60, departmentId },
  });
  const latam = await prisma.taskTemplate.create({
    data: { name: `${MARK} proceso latam`, estimatedMinutes: 60, departmentId },
  });
  const debrief = await prisma.taskTemplate.create({
    data: { name: `${MARK} debriefing`, estimatedMinutes: 30, departmentId },
  });
  await prisma.templateFollow.createMany({
    data: [
      { followerId: debrief.id, leaderId: proceso.id },
      { followerId: debrief.id, leaderId: latam.id },
    ],
  });

  const procesoTask = await prisma.task.create({
    data: {
      externalKey: `${MARK}proceso`,
      title: proceso.name,
      estimatedMinutes: 60,
      dueDate: today,
      departmentId,
      templateId: proceso.id,
      assigneeId: user.id,
      status: "ASSIGNED",
      scheduledDate: today,
    },
  });
  const latamTask = await prisma.task.create({
    data: {
      externalKey: `${MARK}latam`,
      title: latam.name,
      estimatedMinutes: 60,
      dueDate: today,
      departmentId,
      templateId: latam.id,
      assigneeId: user.id,
      status: "ASSIGNED",
      scheduledDate: today,
    },
  });

  const fromProceso = await createFollowers(procesoTask);
  const fromLatam = await createFollowers(latamTask);

  check(
    "each leader raises its own debriefing",
    fromProceso.length === 1 && fromLatam.length === 1,
    `${fromProceso.length} from proceso, ${fromLatam.length} from latam`,
  );

  check(
    "they are two different tasks",
    fromProceso[0]?.id !== fromLatam[0]?.id,
    `${fromProceso[0]?.id} vs ${fromLatam[0]?.id}`,
  );

  check(
    "each follows the leader that raised it",
    fromProceso[0]?.followsTaskId === procesoTask.id &&
      fromLatam[0]?.followsTaskId === latamTask.id,
    `${fromProceso[0]?.followsTaskId} / ${fromLatam[0]?.followsTaskId}`,
  );

  check(
    "the titles say which is which",
    fromProceso[0]?.title.endsWith(proceso.name) === true &&
      fromLatam[0]?.title.endsWith(latam.name) === true,
    `"${fromProceso[0]?.title}" / "${fromLatam[0]?.title}"`,
  );

  check(
    "re-running raises no more of them",
    (await createFollowers(procesoTask)).length === 0,
    "second call created nothing",
  );
```

Make sure the cleanup at the end of the script deletes these too — it matches on
`MARK`, so as long as every name and externalKey created here carries `MARK` it
is already covered. Verify that by reading the cleanup block.

- [ ] **Step 3: Add the in-flight-leader case**

This is Task 4's regression check. After the block above, add:

```ts
  // --------------------------------- a follower whose leader is being done
  await prisma.task.update({
    where: { id: procesoTask.id },
    data: { status: "IN_PROGRESS", scheduledStart: 8 * 60, scheduledEnd: 9 * 60 },
  });

  const strandedBefore = await prisma.task.findUniqueOrThrow({
    where: { id: fromProceso[0].id },
  });
  await prisma.task.update({
    where: { id: strandedBefore.id },
    data: { assigneeId: null, status: "UNASSIGNED", scheduledDate: null },
  });

  const { runSchedule } = await import("../src/lib/scheduling/run");
  await runSchedule({ from: today, to: today, departmentId });

  const strandedAfter = await prisma.task.findUniqueOrThrow({
    where: { id: strandedBefore.id },
  });

  check(
    "a follower stays with the person doing its leader",
    strandedAfter.assigneeId === user.id,
    `assigned to ${strandedAfter.assigneeId}, leader is ${user.id}`,
  );

  check(
    "and does not start before it",
    strandedAfter.scheduledStart === null || strandedAfter.scheduledStart >= 9 * 60,
    `starts at ${strandedAfter.scheduledStart}, leader ends at ${9 * 60}`,
  );
```

- [ ] **Step 4: Run it**

Run:
```bash
npm run db:start
npx tsx scripts/verify-follow.ts
```
Expected: every check reports `ok`, and the script cleans up after itself. If the
in-flight checks fail, the fault is in Task 4's `detached` map, not here.

- [ ] **Step 5: Run every verify script**

Run:
```bash
npx tsx scripts/verify-anchors.ts
npx tsx scripts/verify-concurrency.ts
npx tsx scripts/verify-gaps.ts
npx tsx scripts/verify-sessions.ts
```
Expected: all `ok`. `verify-anchors.ts` also references `follows` and may need
the same join-table change as Step 1; if it fails to compile, apply it there too
and note that in the commit.

- [ ] **Step 6: Run the whole suite one last time**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-follow.ts scripts/verify-anchors.ts
git commit -m "test: two leaders raise two debriefings, and a live leader keeps its follower"
```

---

### Task 12: Say it in the README

**Files:**
- Modify: `README.md`

**Interfaces:** none.

The README's "What it does" list is the project's own description of its
behaviour, and two of its bullets are now wrong.

- [ ] **Step 1: Update the pairing bullet**

Find the bullet beginning "**Keeps work that goes hand in hand together.**" It
currently says "A catalogue entry can say it comes after another." Change that
sentence to say an entry can come after several, and that each one brings its own
copy — you debrief the process after the process and the LATAM process after the
LATAM process, rather than one debriefing waiting on both.

- [ ] **Step 2: Add a bullet for reports**

After the "**Records mistakes as P1Ns.**" bullet, add one in the same voice, about
two sentences: a report button on every page for a bug or a suggestion, which
attaches where you were, who you are and what was running, so filing one costs a
sentence; and the list readable from the app or the command line.

- [ ] **Step 3: Check the assign description still tells the truth**

Read the "**Assigns it automatically.**" bullet. It describes capacity as a hard
constraint with must-do work as the exception — which is now true in a way it
was not before Task 1. Leave it if it reads correctly; if it implies routines
and single tasks were already ranked together, no change is needed either.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: several things before a task, and the report button"
```

---

## Self-Review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| `TemplateFollow` join table, backfill, drop column | 10 (Part 2) |
| Instance model unchanged (`Task.followsTaskId` single) | 10 (Parts 2, 3 — explicitly not touched) |
| `buildFollowKey` unchanged; two leaders → two tasks | 10 (Part 3), verified 11 |
| Title suffixed only when 2+ leaders | 10 (Part 3), verified 11 |
| `chainFrom` returns the real parent | 10 (Parts 1, 3) |
| `wouldCycle` walks all parents | 10 (Part 1) |
| `depthOf` longest path | 10 (Part 1) |
| `MAX_CHAIN` stays 5 | 10 (Part 1, unchanged) |
| Catalogue multi-select, cycle/depth refused at save | 10 (Parts 4, 5) |
| `Report` model with auto-captured context | 5 |
| Bug/Suggestion toggle, one textarea, every page, every role | 7 |
| `npm run bugs` with all/bugs/ideas/show/close | 8 |
| `/admin/reports`, ADMIN only | 9 |
| Body validated: trimmed, non-empty, ≤4000 | 6 |
| `closedById` null for a CLI close | 5, 6 |
| Defect 1 — priority across groups and singles | 1 |
| Defect 2 — deadline with no start | 2 |
| Defect 3 — orphaned follower | 3 (pure), 4 (wiring) |
| Rotation window recorded, not fixed | spec only — correctly no task |
| Sequencing: Part A before Part C | plan order |

No gaps.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N".
Two steps are conditional on what the engineer finds rather than prescriptive —
B4 Step 3 (`server-only` in `src/lib/db.ts`) and C6 Step 5 (`verify-anchors.ts`) —
and both state the exact alternative to apply and what to record. B2 Step 7
likewise gives the exact key and both translations to add if missing.

**Type consistency.** `FollowLink` is `{ followerId, leaderId }` in C1, C4 and C5;
`ChainStep` is `{ templateId, afterTemplateId }` in C1 and consumed under those
names in C3. `notBeforeMinutes` is spelled identically in A3 (`TaskInput`),
A3's tests, and A4's `taskInputs` mapper. `ReportState` is `{ error?, sent? }` in
B2 and destructured as `state.error` / `state.sent` in B3 and B5. `listReports`,
`findReport` and `closeByNumber` are defined in B2 and called under exactly those
names in B4. `CatalogueEntry.leaderIds` is `string[]` in C4 and C5.
