"use client";

import { useActionState, useEffect } from "react";
import { createDepartment, createPerson, type PeopleState } from "@/lib/hr/people";
import { WeekdayFields } from "./weekday-fields";
import { useT } from "@/lib/i18n/client";

const initial: PeopleState = {};

export function NewPersonForm({
  departments,
  today,
  onDone,
}: {
  departments: { id: string; name: string }[];
  today: string;
  onDone?: () => void;
}) {
  const { t } = useT();
  const [state, submit, pending] = useActionState(createPerson, initial);

  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state.ok, onDone]);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[11px]">
          <span className="field-label">{t("people.fullName")}</span>
          <input name="displayName" required className="field" />
        </label>
        <label className="text-[11px]">
          <span className="field-label">{t("people.username")}</span>
          <input name="username" required className="field num" />
        </label>
        <label className="text-[11px]">
          <span className="field-label">{t("people.firstPassword")}</span>
          <input name="password" required minLength={8} className="field" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px]">
            <span className="field-label">{t("people.starts")}</span>
            <input
              type="date"
              name="startDate"
              defaultValue={today}
              required
              className="field num"
            />
          </label>
          <label className="text-[11px]">
            <span className="field-label">{t("people.leaves")}</span>
            <input type="date" name="endDate" className="field num" />
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[11px]">
          <span className="field-label">{t("common.department")}</span>
          <select name="departmentId" required className="field">
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">
          <span className="field-label">{t("common.role")}</span>
          <select name="role" defaultValue="WORKER" className="field">
            <option value="WORKER">{t("people.roles.WORKER")}</option>
            <option value="MANAGER">{t("people.roles.MANAGER")}</option>
            <option value="HR">{t("people.roles.HR")}</option>
            <option value="ADMIN">{t("people.roles.ADMIN")}</option>
          </select>
        </label>
        <p className="self-end text-[12px] text-muted lg:col-span-2">
          {t("people.indefiniteHint")}
        </p>
      </div>

      <div>
        <p className="eyebrow mb-2">{t("people.workingHours")}</p>
        <WeekdayFields />
      </div>

      {state.error && (
        <p role="alert" className="notice notice-bad">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p className="notice notice-ok">{state.message}</p>
      )}

      <div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? t("people.creating") : t("people.createAccount")}
        </button>
      </div>
    </form>
  );
}

/** Kept separate from adding a person: a rarer and unrelated job. */
export function NewDepartmentForm() {
  const { t } = useT();
  const [state, submit, pending] = useActionState(createDepartment, initial);

  return (
    <section className="card card-body max-w-md">
      <h2 className="eyebrow mb-2.5 block">{t("people.addDepartment")}</h2>
      <form action={submit} className="flex gap-2">
        <input
          name="name"
          placeholder={t("people.departmentEg")}
          required
          className="field flex-1"
        />
        <button type="submit" disabled={pending} className="btn">
          {t("common.add")}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-2 text-[12px] text-stall">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p className="mt-2 text-[12px] text-run">{state.message}</p>
      )}
    </section>
  );
}
