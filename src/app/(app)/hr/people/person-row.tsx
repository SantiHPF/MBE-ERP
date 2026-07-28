"use client";

import { useActionState, useState } from "react";
import {
  changeDepartment,
  setEmploymentDates,
  resetPassword,
  setPersonActive,
  updateWorkingPattern,
  type PeopleState,
} from "@/lib/hr/people";
import { useT } from "@/lib/i18n/client";
import { WeekdayFields } from "./weekday-fields";

const initial: PeopleState = {};

type Person = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  department: string;
  departmentId: string;
  weeklySummary: string;
  startDate: string | null;
  endDate: string | null;
  patternSummary: {
    weekday: number;
    label: string;
    hours: string;
    breakMinutes: number;
    breakStart: string | null;
  }[];
};

export function PersonRow({
  person,
  departments,
}: {
  person: Person;
  departments: { id: string; name: string }[];
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [hoursState, saveHours, savingHours] = useActionState(
    updateWorkingPattern,
    initial,
  );
  const [activeState, toggleActive] = useActionState(setPersonActive, initial);
  const [pwState, resetPw, resetting] = useActionState(resetPassword, initial);
  const [moveState, move, moving] = useActionState(changeDepartment, initial);
  const [datesState, saveDates, savingDates] = useActionState(
    setEmploymentDates,
    initial,
  );

  const message =
    hoursState.message ??
    activeState.message ??
    pwState.message ??
    moveState.message ??
    datesState.message;
  const error =
    hoursState.error ??
    activeState.error ??
    pwState.error ??
    moveState.error ??
    datesState.error;

  return (
    <article
      className={`rounded border bg-surface ${
        person.active ? "border-line" : "border-line opacity-60"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2 px-3.5 py-2.5">
        <span className="text-[13.5px] font-medium">{person.displayName}</span>
        <span className="num text-xs text-muted">{person.username}</span>
        <span className="rounded border border-line px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-muted uppercase">
          {person.role.toLowerCase()}
        </span>
        <span className="text-xs text-muted">{person.department}</span>
        {!person.active && (
          <span className="rounded border border-stall px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-stall uppercase">
            {t("people.inactive")}
          </span>
        )}
        <span className="flex-1" />
        <span className="num text-xs text-muted">
          {person.startDate
            ? t("people.fromDate", person.startDate)
            : t("people.noStartDate")}
          {person.endDate && ` → ${person.endDate}`}
        </span>
        <span className="num text-xs text-muted">{person.weeklySummary}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="btn btn-sm"
        >
          {open ? t("common.close") : t("common.edit")}
        </button>
      </div>

      {!open && person.patternSummary.length > 0 && (
        <p className="num flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line px-3.5 py-1.5 text-[11px] text-muted">
          {person.patternSummary.map((p) => (
            <span key={p.weekday}>
              {p.label} {p.hours}
              {p.breakMinutes > 0 &&
                ` (−${p.breakMinutes}m${p.breakStart ? ` at ${p.breakStart}` : ""})`}
            </span>
          ))}
        </p>
      )}

      {open && (
        <div className="border-t border-line px-3.5 py-3">
          {(message ?? error) && (
            <p
              role="status"
              className={`mb-2.5 text-xs ${error ? "text-stall" : "text-run"}`}
            >
              {error ?? message}
            </p>
          )}

          <form
            action={move}
            className="mb-4 flex flex-wrap items-end gap-2 border-b border-line pb-3"
          >
            <input type="hidden" name="userId" value={person.id} />
            <label className="text-[11px]">
              <span className="field-label">
                Department
              </span>
              <select
                name="departmentId"
                defaultValue={person.departmentId}
                className="rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px]">
              <span className="field-label">
                Role
              </span>
              <select
                name="role"
                defaultValue={person.role}
                className="rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
              >
                <option value="WORKER">{t("people.roles.WORKER")}</option>
                <option value="MANAGER">{t("people.roles.MANAGER")}</option>
                <option value="HR">{t("people.roles.HR")}</option>
                <option value="ADMIN">{t("people.roles.ADMIN")}</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={moving}
              className="btn"
            >
              {moving ? t("people.moving") : t("people.move")}
            </button>
            <span className="text-[11px] text-muted">
              {t("people.unstartedStays")}
            </span>
          </form>

          <form
            action={saveDates}
            className="mb-4 flex flex-wrap items-end gap-2 border-b border-line pb-3"
          >
            <input type="hidden" name="userId" value={person.id} />
            <label className="text-[11px]">
              <span className="field-label">{t("people.started")}</span>
              <input
                type="date"
                name="startDate"
                defaultValue={person.startDate ?? ""}
                required
                className="field num"
              />
            </label>
            <label className="text-[11px]">
              <span className="field-label">{t("people.leaves")}</span>
              <input
                type="date"
                name="endDate"
                defaultValue={person.endDate ?? ""}
                className="field num"
              />
            </label>
            <button type="submit" disabled={savingDates} className="btn">
              {savingDates ? t("common.saving") : t("people.saveDates")}
            </button>
            <span className="text-[11.5px] text-muted">
              {t("people.datesHint")}
            </span>
          </form>

          <form action={saveHours}>
            <input type="hidden" name="userId" value={person.id} />
            <WeekdayFields existing={person.patternSummary} />
            <button
              type="submit"
              disabled={savingHours}
              className="mt-2.5 rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
            >
              {savingHours ? t("common.saving") : t("people.saveHours")}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-line pt-3">
            <form action={resetPw} className="flex items-end gap-1.5">
              <input type="hidden" name="userId" value={person.id} />
              <label className="text-[11px]">
                <span className="field-label">
                  New password
                </span>
                <input
                  type="text"
                  name="password"
                  minLength={8}
                  placeholder={t("people.atLeast8")}
                  className="rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
                />
              </label>
              <button
                type="submit"
                disabled={resetting}
                className="rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] hover:bg-surface-2 disabled:opacity-50"
              >
                {t("people.reset")}
              </button>
            </form>

            <span className="flex-1" />

            <form action={toggleActive}>
              <input type="hidden" name="userId" value={person.id} />
              <input
                type="hidden"
                name="active"
                value={person.active ? "false" : "true"}
              />
              <button
                type="submit"
                className={`rounded border px-2.5 py-1.5 text-[13px] ${
                  person.active
                    ? "border-line-strong hover:border-stall hover:text-stall"
                    : "border-accent text-accent"
                }`}
              >
                {person.active ? t("people.deactivate") : t("people.reactivate")}
              </button>
            </form>
          </div>
        </div>
      )}
    </article>
  );
}
