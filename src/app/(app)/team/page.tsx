import Link from "next/link";
import { requireRole, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTeamWeek, weekStart } from "@/lib/team/week";
import { addDays, dateKey, formatDuration } from "@/lib/time";
import { WeekGrid } from "./week-grid";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; dept?: string }>;
}) {
  const user = await requireRole("MANAGER");
  const { t } = await getT();
  const params = await searchParams;

  // Admins can look at any department; managers see their own.
  const departments = hasRole(user, "ADMIN")
    ? await prisma.department.findMany({ orderBy: { name: "asc" } })
    : [];

  const departmentId =
    hasRole(user, "ADMIN") && params.dept ? params.dept : user.departmentId;

  const anchor = params.week ? new Date(`${params.week}T00:00:00Z`) : new Date();
  const week = await getTeamWeek(departmentId, anchor);

  const monday = new Date(`${week.weekStart}T00:00:00Z`);
  const prev = dateKey(addDays(monday, -7));
  const next = dateKey(addDays(monday, 7));
  const thisWeek = dateKey(weekStart(new Date()));

  const href = (w: string) =>
    `/team?week=${w}${hasRole(user, "ADMIN") ? `&dept=${departmentId}` : ""}`;

  const totalAvailable = week.people.reduce((s, p) => s + p.weeklyMinutes, 0);
  const totalBooked = week.people.reduce((s, p) => s + p.bookedMinutes, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {t(
              "team.weekOf",
              week.departmentName,
              monday.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }),
            )}
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
    </div>
  );
}
