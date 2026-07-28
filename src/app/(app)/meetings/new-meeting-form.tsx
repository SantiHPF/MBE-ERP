"use client";

import { useActionState } from "react";
import { createMeeting, type MeetingState } from "@/lib/meetings/actions";
import { useT } from "@/lib/i18n/client";

const initial: MeetingState = {};

export function NewMeetingForm() {
  const { t } = useT();
  const [state, submit, pending] = useActionState(createMeeting, initial);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={submit} className="flex flex-wrap items-end gap-1.5">
      <label className="text-xs">
        <span className="field-label">
          {t("meetings.newMeeting")}
        </span>
        <input
          name="title"
          defaultValue="Weekly planning"
          required
          className="field"
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
        className="btn btn-primary"
      >
        {pending ? t("meetings.starting") : t("meetings.start")}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-xs text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}
