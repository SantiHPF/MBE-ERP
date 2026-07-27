"use client";

import { useActionState, useState } from "react";
import type { PlanDay, PlanTask, PlanWeek } from "@/lib/plan/week";
import { formatDuration } from "@/lib/time";
import {
  addTaskToDay,
  claimTask,
  moveTaskToDay,
  releaseTask,
  skipTask,
  type PlanState,
} from "@/lib/plan/actions";

const initial: PlanState = {};

export function PlanBoard({ week }: { week: PlanWeek }) {
  const [notice, setNotice] = useState<PlanState>({});

  return (
    <>
      {(notice.error ?? notice.message) && (
        <p
          role="status"
          className={`mb-3 rounded border px-3 py-2 text-[13px] ${
            notice.error
              ? "border-stall bg-stall-wash text-stall"
              : "border-run bg-run-wash text-run"
          }`}
        >
          {notice.error ?? notice.message}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {week.days.map((day) => (
          <DayColumn
            key={day.date}
            day={day}
            week={week}
            onNotice={setNotice}
          />
        ))}
      </div>
    </>
  );
}

function DayColumn({
  day,
  week,
  onNotice,
}: {
  day: PlanDay;
  week: PlanWeek;
  onNotice: (s: PlanState) => void;
}) {
  const [adding, setAdding] = useState(false);
  const pct = day.capacityMinutes
    ? Math.min(100, (day.claimedMinutes / day.capacityMinutes) * 100)
    : 0;

  return (
    <section
      className={`flex flex-col rounded border bg-surface shadow-sm ${
        day.overBy > 0 ? "border-stall" : "border-line"
      }`}
    >
      <header className="border-b border-line px-3.5 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13.5px] font-semibold">{day.label}</span>
          <span className="num text-[11px] text-muted">
            {day.date.slice(8)}/{day.date.slice(5, 7)}
          </span>
        </div>

        {day.rostered ? (
          <>
            <div className="mt-1.5 h-1 overflow-hidden rounded bg-line">
              <div
                className={`h-full ${day.overBy > 0 ? "bg-stall" : "bg-accent"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p
              className={`num mt-1 text-[11px] ${
                day.overBy > 0 ? "font-semibold text-stall" : "text-muted"
              }`}
            >
              {formatDuration(day.claimedMinutes)} of{" "}
              {formatDuration(day.capacityMinutes)}
              {day.overBy > 0 && ` · ${formatDuration(day.overBy)} over`}
            </p>
          </>
        ) : (
          <p className="mt-1 text-[11px] text-faint">not working</p>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        {day.mine.map((task) => (
          <MineRow
            key={task.id}
            task={task}
            currentDate={day.date}
            days={week.days}
            onNotice={onNotice}
          />
        ))}

        {day.available.length > 0 && (
          <p className="mt-1 text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
            Free to take
          </p>
        )}
        {day.available.map((task) => (
          <AvailableRow key={task.id} task={task} onNotice={onNotice} />
        ))}

        {day.taken.length > 0 && (
          <p className="mt-1 text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
            Taken
          </p>
        )}
        {day.taken.map((task) => (
          <div
            key={task.id}
            className="flex items-baseline gap-1.5 rounded border border-line px-2 py-1 text-[12px] text-muted opacity-70"
          >
            <span className="truncate">{task.title}</span>
            <span className="flex-1" />
            <span className="shrink-0 text-[10.5px]">{task.assigneeName}</span>
          </div>
        ))}

        <div className="mt-auto pt-1.5">
          {adding ? (
            <AddForm
              date={day.date}
              catalogue={week.catalogue}
              onDone={(s) => {
                onNotice(s);
                if (s.ok) setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full rounded border border-dashed border-line-strong py-1.5 text-[12px] text-muted hover:border-accent hover:text-accent"
            >
              + Add a task
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function MineRow({
  task,
  currentDate,
  days,
  onNotice,
}: {
  task: PlanTask;
  currentDate: string;
  days: PlanDay[];
  onNotice: (s: PlanState) => void;
}) {
  const [, release] = useActionState(
    async (p: PlanState, f: FormData) => {
      const r = await releaseTask(p, f);
      onNotice(r);
      return r;
    },
    initial,
  );
  const [, move] = useActionState(
    async (p: PlanState, f: FormData) => {
      const r = await moveTaskToDay(p, f);
      onNotice(r);
      return r;
    },
    initial,
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded border border-accent bg-accent-wash px-2 py-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="truncate text-[12.5px] font-medium">{task.title}</span>
        {task.notes && (
          <span
            title={task.notes}
            className="shrink-0 cursor-help text-[9px] font-bold text-pause"
          >
            !
          </span>
        )}
        <span className="flex-1" />
        <span className="num shrink-0 text-[10.5px] text-muted">
          {formatDuration(task.estimatedMinutes)}
        </span>
      </div>

      {task.locked ? (
        <p className="mt-0.5 text-[10.5px] text-muted">
          already started — can&rsquo;t move it
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[10.5px] hover:bg-surface-2"
          >
            Move
          </button>
          <form action={release}>
            <input type="hidden" name="taskId" value={task.id} />
            <button
              type="submit"
              className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[10.5px] hover:border-stall hover:text-stall"
            >
              Give back
            </button>
          </form>
        </div>
      )}

      {open && (
        <div className="mt-1 flex flex-wrap gap-1">
          {days
            .filter((d) => d.rostered && d.date !== currentDate)
            .map((d) => (
              <form key={d.date} action={move}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="date" value={d.date} />
                <button
                  type="submit"
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:border-accent hover:text-accent"
                >
                  {d.label.slice(0, 3)}
                </button>
              </form>
            ))}
        </div>
      )}
    </div>
  );
}

function AvailableRow({
  task,
  onNotice,
}: {
  task: PlanTask;
  onNotice: (s: PlanState) => void;
}) {
  const [, claim, claiming] = useActionState(
    async (p: PlanState, f: FormData) => {
      const r = await claimTask(p, f);
      onNotice(r);
      return r;
    },
    initial,
  );
  const [, skip] = useActionState(
    async (p: PlanState, f: FormData) => {
      const r = await skipTask(p, f);
      onNotice(r);
      return r;
    },
    initial,
  );

  return (
    <div className="rounded border border-dashed border-line-strong px-2 py-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="truncate text-[12.5px]">{task.title}</span>
        {task.notes && (
          <span
            title={task.notes}
            className="shrink-0 cursor-help text-[9px] font-bold text-pause"
          >
            !
          </span>
        )}
        <span className="flex-1" />
        <span className="num shrink-0 text-[10.5px] text-muted">
          {formatDuration(task.estimatedMinutes)}
        </span>
      </div>
      <div className="mt-1 flex gap-1">
        <form action={claim}>
          <input type="hidden" name="taskId" value={task.id} />
          <button
            type="submit"
            disabled={claiming}
            className="rounded border border-accent bg-accent px-2 py-0.5 text-[10.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
          >
            I&rsquo;ll do it
          </button>
        </form>
        <form action={skip}>
          <input type="hidden" name="taskId" value={task.id} />
          <button
            type="submit"
            className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted hover:border-stall hover:text-stall"
          >
            Skip
          </button>
        </form>
      </div>
    </div>
  );
}

function AddForm({
  date,
  catalogue,
  onDone,
  onCancel,
}: {
  date: string;
  catalogue: PlanWeek["catalogue"];
  onDone: (s: PlanState) => void;
  onCancel: () => void;
}) {
  const [state, submit, pending] = useActionState(
    async (p: PlanState, f: FormData) => {
      const r = await addTaskToDay(p, f);
      onDone(r);
      return r;
    },
    initial,
  );
  const [confirm, setConfirm] = useState(false);

  // The duplicate warning is the only error worth a second chance at.
  const needsConfirm = state.error?.includes("Add another anyway");

  return (
    <form action={submit} className="flex flex-col gap-1">
      <input type="hidden" name="date" value={date} />
      <input
        type="hidden"
        name="confirmDuplicate"
        value={confirm ? "true" : "false"}
      />

      <select
        name="templateId"
        required
        defaultValue=""
        className="w-full rounded border border-line-strong bg-surface-2 px-1.5 py-1 text-[12px]"
      >
        <option value="" disabled>
          Pick from the catalogue…
        </option>
        {catalogue.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} · {formatDuration(t.estimatedMinutes)}
          </option>
        ))}
      </select>

      {needsConfirm && (
        <label className="flex items-start gap-1.5 text-[10.5px] text-pause">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          Someone already has it that day — add another anyway
        </label>
      )}

      <div className="flex gap-1">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded border border-accent bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-line-strong px-2 py-1 text-[11px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
