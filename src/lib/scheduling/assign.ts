import type { Availability, DayAnchor, Window } from "./availability";
import {
  ANCHOR_ORDER,
  anchorPacksBackward,
  collapseAnchor,
  dayHasBreak,
  findLastSlot,
  findSlot,
  resolveAnchor,
  subtractWindows,
} from "./availability";
import {
  anchorFallbackWindows,
  halfWindows,
  intersect,
  type ShiftHalf,
} from "./half";
import { dateKey } from "@/lib/time";

/**
 * Who gets what.
 *
 * Capacity is a hard constraint: a task is only ever offered to someone who
 * has room for it that day. Rotation is the ranking rule *within* the people
 * who qualify -- whoever has done this job least, and least recently, goes
 * first. That combination is what stops the engine either overloading one
 * person or letting the same person own the same chore forever.
 *
 * Everything here is pure. The caller loads the data and writes the results.
 */

export type CandidateInput = {
  userId: string;
  departmentId: string;
  availability: Availability;
  /** Minutes already committed on this date, from tasks the engine won't move. */
  committedMinutes: number;
  /** Windows already taken by immovable work, removed before placement. */
  busy: Window[];
};

export type Priority = "MUST" | "NORMAL" | "SPARE_TIME";

/** Lower sorts first. */
const PRIORITY_RANK: Record<Priority, number> = {
  MUST: 0,
  NORMAL: 1,
  SPARE_TIME: 2,
};

export type TaskInput = {
  id: string;
  departmentId: string;
  estimatedMinutes: number;
  /** MUST is placed first and never dropped; SPARE_TIME only fills leftovers. */
  priority?: Priority;
  /** Null for one-offs -- meeting actions, sheet rows, ad-hoc work. */
  templateId: string | null;
  /** Named in the meeting: skips ranking entirely. */
  pinnedAssigneeId?: string | null;
  fixedStartMinutes?: number | null;
  fixedEndMinutes?: number | null;
  /**
   * A point in the working day rather than a clock time. Resolved against
   * whichever candidate is being considered, since "on arrival" is a different
   * time for each of them.
   */
  anchor?: DayAnchor | null;
  /**
   * Tasks sharing a key are one person's routine for the day and are assigned
   * together -- the four checks on a shift belong to whoever is on that shift,
   * not to four different people.
   */
  groupKey?: string | null;
  /**
   * Keep this one in the morning or the afternoon. A catalogue preference,
   * split at one company-wide clock time -- see half.ts. An anchor overrides
   * it, being the more specific statement about where in the day it goes.
   */
  shiftHalf?: ShiftHalf | null;
  /**
   * The task this one comes straight after. Two jobs that go hand in hand --
   * review the portals, then write the report -- share a groupKey so one person
   * gets both, and this says which way round they go.
   */
  followsTaskId?: string | null;
  /**
   * The earliest minute this may start.
   *
   * Set when the thing it comes after is not in this run -- somebody is doing
   * it right now, so the engine will not move it, and it is therefore invisible
   * to the placement below. Without this floor the follower first-fits into the
   * morning and the pair reads backwards.
   */
  notBeforeMinutes?: number | null;
};

export type RotationInput = {
  templateId: string;
  userId: string;
  /** Times given the job. Fairness ranks on this, not on completions. */
  assignedCount: number;
  lastAssignedAt: Date | null;
};

/** How many one-off tasks each person picked up recently, for the fallback. */
export type OneOffLoadInput = { userId: string; count: number };

export type Assignment = {
  taskId: string;
  userId: string;
  date: Date;
  /** Null when a must-do task had to go to an already-full day. */
  start: number | null;
  end: number | null;
  /** True when it was placed past the person's capacity. */
  overCapacity?: boolean;
};

