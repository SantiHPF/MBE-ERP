"use client";

import { useActionState, useState } from "react";
import type { OrphanedTask } from "@/lib/triage/queue";
import { formatClock, formatDuration } from "@/lib/time";
import {
  cancelTask,
  pushTask,
  reassignTask,
  type TriageState,
} from "@/lib/triage/actions";
import { useT } from "@/lib/i18n/client";

const initial: TriageState = {};

export function OrphanCard({ task }: { task: OrphanedTask }) {
  const { t } = useT();
  const [note, setNote] = useState("");
  const [reassignState, reassign, reassigning] = useActionState(
    reassignTask,
    initial,
  );
  const [pushState, push, pushing] = useActionState(pushTask, initial);
  const [cancelState, cancel, cancelling] = useActionState(cancelTask, initial);

  const error = reassignState.error ?? pushState.error ?? cancelState.error;
  const busy = reassigning || pushing || cancelling;

  return (
    <article className="rounded border border-stall bg-surface shadow-sm">
      <header className="flex flex-wrap items-baseline gap-2 border-b border-line px-3.5 py-2.5">
        <span className="text-sm font-semibold">{task.title}</span>
        <span className="num text-[11px] text-muted">
          {formatDuration(task.estimatedMinutes)}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted">
          {t("triage.was", task.previousAssignee ?? "—")}
          {task.scheduledDate && ` · ${task.scheduledDate}`}
        </span>
      </header>

      <div className="px-3.5 py-3">
        {error && (
          <p role="alert" className="mb-2.5 text-xs text-stall">
            {error}
          </p>
        )}

        {task.candidates.length > 0 ? (
          <>
            <p className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
              {t("triage.giveToSomeone")}
            </p>
            {/* Handing work over without a word about why is how people end
                up wondering what they did wrong. Optional, and it goes to
                them as a message alongside the task. */}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("triage.sayWhy")}
              aria-label={t("triage.sayWhy")}
              className="field mb-2"
            />
            <div className="mb-3.5 flex flex-wrap gap-1.5">
              {task.candidates.map((c) => (
                <form key={c.userId} action={reassign}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="userId" value={c.userId} />
                  <input type="hidden" name="note" value={note} />
                  <button
                    type="submit"
                    disabled={busy}
                    title={`${formatDuration(c.freeMinutes)} free · given this job ${c.timesGiven}×`}
                    className="rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] hover:border-accent hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span className="font-medium">{c.displayName}</span>
                    <span className="num ml-1.5 text-[11px] text-muted">
                      {formatClock(c.slotStart)} · {formatDuration(c.freeMinutes)}{" "}
                      free
                    </span>
                  </button>
                </form>
              ))}
            </div>
          </>
        ) : (
          <p className="mb-3.5 text-[13px] text-muted">
            {t("triage.nobodyElse")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {task.earliestOwnerDate ? (
            <form action={push}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="date" value={task.earliestOwnerDate} />
              <button
                type="submit"
                disabled={busy}
                className="rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] hover:border-accent hover:bg-surface-2 disabled:opacity-50"
              >
                {t("triage.pushTo", task.earliestOwnerDate)}
                <span className="ml-1.5 text-[11px] text-muted">
                  {t("triage.whenBack")}
                </span>
              </button>
            </form>
          ) : (
            <span className="text-[13px] text-muted">
              {t("triage.noFreeDay")}
            </span>
          )}

          <span className="flex-1" />

          <form action={cancel}>
            <input type="hidden" name="taskId" value={task.id} />
            <button
              type="submit"
              disabled={busy}
              className="rounded border border-line px-2.5 py-1.5 text-[13px] text-muted hover:border-stall hover:text-stall disabled:opacity-50"
            >
              {t("triage.doesNotNeedDoing")}
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}
