"use client";

import { useActionState, useState } from "react";
import { recordAbsence, type AbsenceState } from "@/lib/absence/actions";
import { useT } from "@/lib/i18n/client";

const initial: AbsenceState = {};

const CATEGORY_IDS = ["SICK", "HOLIDAY", "PERSONAL", "OTHER"] as const;

/**
 * Recording an absence takes effect immediately -- a sick day cannot wait for
 * approval. The tasks it displaces go to the manager's triage queue rather
 * than being reassigned automatically.
 */
export function AbsenceForm() {
  const { t } = useT();
  const [state, submit, pending] = useActionState(recordAbsence, initial);
  const [scope, setScope] = useState<"FULL_DAY" | "PARTIAL">("FULL_DAY");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="card card-body">
      <h2 className="eyebrow">
        {t("calendar.tellThemAway")}
      </h2>
      <p className="mt-1 mb-3.5 text-xs text-muted">
        {t("calendar.awayIntro")}
      </p>

      <form action={submit} className="flex flex-col gap-3">
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
            {t("calendar.why")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_IDS.map((id, i) => (
              <label
                key={id}
                className="cursor-pointer rounded-full border border-line-strong px-3 py-1 text-xs text-muted has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-checked:font-medium"
              >
                <input
                  type="radio"
                  name="category"
                  value={id}
                  defaultChecked={i === 0}
                  className="sr-only"
                />
                {t(`calendar.categories.${id}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="field-label">
              {t("common.from")}
            </span>
            <input
              type="date"
              name="startDate"
              defaultValue={today}
              required
              className="field num"
            />
          </label>
          <label className="text-xs">
            <span className="field-label">
              {t("common.to")}
            </span>
            <input
              type="date"
              name="endDate"
              defaultValue={today}
              required
              className="field num"
            />
          </label>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
            {t("calendar.howMuch")}
          </legend>
          <div className="flex gap-1.5">
            {(["FULL_DAY", "PARTIAL"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={
                  scope === s
                    ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                    : "rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                }
              >
                {s === "FULL_DAY" ? t("calendar.wholeDay") : t("calendar.partOfDay")}
              </button>
            ))}
          </div>
          <input type="hidden" name="scope" value={scope} />
        </fieldset>

        {scope === "PARTIAL" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="field-label">
                {t("calendar.awayFrom")}
              </span>
              <input
                type="time"
                name="startTime"
                defaultValue="09:00"
                className="field num"
              />
            </label>
            <label className="text-xs">
              <span className="field-label">
                {t("calendar.backAt")}
              </span>
              <input
                type="time"
                name="endTime"
                defaultValue="13:00"
                className="field num"
              />
            </label>
          </div>
        )}

        <label className="text-xs">
          <span className="field-label">
            {t("calendar.addNote")}
          </span>
          <input
            type="text"
            name="note"
            maxLength={500}
            placeholder="e.g. back Thursday, phone is on"
            className="field"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-xs text-stall">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="text-xs text-run">
            {t("calendar.sentToHr")}
            {state.orphaned
              ? t(
                  "calendar.offNow",
                  `${state.orphaned} ${state.orphaned === 1 ? t("common.task") : t("common.tasks")}`,
                )
              : t("calendar.nothingChanges")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? t("calendar.sending") : t("calendar.sendToHr")}
        </button>
      </form>
    </section>
  );
}
