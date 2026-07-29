"use client";

import { useEffect, useState, useTransition } from "react";
import type { DayTask } from "@/lib/tasks/day";
import { deferTask } from "@/lib/tasks/actions";
import { endDay } from "@/lib/attendance/actions";
import { formatClock, formatDuration } from "@/lib/time";
import { useT } from "@/lib/i18n/client";

/**
 * Ending the workday on purpose.
 *
 * The clock has to stop somewhere, and the honest place is where the person
 * says it does. Everything still owed is listed here and rescheduled in the
 * same breath -- leaving it to be discovered tomorrow is how work quietly goes
 * missing, and marking it done on their behalf would be a lie.
 *
 * One reason and one date cover the whole list. At the end of a long day,
 * asking for five separate explanations is asking for five copies of "no me
 * dio tiempo".
 */
export function CloseDayDialog({
  leftovers,
  today,
  onClose,
  onClosed,
}: {
  leftovers: DayTask[];
  today: string;
  onClose: () => void;
  onClosed: () => void;
}) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState(() => nextDay(today));
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const moving = leftovers.filter((task) => !skip.has(task.id));
  const needsReason = moving.length > 0;
  const ready = !needsReason || (reason.trim().length >= 3 && when.length === 10);

  function toggle(id: string) {
    setSkip((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    start(async () => {
      // Reschedule first, so the day is only closed once the work has a new
      // home. If one fails, nothing is closed and the message says which.
      for (const task of moving) {
        const form = new FormData();
        form.set("taskId", task.id);
        form.set("reason", reason.trim());
        form.set("date", when);
        const result = await deferTask({}, form);
        if (result.error) {
          setError(`${task.title}: ${result.error}`);
          return;
        }
      }

      const closed = await endDay({}, new FormData());
      if (closed.error) {
        setError(closed.error);
        return;
      }
      onClosed();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-day-title"
        className="max-h-[86vh] w-full max-w-[480px] overflow-y-auto rounded-[10px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)]"
      >
        <p className="eyebrow">{t("attendance.endOfDay")}</p>
        <h2
          id="close-day-title"
          className="mt-1 text-[16px] font-semibold tracking-[-0.012em]"
        >
          {t("attendance.closeDayTitle")}
        </h2>

        {leftovers.length === 0 ? (
          <p className="mt-1.5 mb-4 text-[12.5px] text-muted">
            {t("attendance.nothingLeft")}
          </p>
        ) : (
          <>
            <p className="mt-1.5 mb-3 text-[12.5px] text-muted">
              {t("attendance.leftoversIntro", leftovers.length)}
            </p>

            <ul className="mb-4 flex flex-col gap-1">
              {leftovers.map((task) => {
                const moved = !skip.has(task.id);
                return (
                  <li key={task.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-[12.5px] transition-colors ${
                        moved
                          ? "border-line bg-surface-2"
                          : "border-line opacity-55"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={moved}
                        onChange={() => toggle(task.id)}
                        className="shrink-0"
                      />
                      <span className="num shrink-0 text-[11px] text-faint">
                        {task.scheduledStart != null
                          ? formatClock(task.scheduledStart)
                          : "—"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      <span className="num shrink-0 text-[11px] text-faint">
                        {formatDuration(task.estimatedMinutes)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {/* Unticking everything is allowed -- somebody may genuinely have
                abandoned a job rather than postponed it -- but then there is
                nothing to explain. */}
            {needsReason && (
              <>
                <label htmlFor="close-reason" className="field-label">
                  {t("attendance.whyNotDone")}
                </label>
                <textarea
                  id="close-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("attendance.reasonPlaceholder")}
                  className="field min-h-[62px] resize-y"
                />

                <p className="mt-3.5 mb-1.5 field-label">
                  {t("attendance.moveThemTo")}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    aria-pressed={when === nextDay(today)}
                    onClick={() => setWhen(nextDay(today))}
                    className={
                      when === nextDay(today)
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
              </>
            )}
          </>
        )}

        <p
          className={`mt-3 mb-3.5 min-h-4 text-[11.5px] ${
            error ? "text-stall" : "text-muted"
          }`}
        >
          {error ?? (needsReason && reason.trim().length < 3
            ? t("attendance.reasonHint")
            : t("attendance.closeHint"))}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready || pending}
            className="btn btn-primary"
          >
            {pending ? t("attendance.closing") : t("attendance.closeDay")}
          </button>
        </div>
      </div>
    </div>
  );
}

function nextDay(key: string): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
