"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deferTask, type ActionState, type BlockingTask } from "@/lib/tasks/actions";
import { formatClock } from "@/lib/time";
import { useT } from "@/lib/i18n/client";

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
  const { t } = useT();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="defer-title"
        className="w-full max-w-[440px] rounded-[10px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)]"
      >
        <p className="eyebrow">
          {t("defer.eyebrow")}
        </p>
        <h2 id="defer-title" className="mt-1 text-[16px] font-semibold tracking-[-0.012em]">
          {t("defer.stillNeeds", blocked.title)}
        </h2>
        <p className="mt-1 mb-4 text-[12.5px] text-muted">
          {blocked.start != null &&
            `${t("defer.wasSetFor", formatClock(blocked.start))} `}
          {t("defer.explain")}
        </p>

        <form action={submit}>
          <input type="hidden" name="taskId" value={blocked.id} />
          <input type="hidden" name="date" value={when} />

          <label
            htmlFor="defer-reason"
            className="field-label"
          >
            {t("defer.whyNot")}
          </label>
          <textarea
            id="defer-reason"
            name="reason"
            ref={box}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("defer.placeholder")}
            className="field min-h-[70px] resize-y"
          />

          <p className="mt-3.5 mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
            {t("defer.whenWill")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={when === today}
              onClick={() => setWhen(today)}
              className={
                when === today
                  ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                  : "rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
              }
            >
              {t("defer.laterToday")}
            </button>
            <button
              type="button"
              aria-pressed={when === tomorrowKey}
              onClick={() => setWhen(tomorrowKey)}
              className={
                when === tomorrowKey
                  ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                  : "rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
              }
            >
              {t("defer.tomorrow")}
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
                ? t("defer.managerSees")
                : "")}
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2"
            >
              {t("defer.doItNow")}
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
            >
              {pending ? t("defer.moving") : t("defer.moveOn")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
