import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTeamWeek, weekStart } from "@/lib/team/week";
import { addDays, dateKey, formatDuration } from "@/lib/time";
import { effectiveLabel } from "@/lib/absence/effective";
import { canDecideAbsences } from "@/lib/auth/guards";
import { formatClock } from "@/lib/time";
import { AbsenceRow } from "./absence-row";
import { getT } from "@/lib/i18n/server";
import { WeekGrid } from "../team/week-grid";
import { AbsenceForm } from "./absence-form";

export const dynamic = "force-dynamic";

export default async function MyCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { t } = await getT();

  const anchor = params.week ? new Date(`${params.week}T00:00:00Z`) : new Date();
  const week = await getTeamWeek(user.departmentId, anchor);

  // Same grid as the team view, narrowed to just this person.
  const mine = { ...week, people: week.people.filter((p) => p.id === user.id) };

  const monday = new Date(`${week.weekStart}T00:00:00Z`);
  const me = mine.people[0];

  const upcoming = await prisma.absence.findMany({
    where: { userId: user.id, endDate: { gte: addDays(new Date(), -7) } },
    orderBy: { startDate: "asc" },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {t(
              "calendar.myWeekOf",
              monday.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }),
            )}
          </h1>
          {me && (
            <p className="page-sub num">
              {t(
                "calendar.bookedOf",
                formatDuration(me.bookedMinutes),
                formatDuration(me.weeklyMinutes),
              )}
            </p>
          )}
        </div>

        <div className="flex gap-1.5 text-[13px]">
          <Link
            href={`/my-calendar?week=${dateKey(addDays(monday, -7))}`}
            className="btn btn-sm"
          >
            {t("common.previous")}
          </Link>
          <Link
            href={`/my-calendar?week=${dateKey(weekStart(new Date()))}`}
            className="btn btn-sm"
          >
            {t("common.thisWeek")}
          </Link>
          <Link
            href={`/my-calendar?week=${dateKey(addDays(monday, 7))}`}
            className="btn btn-sm"
          >
            {t("common.next")}
          </Link>
        </div>
      </div>

      <WeekGrid week={mine} size="tall" />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <h2 className="eyebrow mb-2.5 block">
            {t("calendar.timeOffRecord")}
          </h2>
          {upcoming.length === 0 ? (
            <p className="empty">
              {t("calendar.nothingRecorded")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {upcoming.map((a) => (
                <AbsenceRow
                  key={a.id}
                  absence={{
                    id: a.id,
                    startDate: dateKey(a.startDate),
                    endDate: dateKey(a.endDate),
                    scope: a.scope,
                    startTime:
                      a.startMinutes != null ? formatClock(a.startMinutes) : null,
                    endTime:
                      a.endMinutes != null ? formatClock(a.endMinutes) : null,
                    category: a.category,
                    note: a.note,
                    status: a.status,
                    statusLabel: effectiveLabel(a),
                    decisionNote: a.decisionNote,
                    // Once HR has decided, only HR can change it.
                    editable: a.status === "PENDING" || canDecideAbsences(user),
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <AbsenceForm />
      </div>
    </div>
  );
}
