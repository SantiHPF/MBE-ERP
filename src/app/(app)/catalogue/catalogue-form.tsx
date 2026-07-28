"use client";

import { useActionState, useState } from "react";
import { formatClock } from "@/lib/time";
import {
  saveCatalogueEntry,
  setCatalogueActive,
  type CatalogueState,
} from "@/lib/catalogue/actions";

const initial: CatalogueState = {};

export type CatalogueEntry = {
  id: string;
  name: string;
  category: string | null;
  estimatedMinutes: number;
  notes: string | null;
  instructions: string | null;
  isMeeting: boolean;
  priority: "MUST" | "NORMAL" | "SPARE_TIME";
  active: boolean;
  rule: {
    frequency: "WEEKLY" | "MONTHLY";
    weekdays: number[];
    monthlyNth: number | null;
    monthlyDay: number | null;
    instancesPerOccurrence: number;
    fixedStartMinutes: number | null;
  } | null;
};

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

type Freq = "NONE" | "WEEKLY" | "MONTHLY";

export function CatalogueForm({
  departmentId,
  entry,
  onDone,
  onCancel,
}: {
  departmentId: string;
  entry?: CatalogueEntry;
  onDone: (s: CatalogueState) => void;
  onCancel: () => void;
}) {
  const [state, submit, pending] = useActionState(
    async (p: CatalogueState, f: FormData) => {
      const r = await saveCatalogueEntry(p, f);
      onDone(r);
      return r;
    },
    initial,
  );
  const [, retire] = useActionState(
    async (p: CatalogueState, f: FormData) => {
      const r = await setCatalogueActive(p, f);
      onDone(r);
      return r;
    },
    initial,
  );

  // "Daily" is weekly on all five weekdays -- one concept fewer to model.
  const initialFreq: Freq = entry?.rule?.frequency ?? "NONE";
  const [freq, setFreq] = useState<Freq>(initialFreq);
  const [monthlyMode, setMonthlyMode] = useState<"NTH_WEEKDAY" | "DAY_OF_MONTH">(
    entry?.rule?.monthlyDay != null ? "DAY_OF_MONTH" : "NTH_WEEKDAY",
  );
  const [days, setDays] = useState<number[]>(
    entry?.rule?.frequency === "WEEKLY" ? entry.rule.weekdays : [],
  );
  const [atTime, setAtTime] = useState(
    entry?.rule?.fixedStartMinutes != null,
  );
  const [priority, setPriority] = useState<"MUST" | "NORMAL" | "SPARE_TIME">(
    entry?.priority ?? "NORMAL",
  );

  const label = "mb-1 block text-[11px] font-semibold tracking-[0.07em] text-faint uppercase";
  const field = "w-full rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13px]";

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="departmentId" value={departmentId} />
      {entry && <input type="hidden" name="templateId" value={entry.id} />}

      {/* ------------------------------------------------- what the task is */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_100px_minmax(0,1fr)]">
        <label className="text-[11px]">
          <span className={label}>Task name</span>
          <input
            name="name"
            defaultValue={entry?.name}
            required
            autoFocus={!entry}
            className={field}
          />
        </label>
        <label className="text-[11px]">
          <span className={label}>Minutes</span>
          <input
            type="number"
            name="estimatedMinutes"
            defaultValue={entry?.estimatedMinutes ?? 30}
            min={1}
            max={720}
            step={1}
            required
            className={`num ${field}`}
          />
        </label>
        <label className="text-[11px]">
          <span className={label}>Category (optional)</span>
          <input
            name="category"
            defaultValue={entry?.category ?? ""}
            placeholder="e.g. Reporting"
            className={field}
          />
        </label>
      </div>

      {/* ------------------------------------------------------ how it works */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px]">
          <span className={label}>Warnings (shown while doing it)</span>
          <input
            name="notes"
            defaultValue={entry?.notes ?? ""}
            placeholder="e.g. max 1 integrante por día"
            className={field}
          />
        </label>
        <label className="text-[11px]">
          <span className={label}>Where the procedure is</span>
          <input
            name="instructions"
            defaultValue={entry?.instructions ?? ""}
            placeholder="e.g. Ver Calendar"
            className={field}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          name="isMeeting"
          defaultChecked={entry?.isMeeting}
        />
        This is a meeting — starting it opens the notes pane
      </label>

      {/* --------------------------------------------------- how hard it pushes */}
      <fieldset className="rounded border border-line bg-surface-2 p-3">
        <legend className="px-1 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
          How important is it?
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["MUST", "Must be done", "First claim on the day. Assigned even when everyone is full — the day then shows as over."],
              ["NORMAL", "Normal", "Scheduled when there is room."],
              ["SPARE_TIME", "Only if there's time", "Backlog work. Fills a quiet day once everything else is placed."],
            ] as const
          ).map(([id, text, why]) => (
            <button
              key={id}
              type="button"
              title={why}
              aria-pressed={priority === id}
              onClick={() => setPriority(id)}
              className={
                priority === id
                  ? id === "MUST"
                    ? "rounded border border-stall bg-stall px-2.5 py-1 text-xs font-medium text-white"
                    : "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                  : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
              }
            >
              {text}
            </button>
          ))}
        </div>
        <input type="hidden" name="priority" value={priority} />
        <p className="mt-1.5 text-[11.5px] text-muted">
          {priority === "MUST"
            ? "It will be assigned to somebody every time it comes round, even if that puts them over their hours."
            : priority === "SPARE_TIME"
              ? "It only appears when someone still has free hours after everything else."
              : "Scheduled when there is room, dropped to the manager's queue when there is not."}
        </p>
      </fieldset>

      {/* --------------------------------------------------------- when */}
      <fieldset className="rounded border border-line bg-surface-2 p-3">
        <legend className="px-1 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
          When does it happen?
        </legend>

        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {(
            [
              ["NONE", "On demand"],
              ["WEEKLY", "Certain weekdays"],
              ["MONTHLY", "Monthly"],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={freq === id}
              onClick={() => setFreq(id)}
              className={
                freq === id
                  ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                  : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
              }
            >
              {text}
            </button>
          ))}
        </div>
        <input type="hidden" name="frequency" value={freq} />

        {freq === "NONE" && (
          <p className="text-[12px] text-muted">
            It stays in the catalogue and can be picked on the plan board, but
            it is never scheduled on its own.
          </p>
        )}

        {freq === "WEEKLY" && (
          <>
            <div className="flex flex-wrap gap-1">
              {DAYS.map(([n, text]) => {
                const on = days.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDays((d) =>
                        on ? d.filter((x) => x !== n) : [...d, n],
                      )
                    }
                    className={
                      on
                        ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                        : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                    }
                  >
                    {text}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setDays([1, 2, 3, 4, 5])}
                className="ml-1 rounded border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
              >
                Every weekday
              </button>
            </div>
            {days.map((d) => (
              <input key={d} type="hidden" name="weekdays" value={d} />
            ))}
            {days.length === 0 && (
              <p className="mt-1.5 text-[11.5px] text-pause">
                Pick at least one day.
              </p>
            )}
          </>
        )}

        {freq === "MONTHLY" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["NTH_WEEKDAY", "A particular weekday"],
                  ["DAY_OF_MONTH", "A date each month"],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={monthlyMode === id}
                  onClick={() => setMonthlyMode(id)}
                  className={
                    monthlyMode === id
                      ? "rounded border border-accent bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent"
                      : "rounded border border-line-strong bg-surface px-2.5 py-1 text-xs text-muted"
                  }
                >
                  {text}
                </button>
              ))}
            </div>
            <input type="hidden" name="monthlyMode" value={monthlyMode} />

            {monthlyMode === "NTH_WEEKDAY" ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="text-muted">The</span>
                <select
                  name="monthlyNth"
                  defaultValue={String(entry?.rule?.monthlyNth ?? -1)}
                  className="rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                >
                  <option value="1">first</option>
                  <option value="2">second</option>
                  <option value="3">third</option>
                  <option value="4">fourth</option>
                  <option value="-1">last</option>
                </select>
                <select
                  name="monthlyWeekday"
                  defaultValue={String(entry?.rule?.weekdays?.[0] ?? 1)}
                  className="rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                >
                  {DAYS.map(([n, text]) => (
                    <option key={n} value={n}>
                      {text}
                    </option>
                  ))}
                </select>
                <span className="text-muted">of each month</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="text-muted">Day</span>
                <input
                  type="number"
                  name="monthlyDay"
                  defaultValue={entry?.rule?.monthlyDay ?? 1}
                  min={1}
                  max={31}
                  className="num w-20 rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                />
                <span className="text-muted">
                  of each month — months too short simply skip it
                </span>
              </div>
            )}
          </div>
        )}

        {freq !== "NONE" && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-2.5">
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input
                type="checkbox"
                checked={atTime}
                onChange={(e) => setAtTime(e.target.checked)}
              />
              At a fixed time
            </label>
            {atTime ? (
              <input
                type="time"
                name="fixedStart"
                defaultValue={
                  entry?.rule?.fixedStartMinutes != null
                    ? formatClock(entry.rule.fixedStartMinutes)
                    : "09:00"
                }
                className="num rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
              />
            ) : (
              <span className="text-[11.5px] text-muted">
                Otherwise it is fitted into free time on the day.
              </span>
            )}

            <span className="flex-1" />

            <label className="flex items-center gap-1.5 text-[12.5px]">
              <span className="text-muted">Times per day</span>
              <input
                type="number"
                name="instancesPerOccurrence"
                defaultValue={entry?.rule?.instancesPerOccurrence ?? 1}
                min={1}
                max={20}
                className="num w-16 rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
              />
            </label>
          </div>
        )}
      </fieldset>

      {state.error && (
        <p role="alert" className="text-xs text-stall">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || (freq === "WEEKLY" && days.length === 0)}
          className="btn btn-primary"
        >
          {pending ? "Saving…" : entry ? "Save changes" : "Add to catalogue"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn"
        >
          Cancel
        </button>

        {entry && (
          <>
            <span className="flex-1" />
            <input type="hidden" name="active" value={entry.active ? "false" : "true"} />
            <button
              type="submit"
              formAction={retire}
              className={`rounded border px-2.5 py-1.5 text-[13px] ${
                entry.active
                  ? "border-line-strong hover:border-stall hover:text-stall"
                  : "border-accent text-accent"
              }`}
            >
              {entry.active ? "Retire" : "Bring back"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
