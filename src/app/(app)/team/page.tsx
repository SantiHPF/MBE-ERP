import Link from "next/link";
import { requireRole, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTeamWeek, weekStart } from "@/lib/team/week";
import { addDays, dateKey, formatDuration } from "@/lib/time";
import { WeekGrid } from "./week-grid";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; dept?: string }>;
}) {
  const user = await requireRole("MANAGER");
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
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {week.departmentName} — week of{" "}
            {monday.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            })}
          </h1>
          <p className="num mt-0.5 text-[13px] text-muted">
            {formatDuration(totalBooked)} booked of{" "}
            {formatDuration(totalAvailable)} available
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
                      ? "rounded bg-accent-wash px-2.5 py-1 font-medium text-accent"
                      : "rounded px-2.5 py-1 text-muted hover:bg-surface-2"
                  }
                >
                  {d.name}
                </Link>
              ))}
            </div>
          )}
          <Link
            href={href(prev)}
            className="rounded border border-line-strong bg-surface px-2.5 py-1 hover:bg-surface-2"
          >
            ← Previous
          </Link>
          <Link
            href={href(thisWeek)}
            className="rounded border border-line-strong bg-surface px-2.5 py-1 hover:bg-surface-2"
          >
            This week
          </Link>
          <Link
            href={href(next)}
            className="rounded border border-line-strong bg-surface px-2.5 py-1 hover:bg-surface-2"
          >
            Next →
          </Link>
        </div>
      </div>

      {week.orphanCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded border border-stall bg-stall-wash px-3.5 py-2.5 text-[13px]">
          <span>
            <b className="text-stall">
              {week.orphanCount} {week.orphanCount === 1 ? "task needs" : "tasks need"}{" "}
              a decision.
            </b>{" "}
            Somebody&rsquo;s absence left them without an owner. Nothing was
            moved automatically.
          </span>
          <span className="flex-1" />
          <Link
            href="/triage"
            className="shrink-0 rounded border border-stall px-2.5 py-1 font-medium text-stall hover:bg-surface"
          >
            Open triage
          </Link>
        </div>
      )}

      <WeekGrid week={week} />
    </div>
  );
}
