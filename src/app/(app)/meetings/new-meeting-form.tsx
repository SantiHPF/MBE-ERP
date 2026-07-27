"use client";

import { useActionState } from "react";
import { createMeeting, type MeetingState } from "@/lib/meetings/actions";

const initial: MeetingState = {};

export function NewMeetingForm() {
  const [state, submit, pending] = useActionState(createMeeting, initial);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={submit} className="flex flex-wrap items-end gap-1.5">
      <label className="text-xs">
        <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
          New meeting
        </span>
        <input
          name="title"
          defaultValue="Weekly planning"
          required
          className="rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
        />
      </label>
      <input
        type="date"
        name="date"
        defaultValue={today}
        required
        className="num rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Start"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-xs text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}
