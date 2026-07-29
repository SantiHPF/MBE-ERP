"use client";

import { useActionState, useEffect, useRef } from "react";
import type { DayTask } from "@/lib/tasks/day";
import type { ActionState } from "@/lib/tasks/actions";
import { formatClock, formatDuration } from "@/lib/time";
import { useT } from "@/lib/i18n/client";
import { startTaskFor } from "./start-task";

const initial: ActionState = {};

/**
 * Shown the moment a task is finished, offering the next one.
 *
 * Finishing something used to drop you back on a static list to find your own
 * way to the next row. Start is focused, so carrying on is one keypress and
 * stopping is Escape.
 *
 * The next task is the next one in the day's order, so starting it can never
 * be refused by the ordering rule -- there is no blocked path to handle here.
 */
export function NextUpDialog({
  task,
  finishedTitle,
  breakBefore,
  onClose,
  onStarted,
}: {
  task: DayTask;
  finishedTitle: string | null;
  /** A gap between now and the next task, when the day has one. */
  breakBefore: { start: number; end: number } | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { t } = useT();
  const startButton = useRef<HTMLButtonElement>(null);

  const [state, start, starting] = useActionState(async (prev: ActionState) => {
    const result = await startTaskFor(task, prev);
    if (result.ok) onStarted();
    return result;
  }, initial);

  useEffect(() => {
    startButton.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="next-up-title"
        className="w-full max-w-[420px] rounded-[10px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)]"
      >
        <p className="eyebrow text-run">
          {finishedTitle
            ? t("nextUp.finished", finishedTitle)
            : t("nextUp.eyebrow")}
        </p>
        <h2
          id="next-up-title"
          className="mt-1 text-[16px] font-semibold tracking-[-0.012em] text-balance"
        >
          {task.title}
        </h2>

        <p className="num mt-1 text-[12.5px] text-muted">
          {task.scheduledStart != null && task.scheduledEnd != null
            ? `${formatClock(task.scheduledStart)}–${formatClock(task.scheduledEnd)} · ${formatDuration(task.estimatedMinutes)}`
            : formatDuration(task.estimatedMinutes)}
        </p>

        {/* Saying "start now" over the top of a scheduled break would be
            telling them to work through it. */}
        {breakBefore && (
          <p className="notice notice-warn mt-3.5">
            {t(
              "nextUp.breakFirst",
              formatClock(breakBefore.start),
              formatClock(breakBefore.end),
            )}
          </p>
        )}

        {task.notes && (
          <p className="mt-3.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
            {task.notes}
          </p>
        )}

        {task.instructions && (
          <p className="mt-2 text-[12px] text-muted">
            {t("myDay.howTo")} {task.instructions}
          </p>
        )}

        {state.error && (
          <p role="alert" className="mt-3 text-[12px] text-stall">
            {state.error}
          </p>
        )}

        <form action={start} className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2"
          >
            {t("nextUp.notYet")}
          </button>
          <button
            ref={startButton}
            type="submit"
            disabled={starting}
            className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
          >
            {starting
              ? t("nextUp.starting")
              : task.isMeeting
                ? t("myDay.startWithNotes")
                : t("nextUp.startNow")}
          </button>
        </form>
      </div>
    </div>
  );
}
