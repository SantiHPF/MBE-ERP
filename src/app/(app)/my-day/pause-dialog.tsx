"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { pauseTask, type ActionState } from "@/lib/tasks/actions";

const REASONS = [
  { id: "BREAK", label: "Break" },
  { id: "WAITING_CLIENT", label: "Waiting on client" },
  { id: "WAITING_INTERNAL", label: "Waiting on someone here" },
  { id: "MEETING", label: "Pulled into a meeting" },
  { id: "INTERRUPTION", label: "Interrupted" },
  { id: "OTHER", label: "Something else" },
] as const;

const initial: ActionState = {};

/**
 * Pausing requires both a category and a written note. That is deliberate:
 * the whole reason this system asks is so a stalled task says why, and a
 * one-click pause would collect nothing worth reading.
 */
export function PauseDialog({
  taskId,
  title,
  onClose,
}: {
  taskId: string;
  title: string;
  onClose: () => void;
}) {
  const [state, submit, pending] = useActionState(pauseTask, initial);
  const [reason, setReason] = useState<string | null>(null);
  const [text, setText] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textarea.current?.focus();
  }, []);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = reason !== null && text.trim().length >= 3;

  const hint = !reason
    ? "Pick what is holding it up."
    : text.trim().length < 3
      ? "A few words — enough for your manager to act on."
      : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
        className="w-full max-w-[430px] rounded-[10px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)]"
      >
        <p className="eyebrow">
          Pausing
        </p>
        <h2 id="pause-title" className="mt-1 text-[16px] font-semibold tracking-[-0.012em]">
          {title}
        </h2>
        <p className="mt-1 mb-4 text-[12.5px] text-muted">
          The reason is what tells your manager whether the hold-up is yours to
          fix. It is required — nothing pauses silently.
        </p>

        <form action={submit}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="reasonCode" value={reason ?? ""} />

          <fieldset className="mb-3.5">
            <legend className="mb-2 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
              What is holding it up
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={reason === r.id}
                  onClick={() => setReason(r.id)}
                  className={
                    reason === r.id
                      ? "rounded-full border border-accent bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink"
                      : "rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label
            htmlFor="reasonText"
            className="field-label"
          >
            In your words
          </label>
          <textarea
            id="reasonText"
            name="reasonText"
            ref={textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Pallet scanner is out of battery, charging it now"
            className="field min-h-[74px] resize-y"
          />

          <p
            className={`mt-1.5 mb-3.5 min-h-4 text-[11.5px] ${
              state.error ? "text-stall" : "text-muted"
            }`}
          >
            {state.error ?? hint}
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2"
            >
              Keep working
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
            >
              {pending ? "Pausing…" : "Pause task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
