import Link from "next/link";
import { requireRole, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTeamWeek, weekStart } from "@/lib/team/week";
import {
  addDays,
  dateKey,
  formatClock,
  formatDuration,
  scheduleZone,
  today,
} from "@/lib/time";
import { lunchDrift } from "@/lib/attendance/attendance-db";
import { WeekGrid } from "./week-grid";
import { getT } from "@/lib/i18n/server";
import { formatDayMonth, fromDateKey } from "@/lib/i18n/dates";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; dept?: string }>;
}) {
  const user = await requireRole("MANAGER");
  const { t, locale } = await getT();
  const params = await searchParams;

  // Admins can look at any department; managers see their own.
  const departments = hasRole(user, "ADMIN")
    ? await prisma.department.findMany({ orderBy: { name: "asc" } })
    : [];

  const departmentId =
    hasRole(user, "ADMIN") && params.dept ? params.dept : user.departmentId;

  const anchor = params.week ? fromDateKey(params.week) : today();
  const week = await getTeamWeek(departmentId, anchor);

  const monday = fromDateKey(week.weekStart);
  const lunches = await lunchDrift(departmentId, monday, addDays(monday, 6));

  const zone = scheduleZone();
  const clock = (at: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);

  const prev = dateKey(addDays(monday, -7));
  const next = dateKey(addDays(monday, 7));
  const thisWeek = dateKey(weekStart(today()));

  const href = (w: string) =>
    `/team?week=${w}${hasRole(user, "ADMIN") ? `&dept=${departmentId}` : ""}`;

  const totalAvailable = week.people.reduce((s, p) => s + p.weeklyMinutes, 0);
  const totalBooked = week.people.reduce((s, p) => s + p.bookedMinutes, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {t("team.weekOf", week.departmentName, formatDayMonth(monday, locale))}
          </h1>
          <p className="page-sub num">
            {t(
              "team.bookedOf",
              formatDuration(totalBooked),
              formatDuration(totalAvailable),
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-[13px]">
          {departments.length > 0 && (
            <div className="mr-2 flex gap-1">
              {departments.map((d) => (
                <Link
                  key={d.id}
                  href={`/team?week=${week.weekStart}&dept=${d.id}`}
                  className={
                    d.id === departmentId
                      ? "rounded-md bg-accent-wash px-2.5 py-1.5 text-[12.5px] font-semibold text-accent"
                      : "rounded-md px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  }
                >
                  {d.name}
                </Link>
              ))}
            </div>
          )}
          <Link
            href={href(prev)}
            className="btn btn-sm"
          >
            {t("common.previous")}
          </Link>
          <Link
            href={href(thisWeek)}
            className="btn btn-sm"
          >
            {t("common.thisWeek")}
          </Link>
          <Link
            href={href(next)}
            className="btn btn-sm"
          >
            {t("common.next")}
          </Link>
        </div>
      </div>

      {week.orphanCount > 0 && (
        <div className="notice notice-bad mb-4 flex items-center gap-3 !text-ink">
          <span>
            <b className="text-stall">
              {week.orphanCount === 1
                ? t("team.needDecisionOne", week.orphanCount)
                : t("team.needDecision", week.orphanCount)}
            </b>{" "}
            {t("team.absenceLeft")}
          </span>
          <span className="flex-1" />
          <Link
            href="/triage"
            className="shrink-0 rounded border border-stall px-2.5 py-1 font-medium text-stall hover:bg-surface"
          >
            {t("team.openTriage")}
          </Link>
        </div>
      )}

      <WeekGrid week={week} />

      {/*
        Lunches that did not match the timetable.

        Only the exceptions, and only the ones somebody actually clocked --
        a register of everybody eating at one o'clock is not information. A
        day nobody clocked is read as lunch taken as rostered and stays quiet.
      */}
      {lunches.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-2.5 block">
            {t("attendance.lunchDrift", lunches.length)}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {lunches.map((row) => (
              <li
                key={`${row.userId}:${row.date}`}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded border border-line bg-surface px-3.5 py-2 text-[13px]"
              >
                <span className="font-medium">{row.displayName}</span>
                <span className="num text-[12px] text-muted">
                  {formatDayMonth(fromDateKey(row.date), locale)}
                </span>
                <span className="num text-[12px] text-muted">
                  {clock(row.startedAt)}
                  {row.endedAt ? `–${clock(row.endedAt)}` : ""}
                  {row.rosteredStart != null && (
                    <span className="text-faint">
                      {" "}
                      ({t("attendance.rostered")}{" "}
                      {formatClock(row.rosteredStart)})
                    </span>
                  )}
                </span>
                <span className="flex-1" />
                <span className="num text-[12px] text-pause">
                  {row.startDrift != null &&
                    row.startDrift !== 0 &&
                    t(
                      row.startDrift < 0
                        ? "attendance.leftEarly"
                        : "attendance.leftLate",
                      formatDuration(Math.abs(row.startDrift)),
                    )}
                  {row.overBy > 0 && (
                    <>
                      {" "}
                      {t("attendance.overLunch", formatDuration(row.overBy))}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
