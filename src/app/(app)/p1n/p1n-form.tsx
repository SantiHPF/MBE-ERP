"use client";

import { useActionState, useState } from "react";
import { fileP1n, type P1nState } from "@/lib/p1n/actions";
import { useT } from "@/lib/i18n/client";

/**
 * Filing a P1N, on its own.
 *
 * Separate from the P1N page because the moment you notice a mistake is
 * usually the moment you are working, not the moment you are reading the
 * list -- so My Day opens the same form rather than a second version of it.
 */

const initial: P1nState = {};

const CAUSES = ["ATTENTION", "PROCESS", "OTHER"] as const;

const CAUSE_KEY: Record<string, string> = {
  ATTENTION: "p1n.causeAttention",
  PROCESS: "p1n.causeProcess",
  OTHER: "p1n.causeOther",
};

/** The trigger plus the form, for pages that only need to file one. */
export function FileP1nButton({
  tasks,
  defaultTaskId,
}: {
  tasks: { id: string; label: string }[];
  defaultTaskId?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-sm"
        title={t("p1n.subtitle")}
      >
        {t("p1n.fileOne")}
      </button>
    );
  }

  return (
    <div className="w-full">
      <NewP1nForm
        tasks={tasks}
        defaultTaskId={defaultTaskId}
        onDone={() => setOpen(false)}
      />
    </div>
  );
}

export function NewP1nForm({
  tasks,
  onDone,
  defaultTaskId,
}: {
  tasks: { id: string; label: string }[];
  onDone: () => void;
  /** Preselected when the form is opened from somewhere with an obvious subject. */
  defaultTaskId?: string;
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
        <select id="p1n-task" name="taskId" defaultValue={defaultTaskId ?? ""} className="field">
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
