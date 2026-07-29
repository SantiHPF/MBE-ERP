"use client";

import { useActionState } from "react";
import type { DayTask } from "@/lib/tasks/day";
import { formatClock, formatDuration } from "@/lib/time";
import { completeTask, type ActionState, type BlockingTask } from "@/lib/tasks/actions";
import { startTaskFor } from "./start-task";
import { countOne, setTaskQuantity } from "@/lib/tasks/quantity";
import { useT } from "@/lib/i18n/client";

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
  onCompleted,
  onMove,
}: {
  task: DayTask;
  onPause: () => void;
  onBlocked: (blocked: BlockingTask) => void;
  onCompleted?: (taskId: string) => void;
  onMove?: (direction: "up" | "down") => void;
}) {
  const { t } = useT();
  const movable = onMove && task.status !== "DONE";
  const done = task.status === "DONE";
  const live = task.status === "IN_PROGRESS" || task.status === "PAUSED";

  return (
    <div
      /* The task in hand should be findable in a list of twelve without
         reading it. A wash alone was too quiet, so the row also gets more
         room, a heavier left edge and a larger title. No animation: a
         permanent pulse in the middle of a work screen is a distraction. */
      aria-current={live ? "step" : undefined}
      className={`group flex items-center gap-3 border-b border-line px-4 transition-colors last:border-0 hover:bg-surface-2/70 ${
        live ? "py-4" : "py-3"
      } ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${
        ROW_TINT[task.status] ?? ""
      }`}
    >
      {/* Reorder handle. Hidden until hover so the row stays quiet, but the
          buttons are always focusable for keyboard use. */}
      <div className="w-4 shrink-0">
        {movable && (
          <div className="flex flex-col leading-none text-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onMove("up")}
              aria-label={t("myDay.moveEarlier", task.title)}
              className="hover:text-accent"
            >
              <svg width="11" height="7" viewBox="0 0 11 7" aria-hidden>
                <path d="M1 6l4.5-4L10 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onMove("down")}
              aria-label={t("myDay.moveLater", task.title)}
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
          : t("common.unplaced")}
      </span>

      <span
        className={`shrink-0 rounded-full ${live ? "h-11 w-[5px]" : "h-9 w-[3px]"} ${
          EDGE[task.status] ?? "bg-line-strong"
        }`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={`tracking-[-0.006em] ${
              live ? "text-[15px] font-semibold" : "text-[14px] font-medium"
            } ${done ? "text-muted line-through decoration-faint" : ""}`}
          >
            {task.title}
          </span>
          <span className="num text-[12px] text-faint">
            {formatDuration(task.estimatedMinutes)}
            {task.repeatable && task.quantity > 1 && task.unitMinutes && (
              <span className="text-faint">
                {" "}
                · {task.quantity} × {task.unitMinutes}m
              </span>
            )}
          </span>
          {task.notes && (
            <span title={task.notes} className="badge badge-warn cursor-help">
              {t("catalogue.note")}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          {/* The raw enum used to be printed here, so a Spanish day was
              labelled RECURRING and CATALOGUE. */}
          <span className="badge">{t(`origin.${task.origin}`)}</span>
          <StateLabel task={task} />
          {task.repeatable && <Counter task={task} />}
        </div>
      </div>

      <div className="shrink-0">
        <Controls
          task={task}
          onPause={onPause}
          onBlocked={onBlocked}
          onCompleted={onCompleted}
          compact
        />
      </div>
    </div>
  );
}

function StateLabel({ task }: { task: DayTask }) {
  const { t } = useT();
  if (task.status === "IN_PROGRESS") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-run">
        <span className="throb h-1.5 w-1.5 rounded-full bg-current" />
        {t("myDay.running")}
      </span>
    );
  }
  if (task.status === "PAUSED") {
    return (
      <span className="truncate text-[12px] font-medium text-pause">
        {t("myDay.paused")} · {task.pauseText}
      </span>
    );
  }
  if (task.status === "DONE") {
    return (
      <span className="num shrink-0 text-[12px] text-done">
        {t("myDay.doneIn", formatDuration(Math.round(task.elapsedSeconds / 60)))}
      </span>
    );
  }
  return null;
}

function Controls({
  task,
  onPause,
  onBlocked,
  onCompleted,
  compact = false,
}: {
  task: DayTask;
  onPause: () => void;
  onBlocked?: (blocked: BlockingTask) => void;
  onCompleted?: (taskId: string) => void;
  compact?: boolean;
}) {
  const { t } = useT();
  const [startState, start, starting] = useActionState(
    async (prev: ActionState) => {
      const result = await startTaskFor(task, prev);
      // The day runs in order; hand the blocker up so the page can ask why.
      if (result.blockedBy) onBlocked?.(result.blockedBy);
      return result;
    },
    initial,
  );
  const [doneState, complete, completing] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await completeTask(prev, formData);
      // Offer the next one straight away rather than leaving them to find it.
      if (result.ok) onCompleted?.(task.id);
      return result;
    },
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
          {t("myDay.pause")}
        </button>
      ) : (
        <form action={start}>
          <button type="submit" disabled={starting} className={`btn ${size}`}>
            {task.status === "PAUSED"
              ? t("myDay.resume")
              : task.isMeeting
                ? t("myDay.startWithNotes")
                : t("myDay.start")}
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
            {t("myDay.complete")}
          </button>
        </form>
      )}
    </div>
  );
}

TaskButton.Controls = Controls;
// The single-task card on My Day reuses the tally as well as the buttons.
TaskButton.Counter = Counter;


/**
 * How many of a repeatable task are planned, and how many are done.
 *
 * While it is running this is a tally you click as you go; the rest of the
 * time it is just how many you intend to do, and changing it re-sizes the
 * block in the day.
 */
function Counter({ task }: { task: DayTask }) {
  const { t } = useT();
  const [, count] = useActionState(countOne, initial);
  const [, setQuantity] = useActionState(setTaskQuantity, initial);
  const running = task.status === "IN_PROGRESS" || task.status === "PAUSED";
  const done = task.status === "DONE";

  if (done) {
    return (
      <span className="num text-[12px] text-done">
        {task.doneCount || task.quantity} {t("myDay.done")}
      </span>
    );
  }

  if (running) {
    return (
      <span className="flex items-center gap-1">
        <form action={count}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="delta" value="-1" />
          <button
            type="submit"
            aria-label={t("myDay.oneFewer")}
            disabled={task.doneCount === 0}
            className="btn btn-sm px-1.5 py-0 leading-5 disabled:opacity-30"
          >
            −
          </button>
        </form>
        <span className="num min-w-[54px] text-center text-[12px] font-semibold">
          {task.doneCount} {t("myDay.ofDone")} {task.quantity}
        </span>
        <form action={count}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="delta" value="1" />
          <button
            type="submit"
            aria-label={t("myDay.oneMore")}
            className="btn btn-sm px-1.5 py-0 leading-5"
          >
            +
          </button>
        </form>
      </span>
    );
  }

  return (
    <form action={setQuantity} className="flex items-center gap-1">
      <input type="hidden" name="taskId" value={task.id} />
      <label className="text-[12px] text-muted">
        {t("myDay.howMany")}
        <input
          type="number"
          name="quantity"
          defaultValue={task.quantity}
          min={1}
          max={200}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="num ml-1 w-14 rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[12px]"
        />
      </label>
    </form>
  );
}
