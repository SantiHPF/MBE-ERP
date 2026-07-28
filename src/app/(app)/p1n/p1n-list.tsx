"use client";

import { useActionState, useState } from "react";
import { fileP1n, markApplied, type P1nState } from "@/lib/p1n/actions";
import { useT } from "@/lib/i18n/client";
import { NewP1nForm } from "./p1n-form";

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
