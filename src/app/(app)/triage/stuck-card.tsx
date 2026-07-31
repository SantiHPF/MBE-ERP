"use client";

import { useActionState } from "react";
import { useT } from "@/lib/i18n/client";
import { formatDuration } from "@/lib/time";
import {
  cancelTask,
  dismissBlock,
  putItBack,
  type TriageState,
} from "@/lib/triage/actions";
import type { StuckTask } from "@/lib/triage/queue";

const initial: TriageState = {};

/**
 * One person's account of why they could not do something.
 *
 * The reason is the point of the card, so it is the largest thing on it. What
 * they chose is a badge rather than a heading: the manager is being asked
 * whether to agree, not being told what happened.
 */
export function StuckCard({ task }: { task: StuckTask }) {
  const { t } = useT();
  const [backState, back, goingBack] = useActionState(putItBack, initial);
  const [dropState, drop, dropping] = useActionState(cancelTask, initial);
  const [seenState, seen, dismissing] = useActionState(dismissBlock, initial);
  const error = backState.error ?? dropState.error ?? seenState.error;

  return (
    <div className="rounded border border-stall bg-stall-wash px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">{task.title}</span>
        <span className="num text-[12px] text-muted">
          {formatDuration(task.estimatedMinutes)}
        </span>
        <span className="text-xs text-muted">{task.who}</span>
        <span className="flex-1" />
        <span className="badge">{t(`blocked.outcome${task.outcome}`)}</span>
      </div>

      <p className="mt-1.5 text-[13.5px] leading-relaxed">{task.reason}</p>

      {task.movedTo && (
        <p className="num mt-1 text-[11.5px] text-muted">
          {t("blocked.movedTo", task.movedTo)}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/* Only offered while they still hold it. Something already handed
            back has no owner to give it back to; reassigning is that answer. */}
        {task.stillOwned && task.status === "SET_ASIDE" && (
          <form action={back}>
            <input type="hidden" name="taskId" value={task.taskId} />
            <button type="submit" disabled={goingBack} className="btn btn-sm">
              {t("blocked.putItBack")}
            </button>
          </form>
        )}

        {task.outcome === "CANCEL_REQUESTED" && (
          <form action={drop}>
            <input type="hidden" name="taskId" value={task.taskId} />
            <button
              type="submit"
              disabled={dropping}
              className="btn btn-sm btn-danger"
            >
              {t("blocked.agreeCancel")}
            </button>
          </form>
        )}

        <form action={seen}>
          <input type="hidden" name="blockId" value={task.blockId} />
          <button type="submit" disabled={dismissing} className="btn btn-sm">
            {t("blocked.noted")}
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-[12px] text-stall">
          {error}
        </p>
      )}
    </div>
  );
}
