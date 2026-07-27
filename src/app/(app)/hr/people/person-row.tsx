"use client";

import { useActionState, useState } from "react";
import {
  changeDepartment,
  resetPassword,
  setPersonActive,
  updateWorkingPattern,
  type PeopleState,
} from "@/lib/hr/people";
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
  const [open, setOpen] = useState(false);
  const [hoursState, saveHours, savingHours] = useActionState(
    updateWorkingPattern,
    initial,
  );
  const [activeState, toggleActive] = useActionState(setPersonActive, initial);
  const [pwState, resetPw, resetting] = useActionState(resetPassword, initial);
  const [moveState, move, moving] = useActionState(changeDepartment, initial);

  const message =
    hoursState.message ?? activeState.message ?? pwState.message ?? moveState.message;
  const error =
    hoursState.error ?? activeState.error ?? pwState.error ?? moveState.error;

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
            inactive
          </span>
        )}
        <span className="flex-1" />
        <span className="num text-xs text-muted">{person.weeklySummary}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded border border-line-strong px-2 py-0.5 text-[11px] hover:bg-surface-2"
        >
          {open ? "Close" : "Edit"}
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
              <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
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
              <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
                Role
              </span>
              <select
                name="role"
                defaultValue={person.role}
                className="rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
              >
                <option value="WORKER">Worker</option>
                <option value="MANAGER">Manager</option>
                <option value="HR">HR</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={moving}
              className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              {moving ? "Moving…" : "Move"}
            </button>
            <span className="text-[11px] text-muted">
              Unstarted work stays with the old department.
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
              {savingHours ? "Saving…" : "Save hours"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-line pt-3">
            <form action={resetPw} className="flex items-end gap-1.5">
              <input type="hidden" name="userId" value={person.id} />
              <label className="text-[11px]">
                <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
                  New password
                </span>
                <input
                  type="text"
                  name="password"
                  minLength={8}
                  placeholder="at least 8 characters"
                  className="rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
                />
              </label>
              <button
                type="submit"
                disabled={resetting}
                className="rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] hover:bg-surface-2 disabled:opacity-50"
              >
                Reset
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
                {person.active ? "Deactivate" : "Reactivate"}
              </button>
            </form>
          </div>
        </div>
      )}
    </article>
  );
}
