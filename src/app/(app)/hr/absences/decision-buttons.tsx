"use client";

import { useActionState, useState } from "react";
import {
  approveAbsence,
  rejectAbsence,
  type DecisionState,
} from "@/lib/hr/absence-decisions";
import { cancelAbsence } from "@/lib/absence/actions";
import { useT } from "@/lib/i18n/client";

const initial: DecisionState = {};

export function DecisionButtons({ absenceId }: { absenceId: string }) {
  const { t } = useT();
  const [approveState, approve, approving] = useActionState(
    approveAbsence,
    initial,
  );
  const [rejectState, reject, rejecting] = useActionState(
    rejectAbsence,
    initial,
  );
  const [, withdraw] = useActionState(
    async (p: DecisionState, f: FormData) => {
      const r = await cancelAbsence({}, f);
      return { error: r.error, ok: r.ok } as DecisionState;
    },
    initial,
  );
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");

  const error = approveState.error ?? rejectState.error;
  const busy = approving || rejecting;

  if (showReject) {
    return (
      <form action={reject} className="flex flex-col gap-2">
        <input type="hidden" name="absenceId" value={absenceId} />
        <label className="text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
          {t("hr.whyTurnDown")}
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
            placeholder={t("hr.theyWillSee")}
            className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13px] font-normal tracking-normal normal-case"
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-stall">
            {error}
          </p>
        )}

        <div className="flex gap-1.5">
          <button
            type="submit"
            disabled={busy || note.trim().length === 0}
            className="rounded border border-stall bg-stall px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-45"
          >
            {rejecting ? t("hr.rejecting") : t("hr.reject")}
          </button>
          <button
            type="button"
            onClick={() => setShowReject(false)}
            className="btn"
          >
            {t("hr.back")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <form action={approve}>
        <input type="hidden" name="absenceId" value={absenceId} />
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary"
        >
          {approving ? t("hr.approving") : t("hr.approve")}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setShowReject(true)}
        disabled={busy}
        className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] hover:border-stall hover:text-stall disabled:opacity-50"
      >
        {t("hr.reject")}
      </button>

      {/* Withdrawing is not the same as rejecting: it removes a request that
          should never have been made, rather than turning one down. */}
      <form action={withdraw}>
        <input type="hidden" name="absenceId" value={absenceId} />
        <button
          type="submit"
          disabled={busy}
          title={t("hr.withdrawTip")}
          className="rounded border border-line px-2.5 py-1.5 text-[13px] text-muted hover:border-stall hover:text-stall disabled:opacity-50"
        >
          {t("hr.withdraw")}
        </button>
      </form>

      {approveState.ok && approveState.orphaned ? (
        <span className="text-xs text-muted">
          {t(
            "hr.sentToManager",
            `${approveState.orphaned} ${approveState.orphaned === 1 ? t("common.task") : t("common.tasks")}`,
          )}
        </span>
      ) : null}

      {error && (
        <span role="alert" className="text-xs text-stall">
          {error}
        </span>
      )}
    </div>
  );
}
