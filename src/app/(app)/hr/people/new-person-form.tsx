"use client";

import { useActionState } from "react";
import { createDepartment, createPerson, type PeopleState } from "@/lib/hr/people";
import { WeekdayFields } from "./weekday-fields";

const initial: PeopleState = {};

export function NewPersonForm({
  departments,
}: {
  departments: { id: string; name: string }[];
}) {
  const [state, submit, pending] = useActionState(createPerson, initial);
  const [deptState, addDept, addingDept] = useActionState(
    createDepartment,
    initial,
  );

  return (
    <aside className="flex flex-col gap-3.5">
      <section className="card card-body">
        <h2 className="mb-3 text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
          Add someone
        </h2>

        <form action={submit} className="flex flex-col gap-2.5">
          <label className="text-[11px]">
            <span className="field-label">
              Full name
            </span>
            <input
              name="displayName"
              required
              className="field"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px]">
              <span className="field-label">
                Username
              </span>
              <input
                name="username"
                required
                className="num w-full rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13px]"
              />
            </label>
            <label className="text-[11px]">
              <span className="field-label">
                First password
              </span>
              <input
                name="password"
                required
                minLength={8}
                className="field"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px]">
              <span className="field-label">
                Department
              </span>
              <select
                name="departmentId"
                required
                className="field"
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
                defaultValue="WORKER"
                className="field"
              >
                <option value="WORKER">Worker</option>
                <option value="MANAGER">Manager</option>
                <option value="HR">HR</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
          </div>

          <div className="mt-1">
            <p className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
              Working hours
            </p>
            <WeekdayFields />
          </div>

          {state.error && (
            <p role="alert" className="text-xs text-stall">
              {state.error}
            </p>
          )}
          {state.ok && state.message && (
            <p className="text-xs text-run">{state.message}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary w-full"
          >
            {pending ? "Creating…" : "Create account"}
          </button>
        </form>
      </section>

      <section className="card card-body">
        <h2 className="eyebrow mb-2.5 block">
          Add a department
        </h2>
        <form action={addDept} className="flex gap-1.5">
          <input
            name="name"
            placeholder="e.g. Logistics"
            required
            className="flex-1 rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13px]"
          />
          <button
            type="submit"
            disabled={addingDept}
            className="btn"
          >
            Add
          </button>
        </form>
        {deptState.error && (
          <p role="alert" className="mt-1.5 text-xs text-stall">
            {deptState.error}
          </p>
        )}
        {deptState.ok && deptState.message && (
          <p className="mt-1.5 text-xs text-run">{deptState.message}</p>
        )}
      </section>
    </aside>
  );
}