export type Unassigned = {
  taskId: string;
  reason:
    | "no-one-in-department"
    | "no-capacity"
    | "no-slot-fits"
    /**
     * Nobody in the department has a single working stretch long enough to
     * hold it, whatever else is on. This one should have been split into
     * sittings -- see lib/plan/sessions.ts.
     *
     * Told apart from "no-slot-fits", which means a day that merely happened
     * to be too fragmented today. The two look identical in the schedule and
     * want completely different fixes.
     */
    | "needs-splitting"
    | "pinned-person-unavailable";
};

/**
 * A repetition of a routine that its person's day has no room in time for.
 *
 * A routine anchored around a break fires four times: on arrival, before the
 * break, after it, before leaving. Whoever ends up with it on a day with no
 * break has only two of those points, so the middle two fold onto the ends --
 * and where a sibling is already sitting on the end, the repetition is not
 * work, it is a duplicate.
 */
export type Collapsed = {
  taskId: string;
  /**
   * The anchor it should carry instead, or null when a sibling already covers
   * that point and this repetition should not happen at all today.
   */
  into: DayAnchor | null;
};

export type AssignResult = {
  assignments: Assignment[];
  unassigned: Unassigned[];
  collapsed: Collapsed[];
};

type WorkingCandidate = CandidateInput & {
  free: Window[];
  remaining: number;
};

/**
 * Rotation ranking. Lower sorts first.
 *
 * Order: fewest times given this template, then longest since they last had
 * it, then lightest current load, then user id. The final tie-break is
 * arbitrary but *stable*, which is what makes re-running the engine produce
 * the same answer instead of reshuffling the schedule under people.
 */
