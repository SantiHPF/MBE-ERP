"use client";

import { useEffect, useState } from "react";
import type { DayTask } from "@/lib/tasks/day";
import type { BlockingTask } from "@/lib/tasks/actions";
import { formatClock, formatDuration } from "@/lib/time";
import { useT } from "@/lib/i18n/client";
import { TaskButton } from "./task-button";

/**
 * The one task in hand, and nothing else.
 *
 * My Day used to list the whole day. Almost none of it was actionable: the
 * ordering rule in actions.ts refuses to start anything but the earliest task
 * still owed, so eleven of the twelve rows were work the app would not let you
 * touch, with the one that mattered buried among them. What is coming later is
 * still reachable, folded away underneath.
 */

function stopwatch(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function CurrentTask({
  task,
  onPause,
  onBlocked,
  onCompleted,
  onCantDo,
}: {
  task: DayTask;
  onPause: () => void;
  onBlocked: (blocked: BlockingTask) => void;
  onCompleted: (taskId: string) => void;
  onCantDo: (taskId: string) => void;
}) {
  const { t } = useT();
  const running = task.status === "IN_PROGRESS";
  const paused = task.status === "PAUSED";
  const live = running || paused;

  // Ticks locally; the server holds the truth and re-syncs on every action.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running, task.id]);
  useEffect(() => setTick(0), [task.id, task.status]);

  const elapsed = task.elapsedSeconds + (running ? tick : 0);
  const over = elapsed > task.estimatedMinutes * 60;
  const left = Math.max(0, task.estimatedMinutes - Math.floor(elapsed / 60));

  return (
    <section
      className={`card border-l-[3px] ${
        running ? "border-l-run" : paused ? "border-l-pause" : "border-l-accent"
      }`}
      aria-current="step"
    >
      <header className="card-head">
        <span
          className={`eyebrow ${
            running ? "text-run" : paused ? "text-pause" : "text-accent"
          }`}
        >
          {running
            ? t("myDay.runningNow")
            : paused
              ? t("myDay.paused")
              : t("now.upNextLabel")}
        </span>
        <span className="num text-[12px] text-muted">
          {task.scheduledStart != null && task.scheduledEnd != null
            ? `${formatClock(task.scheduledStart)}–${formatClock(task.scheduledEnd)}`
            : t("common.unplaced")}
        </span>
      </header>

      <div className="card-body">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.015em] text-balance">
            {task.title}
          </h2>
          <span className="num text-[13px] text-faint">
            {formatDuration(task.estimatedMinutes)}
          </span>
          <span className="badge">{t(`origin.${task.origin}`)}</span>
          {task.notes && (
            <span className="badge badge-warn">{t("catalogue.note")}</span>
          )}
        </div>

        {/* One sitting of a longer job. The estimate above and the stopwatch
            below both measure this sitting, which is what is actually in hand;
            this line is the job around it. */}
        {task.session && (
          <p className="mt-1.5 text-[12.5px] text-muted">
            {t("sessions.sitting", task.session.index, task.session.total)}
            {" · "}
            {t(
              "sessions.leftOfJob",
              formatDuration(task.session.remainingMinutes),
            )}
          </p>
        )}

        {/* The stopwatch only means something once the clock is running. */}
        {live && (
          <>
            <p
              className={`num mt-4 text-[42px] leading-none font-medium tracking-[-0.03em] ${
                over ? "text-pause" : ""
              }`}
            >
              {stopwatch(elapsed)}
            </p>
            <p className="num mt-1.5 text-[12.5px] text-muted">
              {over
                ? t("myDay.overEstimate", formatDuration(task.estimatedMinutes))
                : `${formatDuration(left)} ${t("myDay.leftOf")} ${formatDuration(task.estimatedMinutes)}`}
            </p>

            <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${
                  over ? "bg-pause" : "bg-run"
                }`}
                style={{
                  width: `${Math.min(100, (elapsed / (task.estimatedMinutes * 60)) * 100)}%`,
                }}
              />
            </div>
          </>
        )}

        {paused && task.pauseText && (
          <p className="notice notice-warn mt-3.5">
            <span className="eyebrow mb-0.5 block text-pause">
              {t("myDay.paused")}
            </span>
            {task.pauseText}
          </p>
        )}

        {/* Catalogue warnings belong in front of you while you work, not in a
            spreadsheet nobody reopens. */}
        {task.notes && (
          <p className="mt-3.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed">
            {task.notes}
          </p>
        )}
        {task.instructions && (
          <p className="mt-2 text-[12.5px] text-muted">
            {t("myDay.howTo")} {task.instructions}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <TaskButton.Controls
            task={task}
            onPause={onPause}
            onBlocked={onBlocked}
            onCompleted={onCompleted}
            onCantDo={onCantDo}
          />
          {task.repeatable && <TaskButton.Counter task={task} />}
        </div>
      </div>
    </section>
  );
}
