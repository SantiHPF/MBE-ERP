"use client";

import { useEffect, useState } from "react";
import type { DayView } from "@/lib/tasks/day";
import { formatClock, formatDuration } from "@/lib/time";
import { PauseDialog } from "./pause-dialog";
import { TaskButton } from "./task-button";

const PX_PER_MIN = 1.05;

function stopwatch(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function DayViewClient({ view }: { view: DayView }) {
  const active = view.tasks.find((t) => t.id === view.activeTaskId);
  const [pausing, setPausing] = useState<string | null>(null);

  // The stopwatch ticks locally; the server holds the truth. On any action the
  // page revalidates and the count re-syncs, so drift never accumulates.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (active?.status !== "IN_PROGRESS") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active?.status, active?.id]);

  useEffect(() => setTick(0), [active?.id, active?.status]);

  if (!view.rostered) {
    return (
      <p className="rounded border border-dashed border-line p-10 text-center text-sm text-muted">
        You are not scheduled to work today.
      </p>
    );
  }

  if (view.availableMinutes === 0) {
    return (
      <p className="rounded border border-stall bg-stall-wash p-10 text-center text-sm">
        You are marked absent today. Your tasks are with your manager.
      </p>
    );
  }

  const dayStart = view.windows[0]?.start ?? 540;
  const dayEnd = view.windows[view.windows.length - 1]?.end ?? 1080;
  const height = (dayEnd - dayStart) * PX_PER_MIN;

  const hourLines: number[] = [];
  for (let m = Math.ceil(dayStart / 60) * 60; m <= dayEnd; m += 60) {
    hourLines.push(m);
  }

  // Gaps between working windows are breaks -- drawn so lunch is visible
  // rather than implied by a hole in the list.
  const gaps: { start: number; end: number }[] = [];
  for (let i = 1; i < view.windows.length; i++) {
    gaps.push({ start: view.windows[i - 1].end, end: view.windows[i].start });
  }

  const booked = view.tasks.reduce((s, t) => s + t.estimatedMinutes, 0);
  const done = view.tasks
    .filter((t) => t.status === "DONE")
    .reduce((s, t) => s + t.estimatedMinutes, 0);

  const elapsed = active ? active.elapsedSeconds + tick : 0;
  const over = active ? elapsed > active.estimatedMinutes * 60 : false;

  return (
    <>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_316px]">
        {/* ------------------------------------------------------ the rota */}
        <section className="rounded border border-line bg-surface shadow-sm">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
              Today
            </span>
            <span className="num text-xs text-muted">
              {view.tasks.length} {view.tasks.length === 1 ? "task" : "tasks"}
            </span>
          </header>

          <div
            className="relative py-3.5 pr-3.5 pl-[62px]"
            style={{ height: height + 28 }}
          >
            {hourLines.map((m) => (
              <div key={m}>
                <div
                  className="pointer-events-none absolute right-3.5 left-[62px] border-t border-line-strong"
                  style={{ top: (m - dayStart) * PX_PER_MIN }}
                />
                <div
                  className="num absolute left-3.5 w-10 -translate-y-1/2 text-right text-[11px] text-faint"
                  style={{ top: (m - dayStart) * PX_PER_MIN }}
                >
                  {formatClock(m)}
                </div>
              </div>
            ))}

            {gaps.map((gap) => (
              <div
                key={gap.start}
                className="absolute right-3.5 left-[62px] flex items-center rounded border border-dashed border-line px-2.5 text-[11px] text-faint"
                style={{
                  top: (gap.start - dayStart) * PX_PER_MIN,
                  height: (gap.end - gap.start) * PX_PER_MIN,
                }}
              >
                Break · {formatClock(gap.start)}–{formatClock(gap.end)}
              </div>
            ))}

            {view.tasks.map((task) => (
              <TaskButton
                key={task.id}
                task={task}
                dayStart={dayStart}
                pxPerMin={PX_PER_MIN}
                onPause={() => setPausing(task.id)}
              />
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------- the rail */}
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-5">
          {active ? (
            <section className="rounded border border-line bg-surface p-4 shadow-sm">
              <p className="text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
                {active.status === "IN_PROGRESS" ? "Running now" : "Paused"}
              </p>
              <p className="mt-1.5 text-sm font-semibold text-balance">
                {active.title}
              </p>

              <p
                className={`num mt-2.5 text-[34px] leading-tight font-medium tracking-tight ${
                  over ? "text-pause" : ""
                }`}
              >
                {stopwatch(elapsed)}
              </p>
              <p className="num mt-0.5 text-[11.5px] text-muted">
                {over
                  ? `over the ${formatDuration(active.estimatedMinutes)} estimate`
                  : `${formatDuration(
                      Math.max(
                        0,
                        active.estimatedMinutes - Math.floor(elapsed / 60),
                      ),
                    )} left of ${formatDuration(active.estimatedMinutes)}`}
              </p>

              <div className="my-3 h-1 overflow-hidden rounded bg-line">
                <div
                  className={`h-full ${over ? "bg-pause" : "bg-run"}`}
                  style={{
                    width: `${Math.min(
                      100,
                      (elapsed / (active.estimatedMinutes * 60)) * 100,
                    )}%`,
                  }}
                />
              </div>

              {active.status === "PAUSED" && active.pauseText && (
                <p className="mb-3 rounded border border-pause bg-pause-wash px-3 py-2 text-xs">
                  <span className="mb-0.5 block text-[10px] font-semibold tracking-wider text-pause uppercase">
                    Paused
                  </span>
                  {active.pauseText}
                </p>
              )}

              <TaskButton.Controls
                task={active}
                onPause={() => setPausing(active.id)}
              />
            </section>
          ) : (
            <section className="rounded border border-line bg-surface p-4 text-center text-sm text-muted shadow-sm">
              Nothing running. Start a task from the list.
            </section>
          )}

          <section className="rounded border border-line bg-surface shadow-sm">
            <header className="border-b border-line px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
              Day at a glance
            </header>
            <dl className="px-4 py-1">
              <Stat label="Booked">
                {formatDuration(booked)} of {formatDuration(view.availableMinutes)}
              </Stat>
              <Stat label="Finished">{formatDuration(done)}</Stat>
              <Stat label="Left to do">{formatDuration(booked - done)}</Stat>
              <Stat label="Unbooked">
                {formatDuration(Math.max(0, view.availableMinutes - booked))}
              </Stat>
            </dl>
          </section>
        </aside>
      </div>

      {pausing && (
        <PauseDialog
          taskId={pausing}
          title={view.tasks.find((t) => t.id === pausing)?.title ?? ""}
          onClose={() => setPausing(null)}
        />
      )}
    </>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-[13px] font-semibold">{children}</dd>
    </div>
  );
}
