"use client";

import { useActionState, useState } from "react";
import {
  approveAbsence,
  rejectAbsence,
  type DecisionState,
} from "@/lib/hr/absence-decisions";

const initial: DecisionState = {};

export function DecisionButtons({ absenceId }: { absenceId: string }) {
  const [approveState, approve, approving] = useActionState(
    approveAbsence,
    initial,
  );
  const [rejectState, reject, rejecting] = useActionState(
    rejectAbsence,
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
          Why are you turning it down?
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
            placeholder="They will see this"
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
            {rejecting ? "Rejecting…" : "Reject"}
          </button>
          <button
            type="button"
            onClick={() => setShowReject(false)}
            className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] hover:bg-surface-2"
          >
            Back
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
          className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
        >
          {approving ? "Approving…" : "Approve"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setShowReject(true)}
        disabled={busy}
        className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] hover:border-stall hover:text-stall disabled:opacity-50"
      >
        Reject
      </button>

      {approveState.ok && approveState.orphaned ? (
        <span className="text-xs text-muted">
          {approveState.orphaned} task
          {approveState.orphaned === 1 ? "" : "s"} sent to their manager.
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
