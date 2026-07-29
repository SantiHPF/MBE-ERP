import { notFound } from "next/navigation";
import { requireUser, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dateKey, formatDuration, todayKey } from "@/lib/time";
import { LiveMeeting } from "./live-meeting";
import { MeetingReport } from "./report";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { t } = await getT();

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      createdBy: { select: { displayName: true } },
      attendees: { select: { id: true, displayName: true } },
      actionItems: {
        include: {
          pinnedAssignee: { select: { displayName: true } },
          task: {
            include: { assignee: { select: { displayName: true } } },
          },
        },
        orderBy: { dueDate: "asc" },
      },
    },
  });

  if (!meeting) notFound();
  if (meeting.departmentId !== user.departmentId && !hasRole(user, "ADMIN")) {
    notFound();
  }

  const colleagues = await prisma.user.findMany({
    where: { departmentId: user.departmentId, active: true },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });

  const header = (
    <div className="mb-5">
      <p className="eyebrow">
        {meeting.status === "DRAFT" ? t("meetings.inProgress") : t("meetings.report")}
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-balance">
        {meeting.title}
      </h1>
      <p className="page-sub num">
        {dateKey(meeting.date)} · {meeting.attendees.length} attending ·{" "}
        {formatDuration(
          meeting.actionItems.reduce((s, i) => s + i.estimatedMinutes, 0),
        )}{" "}
        of work decided
      </p>
    </div>
  );

  if (meeting.status === "FINALISED") {
    return (
      <>
        {header}
        <MeetingReport meeting={meeting} />
      </>
    );
  }

  if (!hasRole(user, "MANAGER")) {
    return (
      <>
        {header}
        <p className="empty">
          {t("meetings.stillRunning")}
        </p>
      </>
    );
  }

  return (
    <>
      {header}
      <LiveMeeting
        meetingId={meeting.id}
        notes={meeting.notes}
        colleagues={colleagues}
        today={todayKey()}
        items={meeting.actionItems.map((i) => ({
          id: i.id,
          title: i.title,
          estimatedMinutes: i.estimatedMinutes,
          dueDate: dateKey(i.dueDate),
          pinnedTo: i.pinnedAssignee?.displayName ?? null,
        }))}
      />
    </>
  );
}
