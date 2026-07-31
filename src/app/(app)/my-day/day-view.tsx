"use client";

import { useState, useTransition } from "react";
import type { DayTask, DayView } from "@/lib/tasks/day";
import { reorderDay, type BlockingTask } from "@/lib/tasks/actions";
import { formatClock, formatDuration } from "@/lib/time";
import { useT } from "@/lib/i18n/client";
import { DeferDialog } from "./defer-dialog";
import { MeetingPanel, StartMeetingButton } from "./meeting-panel";
import { TaskButton } from "./task-button";
import { CallPanel } from "./call-panel";
import { CurrentTask } from "./current-task";
import { ReviewDay } from "./review-day";
import { currentTask, stillOwed } from "@/lib/tasks/now";
import { breaksBetween } from "@/lib/gaps/gap";
import { useNow } from "../now-provider";

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

  const breaks = breaksBetween(view.windows);
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

export function DayViewClient({
  view,
  zone,
}: {
  view: DayView;
  zone: string;
}) {
  const { t } = useT();
  // Pausing, finishing and closing the day are the bar's business now, so
  // they are driven from one place whichever page you are on.
  const { pause, blocked: cantDo, completed, fillGap } = useNow();
  const [blocked, setBlocked] = useState<BlockingTask | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [reordering, startReorder] = useTransition();
  const [showRest, setShowRest] = useState(false);

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
  // What the rail already calls "unbooked" -- the suggestion the dialog opens
  // with, which the person can then argue with.
  const freeMinutes = Math.max(0, view.availableMinutes - booked);
  const done = view.tasks
    .filter((t) => t.status === "DONE")
    .reduce((s, t) => s + t.estimatedMinutes, 0);

  const current = currentTask(view.tasks);
  const owed = stillOwed(view.tasks);
  // What is left once the task in hand is set aside.
  const rest = owed.filter((task) => task.id !== current?.id);
  const restMinutes = rest.reduce((sum, task) => sum + task.estimatedMinutes, 0);

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
      {/* Asked once, the morning after, where the person who knows the answer
          will actually see it. */}
      {view.attendance.review && (
        <ReviewDay
          review={view.attendance.review}
          clockGuess={view.attendance.review.endClock}
        />
      )}

      {view.callList && (
        <CallPanel
          taskId={view.callList.taskId}
          list={view.callList.list}
        />
      )}

      {view.liveMeeting && (
        <MeetingPanel
          meeting={view.liveMeeting}
          colleagues={view.colleagues}
          today={view.date}
        />
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_316px]">
        <div className="flex flex-col gap-3">
          {/* ------------------------------------------- the task in hand */}
          {current ? (
            <CurrentTask
              task={current}
              onPause={() => pause(current.id)}
              onBlocked={setBlocked}
              onCompleted={completed}
              onCantDo={cantDo}
            />
          ) : (
            <section className="card card-body text-center">
              <p className="text-[14px] font-medium">{t("now.allCaughtUp")}</p>
              <p className="mt-1 text-[13px] text-muted">
                {t("now.allCaughtUpHint")}
              </p>
              {/* Caught up is exactly when somebody wants more work, so this
                  is where asking for it belongs. */}
              <button
                type="button"
                onClick={() => fillGap(freeMinutes, true)}
                className="btn btn-sm btn-primary mx-auto mt-3"
              >
                {t("gaps.haveTime")}
              </button>
            </section>
          )}

          {/*
            The rest of the day, shut by default.

            Not deleted: dragging rows in this list is the only way to reorder
            a day, so cutting it would have removed the feature in silence.
          */}
          {rest.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowRest((v) => !v)}
                aria-expanded={showRest}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <span
                  aria-hidden
                  className={`text-[10px] text-faint transition-transform ${showRest ? "rotate-90" : ""}`}
                >
                  ▶
                </span>
                <span className="num">
                  {t("now.stillToDo", rest.length, formatDuration(restMinutes))}
                </span>
                <span className="flex-1" />
                {reordering && (
                  <span className="text-[12px] text-faint">
                    {t("myDay.savingOrder")}
                  </span>
                )}
              </button>
            </div>
          )}

          {showRest && (
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">{t("myDay.today")}</span>
            <span className="num text-[12px] text-muted">
              {`${view.tasks.length} ${view.tasks.length === 1 ? t("common.task") : t("common.tasks")}`}
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
                    onPause={() => pause(row.task.id)}
                    onBlocked={setBlocked}
                    onCompleted={completed}
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
          )}
        </div>

        {/* ------------------------------------------------------- the rail */}
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-5">
          {/*
            The running panel that used to sit here has become the card on the
            left -- one place saying what you are doing, not two. What is left
            is the day's arithmetic, which is not a list of what is coming.
          */}
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
                {formatDuration(booked)} {t("common.of")} {formatDuration(view.availableMinutes)}
              </Stat>
              <Stat label={t("myDay.finished")}>{formatDuration(done)}</Stat>
              <Stat label={t("myDay.leftToDo")}>{formatDuration(booked - done)}</Stat>
              <Stat label={t("myDay.unbooked")}>
                {formatDuration(freeMinutes)}
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

      {/* Nothing left to do means nothing to offer, so no dialog at all. */}
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
