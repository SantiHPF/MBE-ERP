"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { reportBlocked, type ActionState } from "@/lib/tasks/actions";
import { useT } from "@/lib/i18n/client";

const OUTCOMES = [
  "MOVED",
  "HANDED_BACK",
  "SET_ASIDE",
  "CANCEL_REQUESTED",
] as const;

const initial: ActionState = {};

/**
 * "I cannot do this one."
 *
 * The reason comes first and the choice second, on purpose: writing down what
 * actually happened is the part that has to survive into triage, and asking
 * for it after the decision would turn it into a formality.
 *
 * The choice is the person's. They know whether the person they were meant to
 * meet is back tomorrow or gone for a fortnight, and making them wait for a
 * manager to say so would leave the rest of the day stalled behind a task the
 * ordering rule will not let them skip.
 */
export function BlockedDialog({
  taskId,
  title,
  tomorrow,
  onClose,
}: {
  taskId: string;
  title: string;
  /** Sensible default for the date picker, from the server's own clock. */
  tomorrow: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [state, submit, pending] = useActionState(reportBlocked, initial);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<string>("MOVED");
  const [date, setDate] = useState(tomorrow);
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

  const ready = reason.trim().length >= 3 && (outcome !== "MOVED" || !!date);
  const hint =
    reason.trim().length < 3
      ? t("blocked.fewWords")
      : outcome === "MOVED" && !date
        ? t("blocked.pickADay")
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
        aria-labelledby="blocked-title"
        className="w-full max-w-[430px] rounded-[10px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)]"
      >
        <p className="eyebrow">{t("blocked.eyebrow")}</p>
        <h2
          id="blocked-title"
          className="mt-1 text-[16px] font-semibold tracking-[-0.012em]"
        >
          {title}
        </h2>
        <p className="mt-1 mb-4 text-[12.5px] text-muted">{t("blocked.intro")}</p>

        <form action={submit}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="outcome" value={outcome} />

          <label htmlFor="blockedReason" className="field-label">
            {t("blocked.whatHappened")}
          </label>
          <textarea
            id="blockedReason"
            name="reason"
            ref={textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("blocked.placeholder")}
            className="field min-h-[74px] resize-y"
          />

          <fieldset className="mt-3.5 mb-1">
            <legend className="mb-2 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
              {t("blocked.whatNow")}
            </legend>
            <div className="flex flex-col gap-1">
              {OUTCOMES.map((id) => (
                <label
                  key={id}
                  className={`flex cursor-pointer items-baseline gap-2 rounded border px-2.5 py-1.5 text-[13px] transition-colors ${
                    outcome === id
                      ? "border-accent bg-accent-wash"
                      : "border-line hover:border-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="outcomeChoice"
                    checked={outcome === id}
                    onChange={() => setOutcome(id)}
                    className="mt-0.5"
                  />
                  <span>
                    {t(`blocked.choose${id}`)}
                    <span className="block text-[11.5px] text-muted">
                      {t(`blocked.explain${id}`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Only the one outcome needs a date, so only it asks for one. */}
          {outcome === "MOVED" && (
            <label className="mt-2 block text-[11px]">
              <span className="field-label">{t("blocked.whenInstead")}</span>
              <input
                type="date"
                name="date"
                value={date}
                min={tomorrow}
                onChange={(e) => setDate(e.target.value)}
                className="field num"
              />
            </label>
          )}

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
              {t("blocked.neverMind")}
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
            >
              {pending ? t("common.saving") : t("blocked.tellThem")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
