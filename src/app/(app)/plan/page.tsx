import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { defaultPlanWeek, getPlanWeek, mondayOf } from "@/lib/plan/week";
import { addDays, dateKey, formatDuration } from "@/lib/time";
import { PlanBoard } from "./plan-board";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const { t } = await getT();
  const params = await searchParams;

  const anchor = params.week
    ? new Date(`${params.week}T00:00:00Z`)
    : defaultPlanWeek();

  const week = await getPlanWeek(user.id, anchor);
  const monday = new Date(`${week.weekStart}T00:00:00Z`);

  const spare = week.totalCapacity - week.totalClaimed;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {t(
              "plan.title",
              monday.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }),
            )}
            {week.isCurrentWeek && (
              <span className="ml-2 text-[13px] font-normal text-pause">
                {t("plan.thisWeekTag")}
              </span>
            )}
          </h1>
          <p className="num mt-0.5 text-[13px]">
            {spare >= 0 ? (
              <>
                <span className="font-semibold">
                  {t("plan.unassigned", formatDuration(spare))}
                </span>
                <span className="text-muted">
                  {" "}
                  ·{" "}
                  {t(
                    "plan.takenOf",
                    formatDuration(week.totalClaimed),
                    formatDuration(week.totalCapacity),
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold text-stall">
                  {t("plan.overCapacity", formatDuration(-spare))}
                </span>
                <span className="text-muted">
                  {" "}
                  ·{" "}
                  {t(
                    "plan.takenOf",
                    formatDuration(week.totalClaimed),
                    formatDuration(week.totalCapacity),
                  )}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex gap-1.5 text-[13px]">
          <Link
            href={`/plan?week=${dateKey(addDays(monday, -7))}`}
            className="btn btn-sm"
          >
            {t("common.previous")}
          </Link>
          <Link
            href={`/plan?week=${dateKey(mondayOf(new Date()))}`}
            className="btn btn-sm"
          >
            {t("common.thisWeek")}
          </Link>
          <Link
            href={`/plan?week=${dateKey(defaultPlanWeek())}`}
            className="rounded border border-accent bg-accent-wash px-2.5 py-1 font-medium text-accent"
          >
            {t("plan.nextWeek")}
          </Link>
          <Link
            href={`/plan?week=${dateKey(addDays(monday, 7))}`}
            className="btn btn-sm"
          >
            {t("plan.forward")}
          </Link>
        </div>
      </div>

      <p className="mb-4 max-w-[72ch] text-[13px] text-muted">
        Find a task and tick the days you will do it. Whatever nobody takes
        gets handed out automatically when the week starts, so nothing is
        forgotten &mdash; and a task only goes to one person per day.
      </p>

      <PlanBoard week={week} />
    </div>
  );
}
