"use client";

import { useActionState, useEffect } from "react";
import { createDepartment, createPerson, type PeopleState } from "@/lib/hr/people";
import { WeekdayFields } from "./weekday-fields";

const initial: PeopleState = {};

export function NewPersonForm({
  departments,
  onDone,
}: {
  departments: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const [state, submit, pending] = useActionState(createPerson, initial);

  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state.ok, onDone]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[11px]">
          <span className="field-label">Full name</span>
          <input name="displayName" required className="field" />
        </label>
        <label className="text-[11px]">
          <span className="field-label">Username</span>
          <input name="username" required className="field num" />
        </label>
        <label className="text-[11px]">
          <span className="field-label">First password</span>
          <input name="password" required minLength={8} className="field" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px]">
            <span className="field-label">Starts</span>
            <input
              type="date"
              name="startDate"
              defaultValue={today}
              required
              className="field num"
            />
          </label>
          <label className="text-[11px]">
            <span className="field-label">Leaves</span>
            <input type="date" name="endDate" className="field num" />
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[11px]">
          <span className="field-label">Department</span>
          <select name="departmentId" required className="field">
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">
          <span className="field-label">Role</span>
          <select name="role" defaultValue="WORKER" className="field">
            <option value="WORKER">Worker</option>
            <option value="MANAGER">Manager</option>
            <option value="HR">HR</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <p className="self-end text-[12px] text-muted lg:col-span-2">
          Leave the end date blank for an indefinite contract. Their induction
          interviews are booked from the start date.
        </p>
      </div>

      <div>
        <p className="eyebrow mb-2">Working hours</p>
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
          {pending ? "Creating…" : "Create account"}
        </button>
      </div>
    </form>
  );
}

/** Kept separate from adding a person: a rarer and unrelated job. */
export function NewDepartmentForm() {
  const [state, submit, pending] = useActionState(createDepartment, initial);

  return (
    <section className="card card-body max-w-md">
      <h2 className="eyebrow mb-2.5 block">Add a department</h2>
      <form action={submit} className="flex gap-2">
        <input
          name="name"
          placeholder="e.g. Logistics"
          required
          className="field flex-1"
        />
        <button type="submit" disabled={pending} className="btn">
          Add
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
