import Link from "next/link";
import { requireUser, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dateKey } from "@/lib/time";
import { NewMeetingForm } from "./new-meeting-form";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const user = await requireUser();

  const meetings = await prisma.meeting.findMany({
    where: { departmentId: user.departmentId },
    include: {
      _count: { select: { actionItems: true } },
      createdBy: { select: { displayName: true } },
    },
    orderBy: { date: "desc" },
    take: 40,
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            Run the weekly meeting here and the report writes itself.
          </p>
        </div>
        {hasRole(user, "MANAGER") && <NewMeetingForm />}
      </div>

      {meetings.length === 0 ? (
        <p className="rounded border border-dashed border-line p-10 text-center text-sm text-muted">
          No meetings yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="flex flex-wrap items-baseline gap-3 rounded border border-line bg-surface px-3.5 py-3 hover:border-accent"
              >
                <span className="num text-[13px] text-muted">
                  {dateKey(m.date)}
                </span>
                <span className="text-sm font-medium">{m.title}</span>
                <span
                  className={
                    m.status === "DRAFT"
                      ? "rounded border border-pause px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-pause uppercase"
                      : "rounded border border-line px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-muted uppercase"
                  }
                >
                  {m.status === "DRAFT" ? "In progress" : "Report"}
                </span>
                <span className="flex-1" />
                <span className="num text-xs text-muted">
                  {m._count.actionItems}{" "}
                  {m._count.actionItems === 1 ? "action" : "actions"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