function compareForTask(
  a: WorkingCandidate,
  b: WorkingCandidate,
  task: TaskInput,
  rotation: Map<string, RotationInput>,
  oneOffLoad: Map<string, number>,
): number {
  if (task.templateId) {
    const ra = rotation.get(`${task.templateId}:${a.userId}`);
    const rb = rotation.get(`${task.templateId}:${b.userId}`);

    const countA = ra?.assignedCount ?? 0;
    const countB = rb?.assignedCount ?? 0;
    if (countA !== countB) return countA - countB;

    // Never assigned counts as longest-ago, so newcomers get a turn.
    const lastA = ra?.lastAssignedAt?.getTime() ?? 0;
    const lastB = rb?.lastAssignedAt?.getTime() ?? 0;
    if (lastA !== lastB) return lastA - lastB;
  } else {
    // One-offs have no template history, so fairness falls back to how many
    // one-offs each person has absorbed lately.
    const loadA = oneOffLoad.get(a.userId) ?? 0;
    const loadB = oneOffLoad.get(b.userId) ?? 0;
    if (loadA !== loadB) return loadA - loadB;
  }

  // Lightest day wins, so work spreads rather than piling on one person.
  const usedA = a.availability.availableMinutes - a.remaining;
  const usedB = b.availability.availableMinutes - b.remaining;
  if (usedA !== usedB) return usedA - usedB;

  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

function claim(candidate: WorkingCandidate, slot: Window): void {
  candidate.free = subtractWindows(candidate.free, [slot]);
  candidate.remaining -= slot.end - slot.start;
}

/** Book time that exceeds the day, so later tasks see the true load. */
function claimOverflow(
  candidate: WorkingCandidate,
  minutes: number,
  slot: Window | null,
): void {
  if (slot) candidate.free = subtractWindows(candidate.free, [slot]);
  candidate.remaining -= minutes;
}

/**
 * Assign one day's tasks.
 *
 * Tasks with a fixed window go first, because their placement is the least
 * negotiable. The rest are placed longest-first: big jobs are the hardest to
 * fit, so giving them first pick of the day wastes less capacity than letting
 * a pile of short tasks fragment it.
 */
export function assignDay(input: {
  date: Date;
  tasks: TaskInput[];
  candidates: CandidateInput[];
  rotation?: RotationInput[];
  oneOffLoad?: OneOffLoadInput[];
  /**
   * Points in the day already held by work this run is not scheduling --
   * a repetition somebody has already done, or is doing now. Only used when
   * folding a routine onto a day with no break, where it is the difference
   * between dropping a repetition and moving it on top of another one.
   */
  occupiedAnchors?: { groupKey: string; anchor: DayAnchor }[];
}): AssignResult {
  const rotation = new Map<string, RotationInput>();
  for (const row of input.rotation ?? []) {
    rotation.set(`${row.templateId}:${row.userId}`, row);
  }

  const oneOffLoad = new Map<string, number>();
  for (const row of input.oneOffLoad ?? []) oneOffLoad.set(row.userId, row.count);

  const working: WorkingCandidate[] = input.candidates.map((c) => ({
    ...c,
    free: subtractWindows(c.availability.windows, c.busy),
    remaining: Math.max(0, c.availability.availableMinutes - c.committedMinutes),
  }));

  const assignments: Assignment[] = [];
  const unassigned: Unassigned[] = [];
  const collapsed: Collapsed[] = [];

  /**
   * Taking the job counts for rotation immediately, so a second identical
   * task the same day goes to the next person rather than the same one.
   */
  const creditRotation = (task: TaskInput, userId: string) => {
    if (task.templateId) {
      const key = `${task.templateId}:${userId}`;
      const existing = rotation.get(key);
      rotation.set(key, {
        templateId: task.templateId,
        userId,
        assignedCount: (existing?.assignedCount ?? 0) + 1,
        lastAssignedAt: input.date,
      });
    } else {
      oneOffLoad.set(userId, (oneOffLoad.get(userId) ?? 0) + 1);
    }
  };

  /**
   * Where a task wants to start for this particular person. An anchor is a
   * point in *their* day, so it cannot be resolved until the candidate is
   * known; an anchor their day has no room for (no break, so no "after the
   * break") falls through to flexible placement rather than dropping the task.
   */
  const wantedStart = (
    task: TaskInput,
    candidate: WorkingCandidate,
  ): number | null => {
    if (task.anchor) {
      return resolveAnchor(
        task.anchor,
        candidate.availability.windows,
        task.estimatedMinutes,
      );
    }
    return task.fixedStartMinutes ?? null;
  };

  /**
   * The free time a task is actually allowed to use.
   *
   * An anchor is a starting point -- wantedStart says *when* -- but it is also
   * a bound, and that half was the missing half of the rule. findSlot() walks
   * on into later windows when the one it starts in is full, so "antes del
   * descanso" resolved to 13:30, found the morning taken, and carried on into
   * the afternoon to land at 16:30. Before the break, after the break.
   *
   * An anchor wins over a shift preference when both are set: it is the more
   * specific statement and already implies a half.
   */
  const allowedFree = (
    task: TaskInput,
    candidate: WorkingCandidate,
  ): Window[] => {
    if (task.anchor) {
      return intersect(
        candidate.free,
        anchorFallbackWindows(candidate.availability.windows, task.anchor),
      );
    }
    if (task.shiftHalf) {
      return intersect(
        candidate.free,
        halfWindows(candidate.availability.windows, task.shiftHalf),
      );
    }
    return candidate.free;
  };

  const placeFor = (
    task: TaskInput,
    candidate: WorkingCandidate,
  ): Window | null => {
    const free = allowedFree(task, candidate);
    const limit = task.fixedEndMinutes ?? Infinity;

    /**
     * A deadline anchor packs backwards from the boundary, not forwards from
     * the start of its half. Aiming it with wantedStart only positions the
     * first one; the second finds that minute taken and first-fits to the top
     * of the morning, which is how three "antes del descanso" tasks ended up
     * at 10:00, 10:40 and 13:30.
     *
     * Searching from the end instead makes them stack against the break in
     * the order they were placed, which is what the anchor actually asks for.
     */
    if (task.anchor && anchorPacksBackward(task.anchor)) {
      return findLastSlot(
        free,
        task.estimatedMinutes,
        limit,
        task.notBeforeMinutes ?? 0,
      );
    }

    const floor = task.notBeforeMinutes ?? null;

    const from = wantedStart(task, candidate);
    const start = from == null ? floor : floor == null ? from : Math.max(from, floor);

    if (start == null) {
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

    const slot = findSlot(free, task.estimatedMinutes, start);
    if (!slot) return null;
    return slot.end <= limit ? slot : null;
  };

  /**
   * Where a task may go when its own point in the day is already taken.
   *
   * Bounded rather than "anywhere". An unbounded first-fit is how a task called
   * "antes de salir" ended up at 10:00: the end of the shift was full, first-fit
   * found the morning, and the day then contradicted the task's own name.
   * Nothing fitting in the right half means it stays unplaced and the day reads
   * as over, which is what already happens to any work that will not fit.
   */
  const fallbackFor = (
    task: TaskInput,
    candidate: WorkingCandidate,
  ): Window | null => {
    const free = allowedFree(task, candidate);
    const limit = task.fixedEndMinutes ?? Infinity;
    const floor = task.notBeforeMinutes ?? 0;

    /**
     * A deadline binds even when the task's point in the day is already taken.
     *
     * Without this, a task with only a deadline that couldn't fit at its
     * intended anchor would be fallback-placed at whatever first-fits, even
     * past its deadline. A deadline honoured by the main path and ignored by
     * the fallback is not honoured at all -- what mattered was that placeFor
     * now returns null for deadline reasons, making this fallback reachable.
     */
    // Same rule as placeFor: a deadline anchor searches from the end of its
    // half. Falling back forwards is what the bound was added to prevent.
    if (task.anchor && anchorPacksBackward(task.anchor)) {
      return findLastSlot(free, task.estimatedMinutes, limit, floor);
    }
    const slot = findSlot(free, task.estimatedMinutes, floor);
    return slot && slot.end <= limit ? slot : null;
  };

  const orderTasks = (tasks: TaskInput[]) =>
    [...tasks].sort((a, b) => {
      // A fixed window is a placement constraint, not a statement of
      // importance, so those still go first -- otherwise a must-do flexible
      // task eats the hour a fixed meeting needs.
      const aFixed = a.fixedStartMinutes != null || a.anchor != null;
      const bFixed = b.fixedStartMinutes != null || b.anchor != null;
      if (aFixed !== bFixed) return aFixed ? -1 : 1;
      if (aFixed && bFixed) {
        /**
         * A real clock time beats an anchor, always.
         *
         * This used to sort anchors on ANCHOR_ORDER * 1e4, meaning to push
         * them past any minute-of-day -- but ARRIVAL is 0, so 0 * 1e4 sorted
         * every "al llegar" task ahead of a 09:00 one. The arrivals took the
         * morning and the fixed task was pushed behind them, which is the one
         * collision this comparison exists to decide.
         *
         * Note this is placement order, not time order: placing an 18:00 task
         * first does not consume the morning, because placeFor() searches from
         * the task's own wanted start.
         */
        const aAtClock = a.fixedStartMinutes != null;
        const bAtClock = b.fixedStartMinutes != null;
        if (aAtClock !== bAtClock) return aAtClock ? -1 : 1;

        if (aAtClock && bAtClock) {
          const byClock = a.fixedStartMinutes! - b.fixedStartMinutes!;
          if (byClock !== 0) return byClock;
        } else if (a.anchor && b.anchor) {
          const byAnchor = ANCHOR_ORDER[a.anchor] - ANCHOR_ORDER[b.anchor];
          if (byAnchor !== 0) return byAnchor;
        }
      }

      const rankA = PRIORITY_RANK[a.priority ?? "NORMAL"];
      const rankB = PRIORITY_RANK[b.priority ?? "NORMAL"];
      if (rankA !== rankB) return rankA - rankB;

      if (a.estimatedMinutes !== b.estimatedMinutes) {
        return b.estimatedMinutes - a.estimatedMinutes;
      }
      return a.id < b.id ? -1 : 1;
    });

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

  /**
   * Leaders before their followers.
   *
   * orderTasks() sorts by importance and size, which says nothing about which
   * half of a pair comes first. placeAll() reads each member's leader end time
   * out of a map as it goes, so a follower arriving before its leader would
   * find nothing there and fall back to first-fit. Anything whose leader is not
   * in this group -- it was never linked, or the leader is somebody else's --
   * keeps its place, so this is a no-op for every group that is not a chain.
   */
  function orderChain(members: TaskInput[]): TaskInput[] {
    const inGroup = new Set(members.map((m) => m.id));
    const remaining = [...members];
    const placed = new Set<string>();
    const out: TaskInput[] = [];

    while (remaining.length > 0) {
      const index = remaining.findIndex(
        (m) =>
          !m.followsTaskId ||
          !inGroup.has(m.followsTaskId) ||
          placed.has(m.followsTaskId),
      );
      // Everything left is waiting on something in a cycle: emit as-is rather
      // than looping. A cycle is a catalogue fault, not a reason to drop work.
      if (index === -1) {
        out.push(...remaining);
        break;
      }
      const [next] = remaining.splice(index, 1);
      placed.add(next.id);
      out.push(next);
    }

    return out;
  }

  /**
   * Give a whole routine to one person: the first, by the usual ranking, with
   * room for all of it.
   */
  /**
   * What this routine actually amounts to in one person's day.
   *
   * Resolved per candidate rather than once for the group, because whether
   * there is a break to anchor to is a fact about the person's shift: chao has
   * none on a Monday, santi does. Ranking on the uncollapsed total would ask
   * for four repetitions' worth of room to do two, and report nobody free on a
   * day that had plenty.
   */
  function collapseFor(
    members: TaskInput[],
    candidate: WorkingCandidate,
  ): { keep: TaskInput[]; collapsed: Collapsed[] } {
    if (dayHasBreak(candidate.availability.windows)) {
      return { keep: members, collapsed: [] };
    }

    // The anchors that survive on their own terms claim their point first, so
    // a folded repetition never displaces the real "al llegar".
    const taken = new Set<DayAnchor>();
    for (const m of members) {
      if (m.anchor && collapseAnchor(m.anchor) === m.anchor) taken.add(m.anchor);
    }

    /**
     * Points in the day already held by work this run is not scheduling.
     *
     * A repetition that has been done, or is running, is not in the pool --
     * the engine leaves finished work alone. Folding without it made the
     * afternoon check believe arrival was free, so it moved there instead of
     * dropping, and the day ended up with the same "al llegar" twice.
     */
    const group = members[0]?.groupKey;
    if (group) {
      for (const held of input.occupiedAnchors ?? []) {
        if (held.groupKey === group) taken.add(held.anchor);
      }
    }

    const keep: TaskInput[] = [];
    const collapsed: Collapsed[] = [];

    for (const m of members) {
      if (!m.anchor) {
        keep.push(m);
        continue;
      }
      const into = collapseAnchor(m.anchor);
      if (into === m.anchor) {
        keep.push(m);
        continue;
      }
      if (taken.has(into)) {
        collapsed.push({ taskId: m.id, into: null });
        continue;
      }
      taken.add(into);
      collapsed.push({ taskId: m.id, into });
      keep.push({ ...m, anchor: into });
    }

    return { keep, collapsed };
  }

  function minutesFor(members: TaskInput[]): number {
    return members.reduce((s, t) => s + t.estimatedMinutes, 0);
  }

  function assignGroup(members: TaskInput[]): void {
    const first = members[0];

    const inDepartment = working.filter(
      (c) => c.departmentId === first.departmentId,
    );
    if (inDepartment.length === 0) {
      for (const m of members) {
        unassigned.push({ taskId: m.id, reason: "no-one-in-department" });
      }
      return;
    }

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

    const ranked = [...inDepartment]
      .filter((c) => c.remaining >= minutesFor(collapseFor(members, c).keep))
      .sort((a, b) => compareForTask(a, b, first, rotation, oneOffLoad));

    const target = ranked[0];
    if (!target) {
      // Splitting the routine across people would defeat the point, so it
      // stays together and either overloads a day visibly or waits.
      if ((first.priority ?? "NORMAL") === "MUST") {
        const fallback = [...inDepartment].sort((a, b) =>
          compareForTask(a, b, first, rotation, oneOffLoad),
        )[0];
        if (fallback) {
          placeGroup(members, fallback, true);
          return;
        }
      }
      for (const m of members) {
        unassigned.push({ taskId: m.id, reason: "no-capacity" });
      }
      return;
    }

    placeGroup(members, target, false);
  }

  /**
   * Fold the routine into the day it is going to, recording what fell away so
   * the caller can take those repetitions off the calendar.
   */
  function collapseInto(
    members: TaskInput[],
    candidate: WorkingCandidate,
  ): TaskInput[] {
    const { keep, collapsed: folded } = collapseFor(members, candidate);
    collapsed.push(...folded);
    return keep;
  }

  /**
   * Place a routine, unless folding left nothing of it.
   *
   * A whole group can fold away: every repetition of a two-point routine can
   * already be done on a day with no break. There is then nothing to place and
   * nobody to credit -- and placeAll reads members[0] for the rotation, which
   * is what made that case a crash rather than a no-op.
   */
  function placeGroup(
    members: TaskInput[],
    candidate: WorkingCandidate,
    overCapacity: boolean,
  ): void {
    const keep = collapseInto(members, candidate);
    if (keep.length === 0) return;
    placeAll(keep, candidate, overCapacity);
  }

  function placeAll(
    members: TaskInput[],
    candidate: WorkingCandidate,
    overCapacity: boolean,
  ): void {
    /** Where each member of this group ended up, for the ones that follow it. */
    const endOf = new Map<string, number>();

    for (const task of members) {
      /**
       * A follower starts no earlier than the thing it follows finished.
       *
       * Without this the first-fit below would happily drop the report into a
       * gap earlier in the morning than the review it reports on, and the pair
       * would read backwards -- which the ordering rule would then refuse to
       * let anybody start.
       */
      /**
       * Its leader's end when the leader is in this group, and otherwise the
       * floor the caller set for it -- which is the same fact, for a leader
       * this run is not placing.
       */
      const after =
        (task.followsTaskId ? endOf.get(task.followsTaskId) : undefined) ??
        task.notBeforeMinutes ??
        undefined;

      // Its own point in the day first, then anywhere in the right half of it
      // that still fits -- a check that cannot sit exactly where it belongs is
      // still worth doing, but not at a time that contradicts its own name.
      const slot =
        after != null
          ? findSlot(allowedFree(task, candidate), task.estimatedMinutes, after)
          : (placeFor(task, candidate) ?? fallbackFor(task, candidate));

      if (slot) claim(candidate, slot);
      else candidate.remaining -= task.estimatedMinutes;

      if (slot) endOf.set(task.id, slot.end);

      assignments.push({
        taskId: task.id,
        userId: candidate.userId,
        date: input.date,
        start: slot?.start ?? null,
        end: slot?.end ?? null,
        ...(overCapacity ? { overCapacity: true } : {}),
      });
    }

    // Credited once for the whole routine. Counting each repetition would make
    // a four-times-daily task look four times as "owed" as a daily one and
    // skew the rotation for every other task in the department.
    creditRotation(members[0], candidate.userId);
  }

  function assignSingle(task: TaskInput): void {
    const place = (candidate: WorkingCandidate): Window | null => {
      if (candidate.remaining < task.estimatedMinutes) return null;
      return placeFor(task, candidate);
    };

    // Pinned by a meeting: that person or nobody.
    if (task.pinnedAssigneeId) {
      const pinned = working.find((c) => c.userId === task.pinnedAssigneeId);
      const slot = pinned ? place(pinned) : null;
      if (pinned && slot) {
        claim(pinned, slot);
        assignments.push({
          taskId: task.id,
          userId: pinned.userId,
          date: input.date,
          start: slot.start,
          end: slot.end,
        });
      } else {
        unassigned.push({ taskId: task.id, reason: "pinned-person-unavailable" });
      }
      return;
    }

    const inDepartment = working.filter(
      (c) => c.departmentId === task.departmentId,
    );
    if (inDepartment.length === 0) {
      unassigned.push({ taskId: task.id, reason: "no-one-in-department" });
      return;
    }

    const withCapacity = inDepartment.filter(
      (c) => c.remaining >= task.estimatedMinutes,
    );

    /**
     * Must-do work is never dropped. Whether the day is full or merely too
     * fragmented to hold it in one stretch, somebody gets it and their day
     * reads as over -- an overload people can see beats work nobody knows
     * was silently abandoned.
     */
    const forceOnSomebody = () => {
      const ranked = [...inDepartment].sort((a, b) =>
        compareForTask(a, b, task, rotation, oneOffLoad),
      );
      const target =
        ranked.find((c) => c.availability.availableMinutes > 0) ?? ranked[0];
      if (!target) return false;

      /**
       * Take a slot if one exists, even on a smaller-than-ideal day -- but
       * still only in the half the task belongs to. Must-do work is never
       * dropped, and a null slot is how that is expressed: it keeps its owner
       * and their day reads as over. Placing it at an hour that contradicts
       * its own anchor would not be keeping the promise, only hiding it.
       */
      const slot = fallbackFor(task, target);
      claimOverflow(target, task.estimatedMinutes, slot);
      assignments.push({
        taskId: task.id,
        userId: target.userId,
        date: input.date,
        start: slot?.start ?? null,
        end: slot?.end ?? null,
        overCapacity: true,
      });
      creditRotation(task, target.userId);
      return true;
    };

    /**
     * Would it have fitted on a completely empty day?
     *
     * If the longest working stretch anybody has is shorter than the task,
     * then no amount of clearing calendars will help and the job wants
     * cutting into sittings instead. Worth telling apart from a full or
     * fragmented day, because those two read as bad luck and this one is a
     * standing fact about the work.
     *
     * Checked against both failure branches: a ten-hour job on a seven-hour
     * day runs out of capacity before it ever reaches the placement loop, and
     * that is precisely the case this exists to name.
     */
    const longestStretch = Math.max(
      0,
      ...inDepartment.flatMap((c) =>
        c.availability.windows.map((w) => w.end - w.start),
      ),
    );
    const tooLongForAnybody = longestStretch < task.estimatedMinutes;

    if (withCapacity.length === 0) {
      if ((task.priority ?? "NORMAL") === "MUST" && forceOnSomebody()) return;
      unassigned.push({
        taskId: task.id,
        reason: tooLongForAnybody ? "needs-splitting" : "no-capacity",
      });
      return;
    }

    const ranked = [...withCapacity].sort((a, b) =>
      compareForTask(a, b, task, rotation, oneOffLoad),
    );

    let placed = false;
    for (const candidate of ranked) {
      const slot = place(candidate);
      if (!slot) continue;

      claim(candidate, slot);
      assignments.push({
        taskId: task.id,
        userId: candidate.userId,
        date: input.date,
        start: slot.start,
        end: slot.end,
      });

      creditRotation(task, candidate.userId);
      placed = true;
      break;
    }

    if (!placed) {
      if ((task.priority ?? "NORMAL") === "MUST" && forceOnSomebody()) return;
      unassigned.push({
        taskId: task.id,
        reason: tooLongForAnybody ? "needs-splitting" : "no-slot-fits",
      });
    }
  }

  for (const unit of units) {
    if (unit.grouped) assignGroup(orderChain(unit.members));
    else assignSingle(unit.members[0]);
  }

  return { assignments, unassigned, collapsed };
}

/** Convenience for callers working a date range rather than a single day. */
export function groupTasksByDueDate<T extends { dueDate: Date }>(
  tasks: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const task of tasks) {
    const key = dateKey(task.dueDate);
    const list = map.get(key);
    if (list) list.push(task);
    else map.set(key, [task]);
  }
  return map;
}
