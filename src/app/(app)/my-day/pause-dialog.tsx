"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { pauseTask, type ActionState } from "@/lib/tasks/actions";
import { useT } from "@/lib/i18n/client";

const REASON_IDS = [
  "BREAK",
  "WAITING_CLIENT",
  "WAITING_INTERNAL",
  "MEETING",
  "INTERRUPTION",
  "OTHER",
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
  const { t } = useT();
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
    ? t("pause.pickCategory")
    : text.trim().length < 3
      ? t("pause.fewWords")
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
          {t("pause.eyebrow")}
        </p>
        <h2 id="pause-title" className="mt-1 text-[16px] font-semibold tracking-[-0.012em]">
          {title}
        </h2>
        <p className="mt-1 mb-4 text-[12.5px] text-muted">
          {t("pause.why")}
        </p>

        <form action={submit}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="reasonCode" value={reason ?? ""} />

          <fieldset className="mb-3.5">
            <legend className="mb-2 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
              {t("pause.whatIsHolding")}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {REASON_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={reason === id}
                  onClick={() => setReason(id)}
                  className={
                    reason === id
                      ? "rounded-full border border-accent bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink"
                      : "rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                  }
                >
                  {t(`pause.reasons.${id}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <label
            htmlFor="reasonText"
            className="field-label"
          >
            {t("pause.inYourWords")}
          </label>
          <textarea
            id="reasonText"
            name="reasonText"
            ref={textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("pause.placeholder")}
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
              {t("pause.keepWorking")}
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
            >
              {pending ? t("pause.pausing") : t("pause.pauseTask")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
