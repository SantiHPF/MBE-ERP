"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { LiveMeeting } from "@/lib/tasks/day";
import { formatDuration } from "@/lib/time";
import {
  addLiveActionItem,
  endMeeting,
  removeLiveActionItem,
  saveLiveNotes,
  startAdHocMeeting,
  type LiveState,
} from "@/lib/meetings/live";

const initial: LiveState = {};

/** Offered when nothing is being minuted: somebody pulled you into a meeting. */
export function StartMeetingButton() {
  const [state, submit, pending] = useActionState(startAdHocMeeting, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:border-accent hover:text-accent"
      >
        I&rsquo;m in a meeting
      </button>
    );
  }

  return (
    <form action={submit} className="flex flex-wrap items-center gap-1.5">
      <input
        name="title"
        required
        autoFocus
        placeholder="What is it about?"
        className="w-56 rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-50"
      >
        {pending ? "Starting…" : "Start"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded border border-line-strong px-2.5 py-1.5 text-[13px]"
      >
        Cancel
      </button>
      {state.error && (
        <p role="alert" className="w-full text-xs text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function MeetingPanel({
  meeting,
  colleagues,
  today,
}: {
  meeting: LiveMeeting;
  colleagues: { id: string; displayName: string }[];
  today: string;
}) {
  const [notes, setNotes] = useState(meeting.notes);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [addState, add, adding] = useActionState(addLiveActionItem, initial);
  const [, remove] = useActionState(removeLiveActionItem, initial);
  const [endState, close, closing] = useActionState(endMeeting, initial);

  // Autosave: a meeting where you lose the notes by closing the tab is worse
  // than no notes at all, because you thought you had them.
  useEffect(() => {
    if (notes === meeting.notes) return;
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const form = new FormData();
      form.set("meetingId", meeting.id);
      form.set("notes", notes);
      await saveLiveNotes({}, form);
      setSaved("saved");
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [notes, meeting.id, meeting.notes]);

  const total = meeting.items.reduce((s, i) => s + i.estimatedMinutes, 0);

  return (
    <section className="mb-5 rounded border border-accent bg-surface shadow-sm">
      <header className="flex flex-wrap items-baseline gap-2 border-b border-line bg-accent-wash px-4 py-2.5">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-accent uppercase">
          In a meeting
        </span>
        <span className="text-sm font-semibold">{meeting.title}</span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted">
          {saved === "saving"
            ? "saving…"
            : saved === "saved"
              ? "notes saved"
              : "notes autosave"}
        </span>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <label
            htmlFor="live-notes"
            className="mb-1.5 block text-[11px] font-semibold tracking-[0.07em] text-faint uppercase"
          >
            Notes
          </label>
          <textarea
            id="live-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What is being said…"
            className="min-h-[220px] w-full resize-y rounded border border-line-strong bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed"
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
              Things to do · {meeting.items.length}
              {total > 0 && (
                <span className="num ml-1.5 font-normal normal-case">
                  {formatDuration(total)}
                </span>
              )}
            </p>

            {meeting.items.length === 0 ? (
              <p className="rounded border border-dashed border-line px-3 py-2 text-[12px] text-muted">
                Nothing captured yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {meeting.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline gap-1.5 rounded border border-line px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">
                        {item.title}
                      </p>
                      <p className="num text-[10.5px] text-muted">
                        {formatDuration(item.estimatedMinutes)} · {item.dueDate}
                        {item.pinnedTo ? (
                          <span className="text-accent"> · {item.pinnedTo}</span>
                        ) : (
                          <span> · anyone</span>
                        )}
                      </p>
                    </div>
                    <form action={remove}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <button
                        type="submit"
                        aria-label={`Remove ${item.title}`}
                        className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-stall hover:text-stall"
                      >
                        ✕
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form action={add} className="flex flex-col gap-1.5 rounded border border-line bg-surface-2 p-2.5">
            <input type="hidden" name="meetingId" value={meeting.id} />
            <input
              name="title"
              required
              placeholder="Something that needs doing"
              className="rounded border border-line-strong bg-surface px-2 py-1.5 text-[12.5px]"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                name="estimatedMinutes"
                defaultValue={30}
                min={1}
                max={720}
                step={1}
                title="Minutes"
                className="num rounded border border-line-strong bg-surface px-2 py-1.5 text-[12.5px]"
              />
              <input
                type="date"
                name="dueDate"
                defaultValue={today}
                required
                className="num rounded border border-line-strong bg-surface px-2 py-1.5 text-[12.5px]"
              />
            </div>
            <select
              name="pinnedAssigneeId"
              defaultValue=""
              className="rounded border border-line-strong bg-surface px-2 py-1.5 text-[12.5px]"
            >
              <option value="">Anyone — goes to the pool</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
            {addState.error && (
              <p role="alert" className="text-[11px] text-stall">
                {addState.error}
              </p>
            )}
            <button
              type="submit"
              disabled={adding}
              className="rounded border border-line-strong bg-surface px-2 py-1.5 text-[12.5px] font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              {adding ? "Adding…" : "+ Add"}
            </button>
          </form>

          <form action={close}>
            <input type="hidden" name="meetingId" value={meeting.id} />
            <button
              type="submit"
              disabled={closing}
              className="w-full rounded border border-accent bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
            >
              {closing
                ? "Closing…"
                : meeting.items.length > 0
                  ? `End meeting · create ${meeting.items.length} ${meeting.items.length === 1 ? "task" : "tasks"}`
                  : "End meeting"}
            </button>
            {endState.error && (
              <p role="alert" className="mt-1 text-[11px] text-stall">
                {endState.error}
              </p>
            )}
            {!meeting.fromTaskId && (
              <p className="mt-1.5 text-[11px] text-muted">
                Ending it puts you back on the task you paused.
              </p>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}
