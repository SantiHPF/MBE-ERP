"use client";

import { useActionState, useState } from "react";
import { fileP1n, markApplied, type P1nState } from "@/lib/p1n/actions";
import { useT } from "@/lib/i18n/client";

const initial: P1nState = {};

export type P1nEntry = {
  id: string;
  mistake: string;
  cause: "ATTENTION" | "PROCESS" | "OTHER";
  solution: string;
  taskTitle: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
  appliedAt: string | null;
  appliedByName: string | null;
  appliedNote: string | null;
};

const CAUSES = ["ATTENTION", "PROCESS", "OTHER"] as const;

const CAUSE_KEY: Record<string, string> = {
  ATTENTION: "p1n.causeAttention",
  PROCESS: "p1n.causeProcess",
  OTHER: "p1n.causeOther",
};

export function P1nList({
  entries,
  tasks,
  canApply,
  currentUserId,
}: {
  entries: P1nEntry[];
  tasks: { id: string; label: string }[];
  canApply: boolean;
  currentUserId: string;
}) {
  const { t } = useT();
  const [writing, setWriting] = useState(false);
  const [filter, setFilter] = useState<"all" | "mine">("all");

  const shown = entries.filter(
    (e) => filter === "all" || e.authorId === currentUserId,
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(
            [
              ["all", t("p1n.department")],
              ["mine", t("p1n.yours")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={
                filter === id
                  ? "rounded-md border border-accent bg-accent-wash px-2.5 py-1 text-[12px] font-medium text-accent"
                  : "rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-muted hover:bg-surface-2"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setWriting((v) => !v)}
          className="btn btn-primary btn-sm"
        >
          {writing ? t("common.close") : t("p1n.fileOne")}
        </button>
      </div>

      {writing && (
        <NewP1nForm tasks={tasks} onDone={() => setWriting(false)} />
      )}

      {shown.length === 0 ? (
        <p className="empty">{t("p1n.none")}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((entry) => (
            <Entry key={entry.id} entry={entry} canApply={canApply} />
          ))}
        </div>
      )}
    </>
  );
}

function Entry({
  entry,
  canApply,
}: {
  entry: P1nEntry;
  canApply: boolean;
}) {
  const { t } = useT();
  const [, apply, applying] = useActionState(markApplied, initial);

  return (
    <article
      className={`card ${entry.appliedAt ? "border-run/40" : ""}`}
    >
      <header className="card-head">
        <span className="text-[13px] font-medium">
          {t("p1n.filedBy", entry.authorName, entry.createdAt)}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {/* Which of the two it was is the useful part, so it leads. */}
          <span
            className={`badge ${
              entry.cause === "PROCESS" ? "badge-warn" : "badge-accent"
            }`}
          >
            {entry.cause === "ATTENTION"
              ? t("p1n.countAttention")
              : entry.cause === "PROCESS"
                ? t("p1n.countProcess")
                : t("p1n.causeOther")}
          </span>
          {entry.appliedAt && (
            <span className="badge badge-go">{t("p1n.applied")}</span>
          )}
        </span>
      </header>

      <div className="card-body flex flex-col gap-2.5">
        <div>
          <p className="eyebrow mb-1">{t("p1n.whatHappened")}</p>
          <p className="text-[13.5px] leading-relaxed">{entry.mistake}</p>
          {entry.taskTitle && (
            <p className="mt-1 text-[12px] text-muted">{entry.taskTitle}</p>
          )}
        </div>

        <div>
          <p className="eyebrow mb-1">{t("p1n.whyItHappened")}</p>
          <p className="text-[13.5px]">{t(CAUSE_KEY[entry.cause])}</p>
        </div>

        <div>
          <p className="eyebrow mb-1">{t("p1n.solution")}</p>
          <p className="text-[13.5px] leading-relaxed">{entry.solution}</p>
        </div>

        {entry.appliedAt ? (
          <p className="notice notice-ok">
            {t("p1n.appliedBy", entry.appliedByName ?? "—")}
            {entry.appliedNote && ` — ${entry.appliedNote}`}
          </p>
        ) : (
          canApply && (
            <form action={apply} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="p1nId" value={entry.id} />
              <input
                name="note"
                placeholder={t("p1n.markApplied")}
                className="field flex-1 min-w-48"
              />
              <button type="submit" disabled={applying} className="btn">
                {applying ? t("common.saving") : t("p1n.applied")}
              </button>
            </form>
          )
        )}

        {entry.appliedAt && canApply && (
          <form action={apply}>
            <input type="hidden" name="p1nId" value={entry.id} />
            <button type="submit" className="btn btn-sm btn-danger">
              {t("p1n.unmarkApplied")}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

function NewP1nForm({
  tasks,
  onDone,
}: {
  tasks: { id: string; label: string }[];
  onDone: () => void;
}) {
  const { t } = useT();
  const [cause, setCause] = useState<(typeof CAUSES)[number]>("ATTENTION");
  const [state, submit, pending] = useActionState(
    async (p: P1nState, f: FormData) => {
      const r = await fileP1n(p, f);
      if (r.ok) onDone();
      return r;
    },
    initial,
  );

  return (
    <form action={submit} className="card card-body mb-4 flex flex-col gap-4">
      <div>
        <label htmlFor="p1n-mistake" className="field-label">
          {t("p1n.whatHappened")}
        </label>
        <textarea
          id="p1n-mistake"
          name="mistake"
          required
          minLength={10}
          placeholder={t("p1n.whatHappenedHint")}
          className="field min-h-[80px] resize-y"
        />
      </div>

      <fieldset>
        <legend className="field-label">{t("p1n.whyItHappened")}</legend>
        <div className="flex flex-col gap-1.5">
          {CAUSES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={cause === id}
              onClick={() => setCause(id)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                cause === id
                  ? "border-accent bg-accent-wash"
                  : "border-line-strong bg-surface hover:border-accent"
              }`}
            >
              <span className="block text-[13px] font-medium">
                {t(CAUSE_KEY[id])}
              </span>
              {id !== "OTHER" && (
                <span className="block text-[12px] text-muted">
                  {t(
                    id === "ATTENTION"
                      ? "p1n.causeAttentionHint"
                      : "p1n.causeProcessHint",
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
        <input type="hidden" name="cause" value={cause} />
      </fieldset>

      <div>
        <label htmlFor="p1n-solution" className="field-label">
          {t("p1n.solution")}
        </label>
        <textarea
          id="p1n-solution"
          name="solution"
          required
          minLength={10}
          placeholder={t("p1n.solutionHint")}
          className="field min-h-[80px] resize-y"
        />
      </div>

      <div>
        <label htmlFor="p1n-task" className="field-label">
          {t("p1n.relatedTask")}
        </label>
        <select id="p1n-task" name="taskId" defaultValue="" className="field">
          <option value="">{t("p1n.noTask")}</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.label}
            </option>
          ))}
        </select>
      </div>

      {state.error && (
        <p role="alert" className="notice notice-bad">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? t("p1n.sending") : t("p1n.send")}
        </button>
        <button type="button" onClick={onDone} className="btn">
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
