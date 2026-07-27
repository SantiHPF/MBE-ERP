"use client";

import { useActionState } from "react";
import { formatDuration } from "@/lib/time";
import {
  addActionItem,
  finaliseMeeting,
  removeActionItem,
  saveNotes,
  type MeetingState,
} from "@/lib/meetings/actions";

const initial: MeetingState = {};

type Item = {
  id: string;
  title: string;
  estimatedMinutes: number;
  dueDate: string;
  pinnedTo: string | null;
};

export function LiveMeeting({
  meetingId,
  notes,
  items,
  colleagues,
}: {
  meetingId: string;
  notes: string;
  items: Item[];
  colleagues: { id: string; displayName: string }[];
}) {
  const [notesState, save, saving] = useActionState(saveNotes, initial);
  const [addState, add, adding] = useActionState(addActionItem, initial);
  const [removeState, remove] = useActionState(removeActionItem, initial);
  const [finalState, finalise, finalising] = useActionState(
    finaliseMeeting,
    initial,
  );

  const today = new Date().toISOString().slice(0, 10);
  const total = items.reduce((s, i) => s + i.estimatedMinutes, 0);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ------------------------------------------------------------ notes */}
      <section className="rounded border border-line bg-surface shadow-sm">
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
            Notes
          </span>
          {notesState.ok && <span className="text-[11px] text-run">Saved</span>}
          {notesState.error && (
            <span className="text-[11px] text-stall">{notesState.error}</span>
          )}
        </header>

        <form action={save} className="p-4">
          <input type="hidden" name="meetingId" value={meetingId} />
          <textarea
            name="notes"
            defaultValue={notes}
            placeholder={"What was discussed…\n\nMarkdown is fine — it renders in the report."}
            className="min-h-[380px] w-full resize-y rounded border border-line-strong bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed"
          />
          <button
            type="submit"
            disabled={saving}
            className="mt-2.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save notes"}
          </button>
        </form>
      </section>

      {/* ----------------------------------------------------- action items */}
      <aside className="flex flex-col gap-3.5">
        <section className="rounded border border-line bg-surface shadow-sm">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
              Action items
            </span>
            <span className="num text-[11px] text-muted">
              {items.length} · {formatDuration(total)}
            </span>
          </header>

          {items.length > 0 && (
            <ul className="flex flex-col">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline gap-2 border-b border-line px-4 py-2.5 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{item.title}</p>
                    <p className="num mt-0.5 text-[11px] text-muted">
                      {formatDuration(item.estimatedMinutes)} · due{" "}
                      {item.dueDate}
                      {item.pinnedTo && (
                        <span className="text-accent"> · {item.pinnedTo}</span>
                      )}
                    </p>
                  </div>
                  <form action={remove}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <button
                      type="submit"
                      aria-label={`Remove ${item.title}`}
                      className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-stall hover:text-stall"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={add} className="flex flex-col gap-2 border-t border-line p-4">
            <input type="hidden" name="meetingId" value={meetingId} />

            <input
              name="title"
              placeholder="What needs doing?"
              required
              className="rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13.5px]"
            />

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px]">
                <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
                  How long
                </span>
                <input
                  type="number"
                  name="estimatedMinutes"
                  defaultValue={60}
                  min={1}
                  max={720}
                  step={1}
                  className="num w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
                />
              </label>
              <label className="text-[11px]">
                <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
                  Due
                </span>
                <input
                  type="date"
                  name="dueDate"
                  defaultValue={today}
                  required
                  className="num w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
                />
              </label>
            </div>

            <label className="text-[11px]">
              <span className="mb-1 block font-semibold tracking-[0.07em] text-faint uppercase">
                Anyone in particular?
              </span>
              <select
                name="pinnedAssigneeId"
                defaultValue=""
                className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px]"
              >
                <option value="">
                  No — let the system pick who is free and due a turn
                </option>
                {colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>

            {(addState.error ?? removeState.error) && (
              <p role="alert" className="text-xs text-stall">
                {addState.error ?? removeState.error}
              </p>
            )}

            <button
              type="submit"
              disabled={adding}
              className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add action item"}
            </button>
          </form>
        </section>

        <section className="rounded border border-line bg-surface p-4 shadow-sm">
          <p className="mb-2.5 text-xs text-muted">
            Nothing exists as real work yet. Finalising turns each action item
            into a task and the next scheduling run places it — pinned ones go
            to the person named, the rest to whoever is free and due a turn.
          </p>
          {finalState.error && (
            <p role="alert" className="mb-2 text-xs text-stall">
              {finalState.error}
            </p>
          )}
          <form action={finalise}>
            <input type="hidden" name="meetingId" value={meetingId} />
            <button
              type="submit"
              disabled={finalising || items.length === 0}
              className="w-full rounded border border-accent bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
            >
              {finalising
                ? "Finalising…"
                : `Finalise and create ${items.length} ${items.length === 1 ? "task" : "tasks"}`}
            </button>
          </form>
        </section>
      </aside>
    </div>
  );
}
