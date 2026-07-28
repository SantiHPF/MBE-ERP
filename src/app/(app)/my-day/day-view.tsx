"use client";

import { useEffect, useState, useTransition } from "react";
import type { DayTask, DayView } from "@/lib/tasks/day";
import { reorderDay, type BlockingTask } from "@/lib/tasks/actions";
import { formatClock, formatDuration } from "@/lib/time";
import { useT } from "@/lib/i18n/client";
import { PauseDialog } from "./pause-dialog";
import { DeferDialog } from "./defer-dialog";
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
  const { t } = useT();
  const active = view.tasks.find((x) => x.id === view.activeTaskId);
  const [pausing, setPausing] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockingTask | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [reordering, startReorder] = useTransition();

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
      <p className="empty">
        {t("myDay.notScheduledToday")}
      </p>
    );
  }

  if (view.availableMinutes === 0) {
    return (
      <p className="rounded border border-stall bg-stall-wash p-10 text-center text-sm">
        {t("myDay.markedAbsent")}
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

  // Tasks in the order shown: the server's, unless a drag is in flight.
  const taskRows = rows.filter((r) => r.kind === "task");
  const shown = order
    ? order
        .map((id) => taskRows.find((r) => r.kind === "task" && r.task.id === id))
        .filter((r): r is Extract<DayRow, { kind: "task" }> => r !== undefined)
    : null;

  /** Move a task to another position and save the whole day's order. */
  function moveTo(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = (shown ?? taskRows).map((r) =>
      r.kind === "task" ? r.task.id : "",
    );
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;

    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);

    const form = new FormData();
    form.set("date", view.date);
    for (const id of next) form.append("taskIds", id);
    startReorder(async () => {
      await reorderDay({}, form);
      setOrder(null);
    });
  }

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
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">{t("myDay.today")}</span>
            <span className="num text-[12px] text-muted">
              {reordering
                ? t("myDay.savingOrder")
                : `${view.tasks.length} ${view.tasks.length === 1 ? t("common.task") : t("common.tasks")}`}
            </span>
          </header>

          <ul className="flex flex-col">
            {(shown ?? rows).map((row) =>
              row.kind === "task" ? (
                <li
                  key={row.task.id}
                  draggable={!["DONE"].includes(row.task.status)}
                  onDragStart={() => setDragging(row.task.id)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging) moveTo(dragging, row.task.id);
                    setDragging(null);
                  }}
                  className={
                    dragging === row.task.id ? "opacity-40" : undefined
                  }
                >
                  <TaskButton
                    task={row.task}
                    onPause={() => setPausing(row.task.id)}
                    onBlocked={setBlocked}
                    onMove={(dir: "up" | "down") => {
                      const ids = (shown ?? taskRows).map((r) =>
                        r.kind === "task" ? r.task.id : "",
                      );
                      const i = ids.indexOf(row.task.id);
                      const j = dir === "up" ? i - 1 : i + 1;
                      if (j >= 0 && j < ids.length) moveTo(ids[i], ids[j]);
                    }}
                  />
                </li>
              ) : (
                <li
                  key={`${row.kind}-${row.start}`}
                  className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0"
                >
                  <span className="w-4 shrink-0" />
                  <span className="num w-[88px] shrink-0 text-[12px] text-faint">
                    {formatClock(row.start)}
                  </span>
                  <span className="h-4 w-[3px] shrink-0" />
                  <span
                    className={`text-[12px] ${
                      row.kind === "break" ? "text-faint" : "text-muted"
                    }`}
                  >
                    {row.kind === "break"
                      ? `${t("myDay.breakLabel")} · ${formatDuration(row.end - row.start)}`
                      : `${formatDuration(row.end - row.start)} ${t("common.free")}`}
                  </span>
                  <span className="h-px flex-1 border-t border-dashed border-line" />
                </li>
              ),
            )}

            {rows.length === 0 && (
              <li className="px-4 py-12 text-center">
                <p className="text-[14px] font-medium">{t("myDay.nothingScheduled")}</p>
                <p className="mt-1 text-[13px] text-muted">
                  {t("myDay.nothingScheduledHint")}
                </p>
              </li>
            )}
          </ul>
        </section>

        {/* ------------------------------------------------------- the rail */}
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-5">
          {active ? (
            <section
              className={`card card-body border-l-[3px] ${
                active.status === "IN_PROGRESS"
                  ? "border-l-run"
                  : "border-l-pause"
              }`}
            >
              <p
                className={`eyebrow ${
                  active.status === "IN_PROGRESS" ? "text-run" : "text-pause"
                }`}
              >
                {active.status === "IN_PROGRESS"
                  ? t("myDay.runningNow")
                  : t("myDay.paused")}
              </p>
              <p className="mt-1.5 text-[15px] font-semibold text-balance">
                {active.title}
              </p>

              <p
                className={`num mt-3 text-[38px] leading-none font-medium tracking-[-0.03em] ${
                  over ? "text-pause" : ""
                }`}
              >
                {stopwatch(elapsed)}
              </p>
              <p className="num mt-1.5 text-[12px] text-muted">
                {over
                  ? t("myDay.overEstimate", formatDuration(active.estimatedMinutes))
                  : `${formatDuration(
                      Math.max(
                        0,
                        active.estimatedMinutes - Math.floor(elapsed / 60),
                      ),
                    )} ${t("myDay.leftOf")} ${formatDuration(active.estimatedMinutes)}`}
              </p>

              <div className="my-3.5 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${over ? "bg-pause" : "bg-run"}`}
                  style={{
                    width: `${Math.min(
                      100,
                      (elapsed / (active.estimatedMinutes * 60)) * 100,
                    )}%`,
                  }}
                />
              </div>

              {active.status === "PAUSED" && active.pauseText && (
                <p className="notice notice-warn mb-3">
                  <span className="eyebrow mb-0.5 block text-pause">{t("myDay.paused")}</span>
                  {active.pauseText}
                </p>
              )}

              {/* Catalogue warnings belong in front of you while you work,
                  not in a spreadsheet nobody reopens. */}
              {active.notes && (
                <p className="mb-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
                  {active.notes}
                </p>
              )}
              {active.instructions && (
                <p className="mb-3 text-[12px] text-muted">
                  {t("myDay.howTo")} {active.instructions}
                </p>
              )}

              <TaskButton.Controls
                task={active}
                onPause={() => setPausing(active.id)}
              />
            </section>
          ) : (
            <section className="card card-body text-center">
              <p className="text-[13px] font-medium">{t("myDay.nothingRunning")}</p>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {t("myDay.startFromList")}
              </p>
            </section>
          )}

          {!view.liveMeeting && (
            <div className="flex justify-center">
              <StartMeetingButton />
            </div>
          )}

          <section className="card">
            <header className="card-head">
              <span className="eyebrow">{t("myDay.dayAtAGlance")}</span>
            </header>
            <dl className="px-4 py-1.5">
              <Stat label={t("myDay.booked")}>
                {formatDuration(booked)} of {formatDuration(view.availableMinutes)}
              </Stat>
              <Stat label={t("myDay.finished")}>{formatDuration(done)}</Stat>
              <Stat label={t("myDay.leftToDo")}>{formatDuration(booked - done)}</Stat>
              <Stat label={t("myDay.unbooked")}>
                {formatDuration(Math.max(0, view.availableMinutes - booked))}
              </Stat>
            </dl>
          </section>
        </aside>
      </div>

      {blocked && (
        <DeferDialog
          blocked={blocked}
          today={view.date}
          onClose={() => setBlocked(null)}
          onDeferred={() => setBlocked(null)}
        />
      )}

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
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="num text-[13px] font-semibold">{children}</dd>
    </div>
  );
}
