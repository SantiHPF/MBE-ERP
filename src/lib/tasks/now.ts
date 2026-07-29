import type { Window } from "@/lib/scheduling/availability";
import type { DayTask } from "./day";

/**
 * What the bar at the bottom of every page needs, and nothing more.
 *
 * getDayView() answers a bigger question -- the live meeting, the colleague
 * list, who to ring -- and runs about nine queries doing it. That is the right
 * cost once, on My Day. It is the wrong cost on every page in the app, so the
 * bar gets a slim version instead: see now-db.ts.
 *
 * The picking rules live here, with no database import, because My Day is a
 * client component and needs them too.
 */

export type NowState = {
  date: string;
  rostered: boolean;
  windows: Window[];
  tasks: DayTask[];
  /** Running or paused. */
  activeTaskId: string | null;
  /** The task the ordering rule would let you start next, if none is running. */
  nextTaskId: string | null;
  /** Set once the day has been closed on purpose. */
  closed: boolean;
};

/** Work still owed, in the order the day runs. */
const OWED = ["ASSIGNED", "IN_PROGRESS", "PAUSED", "ORPHANED"];

/**
 * The one task that matters right now.
 *
 * Whatever is running or paused; failing that, the earliest still owed. That
 * second case is deliberately the same rule blockingTask() enforces in
 * actions.ts -- the task it points at is the only one it would let you start,
 * so offering any other would be offering something the server will refuse.
 *
 * Pure and exported so the choice is testable without a database.
 */
export function currentTask(tasks: DayTask[]): DayTask | null {
  const running = tasks.find(
    (t) => t.status === "IN_PROGRESS" || t.status === "PAUSED",
  );
  if (running) return running;

  const owed = tasks
    .filter((t) => OWED.includes(t.status))
    .sort(
      (a, b) =>
        (a.scheduledStart ?? Number.MAX_SAFE_INTEGER) -
          (b.scheduledStart ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    );

  return owed[0] ?? null;
}

/** Everything still owed, in the day's order. */
export function stillOwed(tasks: DayTask[]): DayTask[] {
  return tasks
    .filter((t) => OWED.includes(t.status))
    .sort(
      (a, b) =>
        (a.scheduledStart ?? Number.MAX_SAFE_INTEGER) -
          (b.scheduledStart ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    );
}
