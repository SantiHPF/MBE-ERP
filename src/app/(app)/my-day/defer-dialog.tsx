"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deferTask, type ActionState, type BlockingTask } from "@/lib/tasks/actions";
import { formatClock } from "@/lib/time";

const initial: ActionState = {};

/**
 * Shown when the day's order stops you starting something.
 *
 * The point is not to trap people -- they can always go on -- it is to make
 * the slip visible: what you could not do, why, and when you will. Both
 * answers are required, because "skipped, no reason, no plan" is exactly the
 * information this system exists to stop losing.
 */
export function DeferDialog({
  blocked,
  today,
  onClose,
  onDeferred,
}: {
  blocked: BlockingTask;
  today: string;
  onClose: () => void;
  onDeferred: () => void;
}) {
  const [state, submit, pending] = useActionState(deferTask, initial);
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState(today);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  useEffect(() => {
    if (state.ok) onDeferred();
  }, [state.ok, onDeferred]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);

  const ready = reason.trim().length >= 3 && when.length === 10;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="defer-title"
        className="w-full max-w-[440px] rounded-lg border border-line bg-surface p-5 shadow-2xl"
      >
        <p className="text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
          Out of order
        </p>
        <h2 id="defer-title" className="mt-1 text-base font-semibold tracking-tight">
          {blocked.title} still needs doing
        </h2>
        <p className="mt-1 mb-4 text-xs text-muted">
          {blocked.start != null && `It was set for ${formatClock(blocked.start)}. `}
          You can move past it, but say what happened and when you will do it.
        </p>

        <form action={submit}>
          <input type="hidden" name="taskId" value={blocked.id} />
          <input type="hidden" name="date" value={when} />

          <label
            htmlFor="defer-reason"
            className="mb-1.5 block text-[11px] font-semibold tracking-[0.07em] text-faint uppercase"
          >
            Why couldn&rsquo;t you do it?
          </label>
          <textarea
            id="defer-reason"
            name="reason"
            ref={box}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. the portal was down all morning"
            className="min-h-[70px] w-full resize-y rounded border border-line-strong bg-surface-2 px-2.5 py-2 text-[13.5px]"
          />

          <p className="mt-3.5 mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
            When will you do it?
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={when === today}
              onClick={() => setWhen(today)}
              className={
                when === today
                  ? "rounded border border-accent bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink"
                  : "rounded border border-line-strong px-2.5 py-1 text-xs text-muted hover:border-accent"
              }
            >
              Later today
            </button>
            <button
              type="button"
              aria-pressed={when === tomorrowKey}
              onClick={() => setWhen(tomorrowKey)}
              className={
                when === tomorrowKey
                  ? "rounded border border-accent bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink"
                  : "rounded border border-line-strong px-2.5 py-1 text-xs text-muted hover:border-accent"
              }
            >
              Tomorrow
            </button>
            <input
              type="date"
              value={when}
              min={today}
              onChange={(e) => setWhen(e.target.value)}
              className="num rounded border border-line-strong bg-surface-2 px-2 py-1 text-xs"
            />
          </div>

          <p
            className={`mt-2 mb-3.5 min-h-4 text-[11.5px] ${
              state.error ? "text-stall" : "text-muted"
            }`}
          >
            {state.error ??
              (reason.trim().length < 3
                ? "A few words — your manager sees this."
                : "")}
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2"
            >
              I&rsquo;ll do it now
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
            >
              {pending ? "Moving…" : "Move it and carry on"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
