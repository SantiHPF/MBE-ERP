"use client";

import { useActionState, useState } from "react";
import {
  cancelAbsence,
  updateAbsence,
  type AbsenceState,
} from "@/lib/absence/actions";
import { useT } from "@/lib/i18n/client";

const initial: AbsenceState = {};

const CATEGORY_IDS = ["SICK", "HOLIDAY", "PERSONAL", "OTHER"] as const;

export type AbsenceRecord = {
  id: string;
  startDate: string;
  endDate: string;
  scope: "FULL_DAY" | "PARTIAL";
  startTime: string | null;
  endTime: string | null;
  category: string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  statusLabel: string;
  decisionNote: string | null;
  /** False once HR has decided and you are not HR. */
  editable: boolean;
};

export function AbsenceRow({ absence }: { absence: AbsenceRecord }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState(absence.scope);
  const [state, save, saving] = useActionState(updateAbsence, initial);
  const [cancelState, cancel, cancelling] = useActionState(
    cancelAbsence,
    initial,
  );
  const [confirming, setConfirming] = useState(false);

  const error = state.error ?? cancelState.error;

  const badge =
    absence.status === "APPROVED"
      ? "border-run text-run"
      : absence.status === "REJECTED"
        ? "border-stall text-stall"
        : "border-pause text-pause";

  if (!editing) {
    return (
      <li className="rounded border border-line bg-surface px-3.5 py-2.5">
        <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
          <span className="rounded border border-line px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-muted uppercase">
            {absence.category.toLowerCase()}
          </span>
          <span className="num">
            {absence.startDate}
            {absence.endDate !== absence.startDate && ` → ${absence.endDate}`}
          </span>
          {absence.scope === "PARTIAL" && absence.startTime && (
            <span className="num text-xs text-muted">
              {absence.startTime}–{absence.endTime}
            </span>
          )}
          {absence.note && (
            <span className="text-muted">— {absence.note}</span>
          )}
          <span className="flex-1" />
          <span
            className={`rounded border px-1.5 py-px text-[9.5px] font-semibold tracking-wider uppercase ${badge}`}
          >
            {absence.statusLabel}
          </span>

          {absence.editable ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="btn btn-sm"
              >
                {t("common.change")}
              </button>
              {confirming ? (
                <form action={cancel} className="flex items-center gap-1">
                  <input type="hidden" name="absenceId" value={absence.id} />
                  <button
                    type="submit"
                    disabled={cancelling}
                    className="rounded border border-stall bg-stall px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {cancelling ? t("calendar.removing") : t("calendar.yesRemove")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="rounded border border-line-strong px-2 py-0.5 text-[11px]"
                  >
                    {t("calendar.keep")}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="rounded border border-line-strong px-2 py-0.5 text-[11px] hover:border-stall hover:text-stall"
                >
                  {t("common.remove")}
                </button>
              )}
            </>
          ) : (
            <span className="text-[11px] text-muted">
              {t("calendar.hrDecided")}
            </span>
          )}
        </div>

        {absence.status === "REJECTED" && absence.decisionNote && (
          <p className="mt-1 text-xs text-stall">
            {t("calendar.hrSaid", absence.decisionNote)}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-stall">
            {error}
          </p>
        )}
      </li>
    );
  }

  const field =
    "rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]";

  return (
    <li className="rounded border border-accent bg-surface px-3.5 py-3">
      <form action={save} className="flex flex-col gap-2.5">
        <input type="hidden" name="absenceId" value={absence.id} />
        <input type="hidden" name="scope" value={scope} />

        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_IDS.map((id) => (
            <label
              key={id}
              className="cursor-pointer rounded-full border border-line-strong px-3 py-1 text-xs text-muted has-checked:border-accent has-checked:bg-accent has-checked:font-medium has-checked:text-accent-ink"
            >
              <input
                type="radio"
                name="category"
                value={id}
                defaultChecked={absence.category === id}
                className="sr-only"
              />
              {t(`calendar.categories.${id}`)}
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px]">
            <span className="field-label">
              {t("common.from")}
            </span>
            <input
              type="date"
              name="startDate"
              defaultValue={absence.startDate}
              required
              className={`num ${field}`}
            />
          </label>
          <label className="text-[11px]">
            <span className="field-label">
              {t("common.to")}
            </span>
            <input
              type="date"
              name="endDate"
              defaultValue={absence.endDate}
              required
              className={`num ${field}`}
            />
          </label>

          <div className="flex gap-1.5">
            {(["FULL_DAY", "PARTIAL"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={
                  scope === s
                    ? "rounded border border-accent bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
                    : "rounded border border-line-strong px-2.5 py-1.5 text-xs text-muted"
                }
              >
                {s === "FULL_DAY" ? t("calendar.wholeDay") : t("calendar.partOfDay")}
              </button>
            ))}
          </div>
        </div>

        {scope === "PARTIAL" && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px]">
              <span className="field-label">
                {t("calendar.awayFrom")}
              </span>
              <input
                type="time"
                name="startTime"
                defaultValue={absence.startTime ?? "09:00"}
                className={`num ${field}`}
              />
            </label>
            <label className="text-[11px]">
              <span className="field-label">
                {t("calendar.backAt")}
              </span>
              <input
                type="time"
                name="endTime"
                defaultValue={absence.endTime ?? "13:00"}
                className={`num ${field}`}
              />
            </label>
          </div>
        )}

        <input
          type="text"
          name="note"
          defaultValue={absence.note ?? ""}
          maxLength={500}
          placeholder={t("calendar.addNote")}
          className={field}
        />

        <p className="text-[11.5px] text-muted">
          {t("calendar.changingResets")}
        </p>

        {error && (
          <p role="alert" className="text-xs text-stall">
            {error}
          </p>
        )}

        <div className="flex gap-1.5">
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? t("common.saving") : t("catalogue.saveChanges")}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="btn"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </li>
  );
}
