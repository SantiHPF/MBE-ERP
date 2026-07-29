"use client";

import { useActionState, useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  logCandidateConversation,
  logSourceConversation,
  type CrmState,
} from "@/lib/crm/actions";
import type { CallList } from "@/lib/tasks/day";

const initial: CrmState = {};

/**
 * The list behind a batched call task.
 *
 * The task says "four calls"; this says who they are, what was said last time,
 * and takes down what happened. Logging one ticks it off the block's counter,
 * so progress reads the same as any other repeatable task.
 */
export function CallPanel({
  taskId,
  list,
}: {
  taskId: string;
  list: CallList;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);

  const rows =
    list.kind === "SOURCE"
      ? list.sources.map((s) => ({
          key: s.sourceId,
          title: s.sourceName,
          subtitle: s.contactName
            ? [s.contactName, s.contactJobTitle].filter(Boolean).join(" · ")
            : null,
          phone: s.phone,
          warning: s.contactId ? null : t("crm.noContactYet"),
          lastNote: s.lastNote,
        }))
      : list.candidates.map((c) => ({
          key: c.candidateId,
          title: c.name,
          subtitle: null,
          phone: c.phone,
          warning: null,
          lastNote: null,
        }));

  if (rows.length === 0) {
    return (
      <section className="card card-body mb-5">
        <p className="text-[13px] font-medium text-run">{t("crm.callsDone")}</p>
      </section>
    );
  }

  return (
    <section className="card mb-5">
      <header className="card-head">
        <span className="eyebrow">{t("crm.callsTitle")}</span>
        <span className="num text-[12px] text-muted">
          {t("crm.callsIntro", rows.length)}
        </span>
      </header>

      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.key} className="border-b border-line last:border-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="text-[13.5px] font-medium">{row.title}</span>
              {row.subtitle && (
                <span className="text-[12.5px] text-muted">{row.subtitle}</span>
              )}
              {row.phone ? (
                <a
                  href={`tel:${row.phone}`}
                  className="num text-[12.5px] text-accent hover:underline"
                >
                  {row.phone}
                </a>
              ) : (
                <span className="text-[12px] text-faint">—</span>
              )}
              {row.warning && (
                <span className="badge badge-warn">{row.warning}</span>
              )}

              <span className="flex-1" />

              <button
                type="button"
                onClick={() => setOpen(open === row.key ? null : row.key)}
                className="btn btn-sm btn-primary"
              >
                {open === row.key ? t("common.close") : t("crm.logCall")}
              </button>
            </div>

            {/* What was said last time, so nobody opens with a question that
                was answered two months ago. */}
            {row.lastNote && open !== row.key && (
              <p className="px-4 pb-2.5 text-[12px] text-muted">
                <span className="eyebrow mr-1.5">{t("crm.lastTime")}</span>
                {row.lastNote}
              </p>
            )}

            {open === row.key && (
              <div className="border-t border-line bg-surface-2 p-4">
                <LogForm
                  taskId={taskId}
                  list={list}
                  id={row.key}
                  onDone={() => setOpen(null)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LogForm({
  taskId,
  list,
  id,
  onDone,
}: {
  taskId: string;
  list: CallList;
  id: string;
  onDone: () => void;
}) {
  const { t } = useT();
  const isSource = list.kind === "SOURCE";
  const [outcome, setOutcome] = useState<"TALKED" | "NO_ANSWER" | "LEFT_MESSAGE">(
    "TALKED",
  );

  const [state, submit, pending] = useActionState(
    async (p: CrmState, f: FormData) => {
      const r = isSource
        ? await logSourceConversation(p, f)
        : await logCandidateConversation(p, f);
      if (r.ok) onDone();
      return r;
    },
    initial,
  );

  const contactId = isSource
    ? (list.sources.find((s) => s.sourceId === id)?.contactId ?? "")
    : "";

  return (
    <form action={submit} className="flex flex-col gap-2.5">
      <input type="hidden" name="taskId" value={taskId} />
      {isSource ? (
        <>
          <input type="hidden" name="sourceId" value={id} />
          <input type="hidden" name="contactId" value={contactId} />
        </>
      ) : (
        <input type="hidden" name="candidateId" value={id} />
      )}
      <input type="hidden" name="outcome" value={outcome} />

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["TALKED", t("crm.talked")],
            ["NO_ANSWER", t("crm.noAnswer")],
            ["LEFT_MESSAGE", t("crm.leftMessage")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={outcome === id}
            onClick={() => setOutcome(id)}
            className={
              outcome === id
                ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* The consequence, said plainly before they commit to it. */}
      {!isSource && outcome === "NO_ANSWER" && (
        <p className="notice notice-warn">{t("crm.noAnswerCandidateHint")}</p>
      )}

      <label className="text-[11px]">
        <span className="field-label">{t("crm.whatWasSaid")}</span>
        <textarea
          name="notes"
          autoFocus
          required={outcome === "TALKED"}
          className="field min-h-[64px] resize-y"
        />
      </label>

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? t("common.saving") : t("crm.save")}
        </button>
        <button type="button" onClick={onDone} className="btn btn-sm">
          {t("common.cancel")}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-[12px] text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}
