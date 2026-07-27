"use client";

import { useActionState, useState } from "react";
import { recordAbsence, type AbsenceState } from "@/lib/absence/actions";

const initial: AbsenceState = {};

const CATEGORIES = [
  { id: "SICK", label: "Sick" },
  { id: "HOLIDAY", label: "Holiday" },
  { id: "PERSONAL", label: "Personal" },
  { id: "OTHER", label: "Other" },
] as const;

/**
 * Recording an absence takes effect immediately -- a sick day cannot wait for
 * approval. The tasks it displaces go to the manager's triage queue rather
 * than being reassigned automatically.
 */
export function AbsenceForm() {
  const [state, submit, pending] = useActionState(recordAbsence, initial);
  const [scope, setScope] = useState<"FULL_DAY" | "PARTIAL">("FULL_DAY");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded border border-line bg-surface p-4 shadow-sm">
      <h2 className="text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
        Tell them you are away
      </h2>
      <p className="mt-1 mb-3.5 text-xs text-muted">
        HR sees every request. A sick day applies straight away — you are not
        counted as at work while you are off — and HR signs it off afterwards.
        Holiday and personal leave wait for HR before they change anything.
      </p>

      <form action={submit} className="flex flex-col gap-3">
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
            Why
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c, i) => (
              <label
                key={c.id}
                className="cursor-pointer rounded-full border border-line-strong px-3 py-1 text-xs text-muted has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-checked:font-medium"
              >
                <input
                  type="radio"
                  name="category"
                  value={c.id}
                  defaultChecked={i === 0}
                  className="sr-only"
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
              From
            </span>
            <input
              type="date"
              name="startDate"
              defaultValue={today}
              required
              className="num w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
              To
            </span>
            <input
              type="date"
              name="endDate"
              defaultValue={today}
              required
              className="num w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
            />
          </label>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
            How much
          </legend>
          <div className="flex gap-1.5">
            {(["FULL_DAY", "PARTIAL"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={
                  scope === s
                    ? "rounded border border-accent bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink"
                    : "rounded border border-line-strong px-2.5 py-1 text-xs text-muted hover:border-accent"
                }
              >
                {s === "FULL_DAY" ? "Whole day" : "Part of the day"}
              </button>
            ))}
          </div>
          <input type="hidden" name="scope" value={scope} />
        </fieldset>

        {scope === "PARTIAL" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
                Away from
              </span>
              <input
                type="time"
                name="startTime"
                defaultValue="09:00"
                className="num w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
                Back at
              </span>
              <input
                type="time"
                name="endTime"
                defaultValue="13:00"
                className="num w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
              />
            </label>
          </div>
        )}

        <label className="text-xs">
          <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
            Anything useful to add (optional)
          </span>
          <input
            type="text"
            name="note"
            maxLength={500}
            placeholder="e.g. back Thursday, phone is on"
            className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-xs text-stall">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="text-xs text-run">
            Sent to HR.
            {state.orphaned
              ? ` You are off from now — ${state.orphaned} ${state.orphaned === 1 ? "task has" : "tasks have"} gone to your manager.`
              : " Nothing changes on the schedule until HR approves it."}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send to HR"}
        </button>
      </form>
    </section>
  );
}
