import type { Availability, Window } from "./availability";
import { findSlot } from "./availability";
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

export type TaskInput = {
  id: string;
  departmentId: string;
  estimatedMinutes: number;
  /** Null for one-offs -- meeting actions, sheet rows, ad-hoc work. */
  templateId: string | null;
  /** Named in the meeting: skips ranking entirely. */
  pinnedAssigneeId?: string | null;
  fixedStartMinutes?: number | null;
  fixedEndMinutes?: number | null;
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
  start: number;
  end: number;
};

export type Unassigned = {
  taskId: string;
  reason:
    | "no-one-in-department"
    | "no-capacity"
    | "no-slot-fits"
    | "pinned-person-unavailable";
};

export type AssignResult = {
  assignments: Assignment[];
  unassigned: Unassigned[];
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

/** Remove already-committed windows from a person's free time. */
function subtractBusy(windows: Window[], busy: Window[]): Window[] {
  let free = windows;
  for (const b of busy) {
    const next: Window[] = [];
    for (const w of free) {
      if (b.end <= w.start || b.start >= w.end) {
        next.push(w);
        continue;
      }
      if (b.start > w.start) next.push({ start: w.start, end: b.start });
      if (b.end < w.end) next.push({ start: b.end, end: w.end });
    }
    free = next;
  }
  return free;
}

function claim(candidate: WorkingCandidate, slot: Window): void {
  candidate.free = subtractBusy(candidate.free, [slot]);
  candidate.remaining -= slot.end - slot.start;
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
}): AssignResult {
  const rotation = new Map<string, RotationInput>();
  for (const row of input.rotation ?? []) {
    rotation.set(`${row.templateId}:${row.userId}`, row);
  }

  const oneOffLoad = new Map<string, number>();
  for (const row of input.oneOffLoad ?? []) oneOffLoad.set(row.userId, row.count);

  const working: WorkingCandidate[] = input.candidates.map((c) => ({
    ...c,
    free: subtractBusy(c.availability.windows, c.busy),
    remaining: Math.max(0, c.availability.availableMinutes - c.committedMinutes),
  }));

  const assignments: Assignment[] = [];
  const unassigned: Unassigned[] = [];

  const ordered = [...input.tasks].sort((a, b) => {
    const aFixed = a.fixedStartMinutes != null;
    const bFixed = b.fixedStartMinutes != null;
    if (aFixed !== bFixed) return aFixed ? -1 : 1;
    if (aFixed && bFixed) {
      return (a.fixedStartMinutes ?? 0) - (b.fixedStartMinutes ?? 0);
    }
    if (a.estimatedMinutes !== b.estimatedMinutes) {
      return b.estimatedMinutes - a.estimatedMinutes;
    }
    return a.id < b.id ? -1 : 1;
  });

  for (const task of ordered) {
    const place = (candidate: WorkingCandidate): Window | null => {
      if (candidate.remaining < task.estimatedMinutes) return null;

      if (task.fixedStartMinutes != null) {
        // Must sit inside its declared window.
        const slot = findSlot(
          candidate.free,
          task.estimatedMinutes,
          task.fixedStartMinutes,
        );
        if (!slot) return null;
        const limit = task.fixedEndMinutes ?? Infinity;
        return slot.end <= limit ? slot : null;
      }

      return findSlot(candidate.free, task.estimatedMinutes);
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
      continue;
    }

    const inDepartment = working.filter(
      (c) => c.departmentId === task.departmentId,
    );
    if (inDepartment.length === 0) {
      unassigned.push({ taskId: task.id, reason: "no-one-in-department" });
      continue;
    }

    const withCapacity = inDepartment.filter(
      (c) => c.remaining >= task.estimatedMinutes,
    );
    if (withCapacity.length === 0) {
      unassigned.push({ taskId: task.id, reason: "no-capacity" });
      continue;
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

      // Taking the job counts for rotation immediately, so a second identical
      // task the same day goes to the next person rather than the same one.
      if (task.templateId) {
        const key = `${task.templateId}:${candidate.userId}`;
        const existing = rotation.get(key);
        rotation.set(key, {
          templateId: task.templateId,
          userId: candidate.userId,
          assignedCount: (existing?.assignedCount ?? 0) + 1,
          lastAssignedAt: input.date,
        });
      } else {
        oneOffLoad.set(
          candidate.userId,
          (oneOffLoad.get(candidate.userId) ?? 0) + 1,
        );
      }

      placed = true;
      break;
    }

    if (!placed) unassigned.push({ taskId: task.id, reason: "no-slot-fits" });
  }

  return { assignments, unassigned };
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
