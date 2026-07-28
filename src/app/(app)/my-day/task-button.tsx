"use client";

import { useActionState } from "react";
import type { DayTask } from "@/lib/tasks/day";
import { formatClock, formatDuration } from "@/lib/time";
import {
  completeTask,
  startTask,
  type ActionState,
  type BlockingTask,
} from "@/lib/tasks/actions";
import { startMeetingForTask } from "@/lib/meetings/live";

const initial: ActionState = {};

const ROW_TINT: Record<string, string> = {
  IN_PROGRESS: "bg-run-wash",
  PAUSED: "bg-pause-wash",
  ORPHANED: "bg-stall-wash",
};

const EDGE: Record<string, string> = {
  DONE: "bg-done/40",
  IN_PROGRESS: "bg-run",
  PAUSED: "bg-pause",
  ORPHANED: "bg-stall",
};

export function TaskButton({
  task,
  onPause,
  onBlocked,
  onMove,
}: {
  task: DayTask;
  onPause: () => void;
  onBlocked: (blocked: BlockingTask) => void;
  onMove?: (direction: "up" | "down") => void;
}) {
  const movable = onMove && task.status !== "DONE";
  const done = task.status === "DONE";

  return (
    <div
      className={`group flex items-center gap-3 border-b border-line px-4 py-3 transition-colors last:border-0 hover:bg-surface-2/70 ${
        movable ? "cursor-grab active:cursor-grabbing" : ""
      } ${ROW_TINT[task.status] ?? ""}`}
    >
      {/* Reorder handle. Hidden until hover so the row stays quiet, but the
          buttons are always focusable for keyboard use. */}
      <div className="w-4 shrink-0">
        {movable && (
          <div className="flex flex-col leading-none text-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onMove("up")}
              aria-label={`Move ${task.title} earlier`}
              className="hover:text-accent"
            >
              <svg width="11" height="7" viewBox="0 0 11 7" aria-hidden>
                <path d="M1 6l4.5-4L10 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onMove("down")}
              aria-label={`Move ${task.title} later`}
              className="hover:text-accent"
            >
              <svg width="11" height="7" viewBox="0 0 11 7" aria-hidden>
                <path d="M1 1l4.5 4L10 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Clock time carries the ordering now that the list is not to scale. */}
      <span
        className={`num w-[88px] shrink-0 text-[12px] tracking-tight ${
          done ? "text-faint" : "text-muted"
        }`}
      >
        {task.scheduledStart != null && task.scheduledEnd != null
          ? `${formatClock(task.scheduledStart)}–${formatClock(task.scheduledEnd)}`
          : "unplaced"}
      </span>

      <span
        className={`h-9 w-[3px] shrink-0 rounded-full ${
          EDGE[task.status] ?? "bg-line-strong"
        }`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={`text-[14px] font-medium tracking-[-0.006em] ${
              done ? "text-muted line-through decoration-faint" : ""
            }`}
          >
            {task.title}
          </span>
          <span className="num text-[12px] text-faint">
            {formatDuration(task.estimatedMinutes)}
          </span>
          {task.notes && (
            <span title={task.notes} className="badge badge-warn cursor-help">
              note
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="badge">{task.origin}</span>
          <StateLabel task={task} />
        </div>
      </div>

      <div className="shrink-0">
        <Controls task={task} onPause={onPause} onBlocked={onBlocked} compact />
      </div>
    </div>
  );
}

function StateLabel({ task }: { task: DayTask }) {
  if (task.status === "IN_PROGRESS") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-run">
        <span className="throb h-1.5 w-1.5 rounded-full bg-current" />
        Running
      </span>
    );
  }
  if (task.status === "PAUSED") {
    return (
      <span className="truncate text-[12px] font-medium text-pause">
        Paused · {task.pauseText}
      </span>
    );
  }
  if (task.status === "DONE") {
    return (
      <span className="num shrink-0 text-[12px] text-done">
        Done in {formatDuration(Math.round(task.elapsedSeconds / 60))}
      </span>
    );
  }
  return null;
}

function Controls({
  task,
  onPause,
  onBlocked,
  compact = false,
}: {
  task: DayTask;
  onPause: () => void;
  onBlocked?: (blocked: BlockingTask) => void;
  compact?: boolean;
}) {
  const [startState, start, starting] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await startTask(prev, formData);
      // The day runs in order; hand the blocker up so the page can ask why.
      if (result.blockedBy) onBlocked?.(result.blockedBy);
      return result;
    },
    initial,
  );
  const [doneState, complete, completing] = useActionState(
    completeTask,
    initial,
  );

  if (task.status === "DONE") return null;

  const size = compact ? "btn-sm" : "flex-1";
  const error = startState.blockedBy
    ? undefined
    : (startState.error ?? doneState.error);

  return (
    <div className={compact ? "flex shrink-0 gap-1.5" : "flex gap-1.5"}>
      {error && !compact && (
        <p role="alert" className="mb-2 w-full text-[12px] text-stall">
          {error}
        </p>
      )}

      {task.status === "IN_PROGRESS" ? (
        <button type="button" onClick={onPause} className={`btn ${size}`}>
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
          <button type="submit" disabled={starting} className={`btn ${size}`}>
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
            className={`btn btn-primary ${size}`}
          >
            Complete
          </button>
        </form>
      )}
    </div>
  );
}

TaskButton.Controls = Controls;
