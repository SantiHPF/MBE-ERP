import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTeamWeek, weekStart } from "@/lib/team/week";
import { addDays, dateKey, formatDuration } from "@/lib/time";
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
          <h1 className="text-xl font-semibold tracking-tight">
            My week of{" "}
            {monday.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            })}
          </h1>
          {me && (
            <p className="num mt-0.5 text-[13px] text-muted">
              {formatDuration(me.bookedMinutes)} booked of{" "}
              {formatDuration(me.weeklyMinutes)} available
            </p>
          )}
        </div>

        <div className="flex gap-1.5 text-[13px]">
          <Link
            href={`/my-calendar?week=${dateKey(addDays(monday, -7))}`}
            className="rounded border border-line-strong bg-surface px-2.5 py-1 hover:bg-surface-2"
          >
            ← Previous
          </Link>
          <Link
            href={`/my-calendar?week=${dateKey(weekStart(new Date()))}`}
            className="rounded border border-line-strong bg-surface px-2.5 py-1 hover:bg-surface-2"
          >
            This week
          </Link>
          <Link
            href={`/my-calendar?week=${dateKey(addDays(monday, 7))}`}
            className="rounded border border-line-strong bg-surface px-2.5 py-1 hover:bg-surface-2"
          >
            Next →
          </Link>
        </div>
      </div>

      <WeekGrid week={mine} />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
            Time off on record
          </h2>
          {upcoming.length === 0 ? (
            <p className="rounded border border-dashed border-line p-6 text-center text-sm text-muted">
              Nothing recorded.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {upcoming.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline gap-2 rounded border border-line bg-surface px-3.5 py-2.5 text-[13px]"
                >
                  <span className="rounded border border-line px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-muted uppercase">
                    {a.category.toLowerCase()}
                  </span>
                  <span className="num">
                    {dateKey(a.startDate)}
                    {dateKey(a.endDate) !== dateKey(a.startDate) &&
                      ` → ${dateKey(a.endDate)}`}
                  </span>
                  {a.scope === "PARTIAL" && (
                    <span className="text-xs text-muted">part of the day</span>
                  )}
                  {a.note && <span className="text-muted">— {a.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <AbsenceForm />
      </div>
    </div>
  );
}
