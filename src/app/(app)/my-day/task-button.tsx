"use client";

import { useActionState } from "react";
import type { DayTask } from "@/lib/tasks/day";
import { formatClock, formatDuration } from "@/lib/time";
import { completeTask, startTask, type ActionState } from "@/lib/tasks/actions";
import { startMeetingForTask } from "@/lib/meetings/live";

const initial: ActionState = {};

const STATE_STYLE: Record<string, string> = {
  DONE: "border-line border-l-done bg-transparent text-muted",
  IN_PROGRESS: "border-run border-l-run bg-run-wash",
  PAUSED: "border-pause border-l-pause bg-pause-wash",
  ORPHANED: "border-stall border-l-stall bg-stall-wash",
};

export function TaskButton({
  task,
  dayStart,
  pxPerMin,
  onPause,
}: {
  task: DayTask;
  dayStart: number;
  pxPerMin: number;
  onPause: () => void;
}) {
  const top = ((task.scheduledStart ?? dayStart) - dayStart) * pxPerMin;
  const height = Math.max(task.estimatedMinutes * pxPerMin, 32);
  const style =
    STATE_STYLE[task.status] ?? "border-line-strong border-l-line-strong bg-surface-2";

  return (
    <div
      className={`absolute right-3.5 left-[62px] overflow-hidden rounded border border-l-[3px] px-2.5 py-1.5 ${style}`}
      style={{ top, height }}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`truncate text-[13.5px] font-medium tracking-tight ${
            task.status === "DONE" ? "line-through decoration-faint" : ""
          }`}
        >
          {task.title}
        </span>
        {task.scheduledStart != null && task.scheduledEnd != null && (
          <span className="num shrink-0 text-[11px] text-muted">
            {formatClock(task.scheduledStart)}–{formatClock(task.scheduledEnd)}
          </span>
        )}
      </div>

      <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
        <span className="shrink-0 rounded border border-line bg-surface px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-faint uppercase">
          {task.origin}
        </span>
        {task.notes && (
          <span
            title={task.notes}
            className="shrink-0 cursor-help rounded border border-pause px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-pause uppercase"
          >
            note
          </span>
        )}
        <StateLabel task={task} />
        <span className="flex-1" />
        <Controls task={task} onPause={onPause} compact />
      </div>
    </div>
  );
}

function StateLabel({ task }: { task: DayTask }) {
  if (task.status === "IN_PROGRESS") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-run">
        <span className="throb h-1.5 w-1.5 rounded-full bg-current" />
        Running
      </span>
    );
  }
  if (task.status === "PAUSED") {
    return (
      <span className="truncate text-[11px] font-semibold text-pause">
        Paused · {task.pauseText}
      </span>
    );
  }
  if (task.status === "DONE") {
    return (
      <span className="num shrink-0 text-[11px] text-done">
        Done in {formatDuration(Math.round(task.elapsedSeconds / 60))}
      </span>
    );
  }
  return (
    <span className="num shrink-0 text-[11px]">
      {formatDuration(task.estimatedMinutes)}
    </span>
  );
}

function Controls({
  task,
  onPause,
  compact = false,
}: {
  task: DayTask;
  onPause: () => void;
  compact?: boolean;
}) {
  const [startState, start, starting] = useActionState(startTask, initial);
  const [doneState, complete, completing] = useActionState(
    completeTask,
    initial,
  );

  if (task.status === "DONE") return null;

  const size = compact
    ? "px-2 py-0.5 text-[11px]"
    : "flex-1 px-3 py-1.5 text-[13px]";

  const error = startState.error ?? doneState.error;

  return (
    <div className={compact ? "flex shrink-0 gap-1.5" : "flex gap-1.5"}>
      {error && !compact && (
        <p role="alert" className="mb-2 w-full text-xs text-stall">
          {error}
        </p>
      )}

      {task.status === "IN_PROGRESS" ? (
        <button
          type="button"
          onClick={onPause}
          className={`rounded border border-line-strong bg-surface font-medium hover:bg-surface-2 ${size}`}
        >
          Pause
        </button>
      ) : (
        <form
          action={async (formData: FormData) => {
            await start(formData);
            // A meeting task opens its notes as part of starting, so nobody
            // has to remember to go and write it up somewhere else.
            if (task.isMeeting && !task.meetingId) {
              const open = new FormData();
              open.set("taskId", task.id);
              await startMeetingForTask({}, open);
            }
          }}
        >
          <input type="hidden" name="taskId" value={task.id} />
          <button
            type="submit"
            disabled={starting}
            className={`rounded border border-line-strong bg-surface font-medium hover:bg-surface-2 disabled:opacity-50 ${size}`}
          >
            {task.status === "PAUSED"
              ? "Resume"
              : task.isMeeting
                ? "Start + notes"
                : "Start"}
          </button>
        </form>
      )}

      {(task.status === "IN_PROGRESS" || task.status === "PAUSED") && (
        <form action={complete}>
          <input type="hidden" name="taskId" value={task.id} />
          <button
            type="submit"
            disabled={completing}
            className={`rounded border border-accent bg-accent font-medium text-accent-ink hover:brightness-110 disabled:opacity-50 ${size}`}
          >
            Complete
          </button>
        </form>
      )}
    </div>
  );
}

TaskButton.Controls = Controls;
