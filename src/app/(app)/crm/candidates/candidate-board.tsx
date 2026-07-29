"use client";

import { useActionState, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  applyFilters,
  EMPTY_FILTERS,
  type Field,
  type FilterState,
} from "@/lib/filters/filters";
import { FilterBar } from "../filter-bar";
import {
  deactivateCandidate,
  reactivateCandidate,
  saveCandidate,
  type CrmState,
} from "@/lib/crm/actions";

const initial: CrmState = {};

/** In order, and the only place the pipeline is written down for the UI. */
const STAGES = [
  ["APPLIED", "crm.stageApplied"],
  ["CALL", "crm.stageCall"],
  ["PROCESS", "crm.stageProcess"],
  ["TEST", "crm.stageTest"],
  ["OFFER", "crm.stageOffer"],
  ["HIRED", "crm.stageHired"],
] as const;

const REASONS = [
  "NOT_INTERESTED",
  "NO_REPLY",
  "REJECTED",
  "TOOK_ANOTHER_OFFER",
  "NOT_AVAILABLE",
  "OTHER",
] as const;

export type CandidateRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  stage: string;
  active: boolean;
  dropReason: string | null;
  dropNote: string | null;
  sourceId: string | null;
  sourceName: string | null;
  awaitingCall: boolean;
};

