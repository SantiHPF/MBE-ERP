import type { DayTask } from "@/lib/tasks/day";
import { startTask, type ActionState } from "@/lib/tasks/actions";
import { startMeetingForTask } from "@/lib/meetings/live";

/**
 * Starting a task, wherever it is started from -- the row, the rail, or the
 * prompt that offers the next one when you finish something.
 *
 * A meeting task opens its notes as part of starting, so nobody has to
 * remember to go and write it up somewhere else. That only happens once the
 * start has actually succeeded: a start refused by the day's order used to
 * leave a meeting behind for a task nobody had begun.
 *
 * This lives in one place because both callers need the same two steps in the
 * same order, and a copy of it is how the two drift apart.
 */
export async function startTaskFor(
  task: Pick<DayTask, "id" | "isMeeting" | "meetingId">,
  prev: ActionState = {},
): Promise<ActionState> {
  const formData = new FormData();
  formData.set("taskId", task.id);

  const result = await startTask(prev, formData);

  if (result.ok && task.isMeeting && !task.meetingId) {
    const open = new FormData();
    open.set("taskId", task.id);
    await startMeetingForTask({}, open);
  }

  return result;
}
