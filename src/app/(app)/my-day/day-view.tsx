"use client";

import { useEffect, useState } from "react";
import type { DayTask, DayView } from "@/lib/tasks/day";
import { formatClock, formatDuration } from "@/lib/time";
import { PauseDialog } from "./pause-dialog";
import { MeetingPanel, StartMeetingButton } from "./meeting-panel";
import { TaskButton } from "./task-button";

function stopwatch(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}


type DayRow =
  | { kind: "task"; task: DayTask; start: number }
  | { kind: "break" | "free"; start: number; end: number };

/**
 * Tasks in clock order, with the gaps between them called out.
 *
 * Breaks come from the holes between working windows; anything else with no
 * work in it is unbooked time, which is worth seeing when planning the rest of
 * the day. Gaps under five minutes are noise and get dropped.
 */
function buildDayRows(view: DayView, dayStart: number, dayEnd: number): DayRow[] {
  const MIN_GAP = 5;

  const tasks = [...view.tasks].sort(
    (a, b) =>
      (a.scheduledStart ?? dayStart) - (b.scheduledStart ?? dayStart) ||
      a.title.localeCompare(b.title),
  );

  const breaks: { start: number; end: number }[] = [];
  for (let i = 1; i < view.windows.length; i++) {
    breaks.push({ start: view.windows[i - 1].end, end: view.windows[i].start });
  }
  const inBreak = (from: number, to: number) =>
    breaks.some((b) => from < b.end && to > b.start);

  const rows: DayRow[] = [];
  let cursor = dayStart;

  const fill = (upTo: number) => {
    for (const b of breaks) {
      if (b.start >= cursor && b.end <= upTo) {
        if (b.start - cursor >= MIN_GAP) {
          rows.push({ kind: "free", start: cursor, end: b.start });
        }
        rows.push({ kind: "break", start: b.start, end: b.end });
        cursor = b.end;
      }
    }
    if (upTo - cursor >= MIN_GAP && !inBreak(cursor, upTo)) {
      rows.push({ kind: "free", start: cursor, end: upTo });
    }
    cursor = Math.max(cursor, upTo);
  };

  for (const task of tasks) {
    const start = task.scheduledStart ?? cursor;
    if (start > cursor) fill(start);
    rows.push({ kind: "task", task, start });
    cursor = Math.max(cursor, task.scheduledEnd ?? start + task.estimatedMinutes);
  }

  if (dayEnd > cursor) fill(dayEnd);

  return rows;
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

  const booked = view.tasks.reduce((s, t) => s + t.estimatedMinutes, 0);
  const done = view.tasks
    .filter((t) => t.status === "DONE")
    .reduce((s, t) => s + t.estimatedMinutes, 0);

  const elapsed = active ? active.elapsedSeconds + tick : 0;
  const over = active ? elapsed > active.estimatedMinutes * 60 : false;

  // The day is a list, not a proportional timeline. Six five-minute tasks in
  // an afternoon are only pixels apart on a real time axis, which buried the
  // controls under each other; every row now gets the height it needs and the
  // clock times carry the ordering instead.
  const rows = buildDayRows(view, dayStart, dayEnd);

  return (
    <>
      {view.liveMeeting && (
        <MeetingPanel
          meeting={view.liveMeeting}
          colleagues={view.colleagues}
          today={view.date}
        />
      )}

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

          <ul className="flex flex-col">
            {rows.map((row) =>
              row.kind === "task" ? (
                <li key={row.task.id}>
                  <TaskButton task={row.task} onPause={() => setPausing(row.task.id)} />
                </li>
              ) : (
                <li
                  key={`${row.kind}-${row.start}`}
                  className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0"
                >
                  <span className="num w-[92px] shrink-0 text-[11px] text-faint">
                    {formatClock(row.start)}–{formatClock(row.end)}
                  </span>
                  <span
                    className={`text-[12px] ${
                      row.kind === "break" ? "text-faint" : "text-muted"
                    }`}
                  >
                    {row.kind === "break"
                      ? `Break · ${formatDuration(row.end - row.start)}`
                      : `${formatDuration(row.end - row.start)} unbooked`}
                  </span>
                  <span className="h-px flex-1 border-t border-dashed border-line" />
                </li>
              ),
            )}

            {rows.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted">
                Nothing scheduled today.
              </li>
            )}
          </ul>
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

              {/* Catalogue warnings belong in front of you while you work,
                  not in a spreadsheet nobody reopens. */}
              {active.notes && (
                <p className="mb-3 rounded border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed">
                  {active.notes}
                </p>
              )}
              {active.instructions && (
                <p className="mb-3 text-[11px] text-muted">
                  How to: {active.instructions}
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

          {!view.liveMeeting && (
            <div className="flex justify-center">
              <StartMeetingButton />
            </div>
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