export function CandidateBoard({
  candidates,
  sources,
}: {
  candidates: CandidateRow[];
  sources: { id: string; name: string }[];
}) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  /** Everything a candidate row holds, declared once. */
  const fields = useMemo<Field<CandidateRow>[]>(
    () => [
      { key: "name", label: t("crm.contactName"), kind: "text", get: (c) => c.name },
      { key: "phone", label: t("crm.phone"), kind: "text", get: (c) => c.phone },
      { key: "email", label: t("crm.email"), kind: "text", get: (c) => c.email },
      { key: "notes", label: t("crm.notes"), kind: "text", get: (c) => c.notes },
      { key: "source", label: t("crm.source"), kind: "text", get: (c) => c.sourceName },
      {
        key: "stage",
        label: t("crm.stage"),
        kind: "enum",
        options: STAGES.map(([value, key]) => ({ value, label: t(key) })),
        get: (c) => c.stage,
      },
      {
        key: "sourceId",
        label: t("crm.source"),
        kind: "enum",
        options: sources.map((s) => ({ value: s.id, label: s.name })),
        get: (c) => c.sourceId,
      },
      {
        key: "dropReason",
        label: t("crm.whyInactive"),
        kind: "enum",
        options: REASONS.map((r) => ({ value: r, label: t(`crm.reason${r}`) })),
        get: (c) => c.dropReason,
      },
      {
        key: "active",
        label: t("filters.status"),
        kind: "bool",
        yes: t("filters.inProcess"),
        no: t("crm.inactive"),
        get: (c) => c.active,
      },
    ],
    [t, sources],
  );

  const shown = useMemo(
    () => applyFilters(candidates, fields, filters),
    [candidates, fields, filters],
  );

  /**
   * Inactive candidates now appear through the generic `active` filter rather
   * than a button of their own -- one way to do this instead of two, and it
   * composes with the rest.
   */
  const active = useMemo(() => shown.filter((c) => c.active), [shown]);
  const inactive = useMemo(() => shown.filter((c) => !c.active), [shown]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="btn btn-primary btn-sm"
        >
          {adding ? t("common.close") : t("crm.addCandidate")}
        </button>
      </div>

      <FilterBar
        fields={fields}
        state={filters}
        onChange={setFilters}
        shown={shown.length}
        total={candidates.length}
      />

      {adding && (
        <div className="card card-body mb-3">
          <CandidateForm sources={sources} onDone={() => setAdding(false)} />
        </div>
      )}

      <div className="flex flex-col gap-4">
        {STAGES.map(([stage, labelKey]) => {
          const inStage = active.filter((c) => c.stage === stage);
          return (
            <section key={stage}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="eyebrow">{t(labelKey)}</span>
                <span className="num text-[11px] text-faint">{inStage.length}</span>
                {stage === "CALL" && inStage.some((c) => c.awaitingCall) && (
                  <span className="badge badge-warn">{t("crm.dueNow")}</span>
                )}
              </div>
              {inStage.length === 0 ? (
                <p className="rounded border border-dashed border-line px-3 py-2 text-[12px] text-faint">
                  —
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {inStage.map((c) => (
                    <CandidateCard key={c.id} candidate={c} sources={sources} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {inactive.length > 0 && (
          <section>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="eyebrow">{t("crm.inactive")}</span>
              <span className="num text-[11px] text-faint">{inactive.length}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {inactive.map((c) => (
                <CandidateCard key={c.id} candidate={c} sources={sources} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function CandidateCard({
  candidate,
  sources,
}: {
  candidate: CandidateRow;
  sources: { id: string; name: string }[];
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [, revive] = useActionState(reactivateCandidate, initial);

  if (editing) {
    return (
      <li className="card card-body">
        <CandidateForm
          candidate={candidate}
          sources={sources}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className={`card ${candidate.active ? "" : "opacity-65"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
        <span className="text-[13.5px] font-medium">{candidate.name}</span>
        {candidate.phone && (
          <span className="num text-[12.5px] text-muted">{candidate.phone}</span>
        )}
        {candidate.email && (
          <span className="text-[12.5px] text-muted">{candidate.email}</span>
        )}
        {candidate.sourceName && (
          <span className="badge">{candidate.sourceName}</span>
        )}
        {candidate.awaitingCall && (
          <span className="badge badge-warn">{t("crm.dueNow")}</span>
        )}
        {!candidate.active && candidate.dropReason && (
          <span className="badge badge-stop">
            {t(`crm.reason${candidate.dropReason}`)}
          </span>
        )}

        <span className="flex-1" />

        <button type="button" onClick={() => setEditing(true)} className="btn btn-sm">
          {t("common.edit")}
        </button>
        {candidate.active ? (
          <button
            type="button"
            onClick={() => setDropping((v) => !v)}
            className="btn btn-sm btn-danger"
          >
            {t("crm.markInactive")}
          </button>
        ) : (
          <form action={revive}>
            <input type="hidden" name="id" value={candidate.id} />
            <button type="submit" className="btn btn-sm">
              {t("crm.reactivate")}
            </button>
          </form>
        )}
      </div>

      {(candidate.notes || candidate.dropNote) && (
        <p className="border-t border-line px-3.5 py-2 text-[12.5px] text-muted">
          {candidate.dropNote ?? candidate.notes}
        </p>
      )}

      {dropping && (
        <div className="border-t border-line p-3.5">
          <DropForm candidate={candidate} onDone={() => setDropping(false)} />
        </div>
      )}
    </li>
  );
}

/** Why somebody fell out, from a list so the reasons can be counted. */
function DropForm({
  candidate,
  onDone,
}: {
  candidate: CandidateRow;
  onDone: () => void;
}) {
  const { t } = useT();
  const [state, submit, pending] = useActionState(
    async (p: CrmState, f: FormData) => {
      const r = await deactivateCandidate(p, f);
      if (r.ok) onDone();
      return r;
    },
    initial,
  );

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={candidate.id} />
      <label className="text-[11px]">
        <span className="field-label">{t("crm.whyInactive")}</span>
        <select name="reason" defaultValue="NOT_INTERESTED" className="field" autoFocus>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`crm.reason${r}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-52 flex-1 text-[11px]">
        <span className="field-label">{t("crm.notes")}</span>
        <input name="note" className="field" />
      </label>
      <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
        {pending ? t("common.saving") : t("common.save")}
      </button>
      <button type="button" onClick={onDone} className="btn btn-sm">
        {t("common.cancel")}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-[12px] text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}

function CandidateForm({
  candidate,
  sources,
  onDone,
}: {
  candidate?: CandidateRow;
  sources: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { t } = useT();
  const [state, submit, pending] = useActionState(
    async (p: CrmState, f: FormData) => {
      const r = await saveCandidate(p, f);
      if (r.ok) onDone();
      return r;
    },
    initial,
  );

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      {candidate && <input type="hidden" name="id" value={candidate.id} />}

      <label className="min-w-44 flex-1 text-[11px]">
        <span className="field-label">{t("crm.sourceName")}</span>
        <input name="name" required defaultValue={candidate?.name} autoFocus className="field" />
      </label>
      <label className="text-[11px]">
        <span className="field-label">{t("crm.phone")}</span>
        <input name="phone" defaultValue={candidate?.phone ?? ""} className="field num w-32" />
      </label>
      <label className="min-w-44 flex-1 text-[11px]">
        <span className="field-label">{t("crm.email")}</span>
        <input name="email" type="email" defaultValue={candidate?.email ?? ""} className="field" />
      </label>

      <label className="text-[11px]">
        <span className="field-label">{t("crm.stage")}</span>
        <select name="stage" defaultValue={candidate?.stage ?? "APPLIED"} className="field">
          {STAGES.map(([stage, labelKey]) => (
            <option key={stage} value={stage}>
              {t(labelKey)}
            </option>
          ))}
        </select>
      </label>

      <label className="text-[11px]">
        <span className="field-label">{t("crm.source")}</span>
        <select name="sourceId" defaultValue={candidate?.sourceId ?? ""} className="field">
          <option value="">{t("crm.noSource")}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="w-full text-[11px]">
        <span className="field-label">{t("crm.notes")}</span>
        <textarea
          name="notes"
          defaultValue={candidate?.notes ?? ""}
          className="field min-h-[52px] resize-y"
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? t("common.saving") : t("common.save")}
      </button>
      <button type="button" onClick={onDone} className="btn">
        {t("common.cancel")}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-[12px] text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}
