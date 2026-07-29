"use client";

import { useActionState, useState } from "react";
import { confirmDay } from "@/lib/attendance/actions";
import { useT } from "@/lib/i18n/client";
import { formatDayMonth, fromDateKey } from "@/lib/i18n/dates";

/**
 * Yesterday's guess, put in front of the person who can correct it.
 *
 * When nobody closes a day the sweep infers an end and marks it NEEDS_REVIEW.
 * That flag is only worth having if somebody sees it, and a report nobody
 * opens is not somebody seeing it -- so it is asked here, once, the next
 * morning. Confirming is as valid an answer as correcting.
 */
export function ReviewDay({
  review,
  clockGuess,
}: {
  review: { id: string; date: string; endClock: string };
  clockGuess: string;
}) {
  const { t, locale } = useT();
  const [state, submit, pending] = useActionState(confirmDay, {});
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState(clockGuess);

  if (state.ok) return null;

  return (
    <div className="notice notice-warn mb-4">
      <p className="eyebrow mb-1 text-pause">
        {t("attendance.reviewTitle")} ·{" "}
        {formatDayMonth(fromDateKey(review.date), locale)}
      </p>
      <p className="mb-2.5 text-[13px]">
        {t("attendance.reviewGuess", clockGuess)}
      </p>

      <form action={submit} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="dayId" value={review.id} />

        {editing ? (
          <>
            <label className="flex items-center gap-1.5 text-[12.5px]">
              {t("attendance.reviewInstead")}
              <input
                type="time"
                name="endTime"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                className="field num w-28 py-1"
              />
            </label>
            <button type="submit" disabled={pending} className="btn btn-sm btn-primary">
              {pending ? t("attendance.reviewSaving") : t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn btn-sm"
            >
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            {/* Empty means "the guess was right" -- confirmDay treats a blank
                time as confirmation rather than as a missing field. */}
            <input type="hidden" name="endTime" value="" />
            <button type="submit" disabled={pending} className="btn btn-sm btn-primary">
              {pending ? t("attendance.reviewSaving") : t("attendance.reviewConfirm")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn btn-sm"
            >
              {t("attendance.reviewInstead")}…
            </button>
          </>
        )}

        {state.error && (
          <span role="alert" className="text-[12px] text-stall">
            {state.error}
          </span>
        )}
      </form>
    </div>
  );
}
