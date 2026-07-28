import Link from "next/link";
import { requireUser, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dateKey } from "@/lib/time";
import { NewMeetingForm } from "./new-meeting-form";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const user = await requireUser();
  const { t } = await getT();

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
          <h1 className="page-title">{t("meetings.title")}</h1>
          <p className="page-sub">
            {t("meetings.intro")}
          </p>
        </div>
        {hasRole(user, "MANAGER") && <NewMeetingForm />}
      </div>

      {meetings.length === 0 ? (
        <p className="empty">
          {t("meetings.none")}
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
                  {m.status === "DRAFT" ? t("meetings.inProgress") : t("meetings.report")}
                </span>
                <span className="flex-1" />
                <span className="num text-xs text-muted">
                  {m._count.actionItems}{" "}
                  {m._count.actionItems === 1 ? t("meetings.action") : t("meetings.actions")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
