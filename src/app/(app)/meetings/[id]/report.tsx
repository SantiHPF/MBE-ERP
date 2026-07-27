import { dateKey, formatDuration } from "@/lib/time";

/**
 * The report is not a separate document anybody writes -- it is the meeting
 * after finalisation. It stays live, so opening last week's report shows what
 * actually got done rather than what was promised.
 */

type ReportMeeting = {
  notes: string;
  finalisedAt: Date | null;
  createdBy: { displayName: string };
  attendees: { id: string; displayName: string }[];
  actionItems: {
    id: string;
    title: string;
    estimatedMinutes: number;
    dueDate: Date;
    pinnedAssignee: { displayName: string } | null;
    task: {
      status: string;
      assignee: { displayName: string } | null;
    } | null;
  }[];
};

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  UNASSIGNED: { text: "Waiting to be assigned", className: "text-muted border-line" },
  ASSIGNED: { text: "Scheduled", className: "text-accent border-accent" },
  IN_PROGRESS: { text: "In progress", className: "text-run border-run" },
  PAUSED: { text: "Paused", className: "text-pause border-pause" },
  ORPHANED: { text: "Needs a decision", className: "text-stall border-stall" },
  DONE: { text: "Done", className: "text-run border-run" },
  CANCELLED: { text: "Cancelled", className: "text-muted border-line" },
};

export function MeetingReport({ meeting }: { meeting: ReportMeeting }) {
  const done = meeting.actionItems.filter(
    (i) => i.task?.status === "DONE",
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-2 text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
          Present
        </h2>
        <p className="text-[13.5px]">
          {meeting.attendees.map((a) => a.displayName).join(", ")}
        </p>
        <p className="mt-1 text-xs text-muted">
          Written up by {meeting.createdBy.displayName}
          {meeting.finalisedAt && ` · finalised ${dateKey(meeting.finalisedAt)}`}
        </p>
      </section>

      {meeting.notes.trim() && (
        <section className="rounded border border-line bg-surface p-5 shadow-sm">
          <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
            Notes
          </h2>
          <div className="max-w-[65ch] text-[13.5px] leading-relaxed whitespace-pre-wrap">
            {meeting.notes}
          </div>
        </section>
      )}

      <section className="rounded border border-line bg-surface shadow-sm">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
            What was agreed
          </h2>
          <span className="num text-[11px] text-muted">
            {done} of {meeting.actionItems.length} done
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
                <th className="px-5 py-2">Action</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-5 py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {meeting.actionItems.map((item) => {
                const status = item.task
                  ? (STATUS_LABEL[item.task.status] ?? STATUS_LABEL.UNASSIGNED)
                  : STATUS_LABEL.UNASSIGNED;

                // Who it actually went to beats who was named in the room.
                const who =
                  item.task?.assignee?.displayName ??
                  item.pinnedAssignee?.displayName ??
                  null;

                return (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{item.title}</span>
                      <span className="num ml-2 text-[11px] text-muted">
                        {formatDuration(item.estimatedMinutes)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {who ?? <span className="text-muted">not yet picked</span>}
                    </td>
                    <td className="num px-3 py-2.5">{dateKey(item.dueDate)}</td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`rounded border px-1.5 py-px text-[9.5px] font-semibold tracking-wider uppercase ${status.className}`}
                      >
                        {status.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
