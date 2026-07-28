"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import type { PlanCell, PlanRow, PlanWeek } from "@/lib/plan/week";
import { formatDuration } from "@/lib/time";
import {
  createAdHocTask,
  toggleTaskDay,
  toggleTaskRow,
  type PlanState,
} from "@/lib/plan/actions";

type Filter = "all" | "mine" | "recurring" | "unclaimed";

export function PlanBoard({ week }: { week: PlanWeek }) {
  const [notice, setNotice] = useState<PlanState>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return week.rows.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (filter === "mine") return row.mineCount > 0;
      if (filter === "recurring") return row.recurring;
      if (filter === "unclaimed")
        return row.cells.some((c) => c.state === "free");
      return true;
    });
  }, [week.rows, query, filter]);

  function run(form: FormData, action: typeof toggleTaskDay) {
    startTransition(async () => {
      const result = await action({}, form);
      setNotice(result);
    });
  }

  function toggleCell(row: PlanRow, cell: PlanCell) {
    if (cell.state === "off" || cell.state === "locked" || cell.state === "theirs")
      return;
    const form = new FormData();
    form.set("date", cell.date);
    form.set("wanted", cell.state === "mine" ? "false" : "true");
    if (row.templateId) form.set("templateId", row.templateId);
    if (cell.taskId) form.set("taskId", cell.taskId);
    run(form, toggleTaskDay);
  }

  function toggleWholeRow(row: PlanRow, wanted: boolean) {
    const form = new FormData();
    form.set("wanted", wanted ? "true" : "false");
    if (row.templateId) form.set("templateId", row.templateId);
    row.cells.forEach((cell, i) => {
      // Taking "all" should not quietly book you in on a day off; those days
      // are shown so they can be chosen deliberately, one cell at a time.
      if (wanted && !week.days[i]?.rostered) return;
      const changeable = wanted
        ? cell.state === "empty" || cell.state === "free"
        : cell.state === "mine";
      if (!changeable) return;
      form.append("dates", cell.date);
      form.append("cell", `${cell.date}|${cell.taskId ?? ""}`);
    });
    if (!form.getAll("dates").length) return;
    run(form, toggleTaskRow);
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a task…"
          className="w-56 rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
        />
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["mine", "Mine"],
              ["recurring", "Recurring"],
              ["unclaimed", "Going spare"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={
                filter === id
                  ? "rounded border border-accent bg-accent-wash px-2.5 py-1 text-[12px] font-medium text-accent"
                  : "rounded border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-muted hover:bg-surface-2"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="num text-[12px] text-muted">{rows.length} tasks</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded border border-accent bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:brightness-110"
        >
          {adding ? "Close" : "+ New task"}
        </button>
        {pending && <span className="text-[12px] text-muted">saving…</span>}
      </div>

      {adding && (
        <NewTaskForm
          days={week.days}
          onDone={(s) => {
            setNotice(s);
            if (s.ok) setAdding(false);
          }}
        />
      )}

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

      <div className="overflow-x-auto rounded border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border-b border-line bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
                Task
              </th>
              <th className="border-b border-line bg-surface-2 px-2 py-2 text-right text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
                Mins
              </th>
              {week.days.map((day) => (
                <th
                  key={day.date}
                  className={`w-[68px] border-b border-l border-line px-1 py-2 text-center ${
                    day.overBy > 0 ? "bg-stall-wash" : "bg-surface-2"
                  }`}
                >
                  <span
                    className={`block text-[11px] font-semibold tracking-[0.07em] uppercase ${
                      day.rostered ? "text-ink" : "text-faint"
                    }`}
                  >
                    {day.short}
                  </span>
                  <span className="num block text-[10px] text-muted">
                    {day.date.slice(8)}/{day.date.slice(5, 7)}
                  </span>
                  {day.absent ? (
                    <span className="block text-[10px] font-semibold text-stall">
                      away
                    </span>
                  ) : day.rostered || day.claimedMinutes > 0 ? (
                    // What is still going spare, not what is used -- that is
                    // the number you plan against.
                    <span
                      className={`num block text-[10px] ${
                        day.overBy > 0
                          ? "font-semibold text-stall"
                          : day.freeMinutes === 0
                            ? "font-semibold text-pause"
                            : "text-muted"
                      }`}
                      title={`${formatDuration(day.claimedMinutes)} taken of ${formatDuration(day.capacityMinutes)}`}
                    >
                      {day.overBy > 0
                        ? `${formatDuration(day.overBy)} over`
                        : `${formatDuration(day.freeMinutes)} free`}
                    </span>
                  ) : (
                    <span className="block text-[10px] text-faint">off</span>
                  )}
                </th>
              ))}
              <th className="w-[70px] border-b border-l border-line bg-surface-2 px-1 py-2 text-center text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
                All
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-surface-2/60">
                <td className="border-b border-line px-3 py-1.5">
                  <span className="text-[13px]">{row.name}</span>
                  {row.notes && (
                    <span
                      title={row.notes}
                      className="ml-1.5 cursor-help text-[10px] font-bold text-pause"
                    >
                      !
                    </span>
                  )}
                </td>
                <td className="num border-b border-line px-2 py-1.5 text-right text-[12px] text-muted">
                  {row.estimatedMinutes}
                </td>

                {row.cells.map((cell) => (
                  <td
                    key={cell.date}
                    className="border-b border-l border-line p-0 text-center"
                  >
                    <Cell
                      cell={cell}
                      onClick={() => toggleCell(row, cell)}
                      label={row.name}
                    />
                  </td>
                ))}

                <td className="border-b border-l border-line p-0 text-center">
                  <div className="flex justify-center gap-0.5 py-1">
                    <button
                      type="button"
                      title={`Take ${row.name} on every day you work`}
                      onClick={() => toggleWholeRow(row, true)}
                      className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] hover:border-accent hover:text-accent"
                    >
                      all
                    </button>
                    <button
                      type="button"
                      title={`Give back every day of ${row.name}`}
                      onClick={() => toggleWholeRow(row, false)}
                      className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] hover:border-stall hover:text-stall"
                    >
                      none
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted">
        <Key className="border-accent bg-accent text-accent-ink">✓</Key>
        <span>yours</span>
        <Key className="border-dashed border-line-strong text-muted">·</Key>
        <span>free to take</span>
        <Key className="border-line-strong bg-surface-2 text-faint">–</Key>
        <span>someone else has it</span>
        <Key className="border-run bg-run-wash text-run">✓</Key>
        <span>started or done — can&rsquo;t change</span>
      </div>
    </>
  );
}

