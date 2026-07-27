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

const STATE_ROW: Record<string, string> = {
  DONE: "bg-transparent",
  IN_PROGRESS: "bg-run-wash",
  PAUSED: "bg-pause-wash",
  ORPHANED: "bg-stall-wash",
};

const STATE_EDGE: Record<string, string> = {
  DONE: "bg-done",
  IN_PROGRESS: "bg-run",
  PAUSED: "bg-pause",
  ORPHANED: "bg-stall",
};

export function TaskButton({
  task,
  onPause,
}: {
  task: DayTask;
  onPause: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 ${
        STATE_ROW[task.status] ?? ""
      }`}
    >
      {/* Clock time carries the ordering now that the list is not to scale. */}
      <span className="num w-[92px] shrink-0 text-[11.5px] text-muted">
        {task.scheduledStart != null && task.scheduledEnd != null
          ? `${formatClock(task.scheduledStart)}–${formatClock(task.scheduledEnd)}`
          : "unplaced"}
      </span>

      <span
        className={`h-8 w-[3px] shrink-0 rounded ${
          STATE_EDGE[task.status] ?? "bg-line-strong"
        }`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={`text-[13.5px] font-medium tracking-tight ${
              task.status === "DONE" ? "text-muted line-through decoration-faint" : ""
            }`}
          >
            {task.title}
          </span>
          <span className="num text-[11px] text-muted">
            {formatDuration(task.estimatedMinutes)}
          </span>
          {task.notes && (
            <span
              title={task.notes}
              className="cursor-help rounded border border-pause px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-pause uppercase"
            >
              note
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
          <span className="rounded border border-line bg-surface px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-faint uppercase">
            {task.origin}
          </span>
          <StateLabel task={task} />
        </div>
      </div>

      <div className="shrink-0">
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
    ? "px-2.5 py-1 text-[12px]"
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