function NewTaskForm({
  days,
  onDone,
}: {
  days: PlanWeek["days"];
  onDone: (s: PlanState) => void;
}) {
  const [state, submit, pending] = useActionState(
    async (p: PlanState, f: FormData) => {
      const r = await createAdHocTask(p, f);
      onDone(r);
      return r;
    },
    {} as PlanState,
  );

  const first = days.find((d) => d.rostered) ?? days[0];

  return (
    <form
      action={submit}
      className="mb-3 flex flex-wrap items-end gap-2 rounded border border-accent bg-accent-wash p-3"
    >
      <label className="flex-1 text-[11px] min-w-52">
        <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
          What needs doing
        </span>
        <input
          name="title"
          required
          autoFocus
          placeholder="Something not in the catalogue"
          className="w-full rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
        />
      </label>

      <label className="text-[11px]">
        <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
          Minutes
        </span>
        <input
          type="number"
          name="estimatedMinutes"
          defaultValue={30}
          min={1}
          max={720}
          step={1}
          required
          className="num w-24 rounded border border-line-strong bg-surface px-2 py-1.5 text-[13px]"
        />
      </label>

      <label className="text-[11px]">
        <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
          Day
        </span>
        <select
          name="date"
          defaultValue={first?.date}
          className="rounded border border-line-strong bg-surface px-2 py-1.5 text-[13px]"
        >
          {days.map((d) => (
            <option key={d.date} value={d.date}>
              {d.label} {d.date.slice(8)}/{d.date.slice(5, 7)} ·{" "}
              {d.rostered ? `${formatDuration(d.freeMinutes)} free` : "not working"}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add to my week"}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-[12px] text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}

function Cell({
  cell,
  onClick,
  label,
}: {
  cell: PlanCell;
  onClick: () => void;
  label: string;
}) {
  const base =
    "mx-auto my-1 flex h-6 w-9 items-center justify-center rounded border text-[12px]";

  if (cell.state === "off") {
    return <span className={`${base} border-transparent text-faint`}>·</span>;
  }

  if (cell.state === "locked") {
    return (
      <span
        title="Already started — plan it from My day"
        className={`${base} border-run bg-run-wash text-run`}
      >
        ✓
      </span>
    );
  }

  if (cell.state === "theirs") {
    return (
      <span
        title={`${cell.holder} has this one`}
        className={`${base} border-line-strong bg-surface-2 text-[10px] text-faint`}
      >
        {(cell.holder ?? "?").slice(0, 3)}
      </span>
    );
  }

  const mine = cell.state === "mine";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={mine}
      aria-label={`${mine ? "Give back" : "Take"} ${label} on ${cell.date}`}
      title={
        mine
          ? "Yours — click to give it back"
          : cell.state === "free"
            ? "Needed this day, nobody has it — click to take it"
            : "Click to add it to this day"
      }
      className={
        mine
          ? `${base} border-accent bg-accent font-semibold text-accent-ink`
          : cell.state === "free"
            ? `${base} border-pause border-dashed bg-pause-wash text-pause hover:bg-pause hover:text-white`
            : `${base} border-dashed border-line-strong text-faint hover:border-accent hover:text-accent`
      }
    >
      {mine ? "✓" : cell.state === "free" ? "!" : "+"}
    </button>
  );
}

function Key({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-5 w-7 items-center justify-center rounded border text-[11px] ${className}`}
    >
      {children}
    </span>
  );
}
