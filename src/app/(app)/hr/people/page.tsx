import { requirePeopleAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { formatClock, formatDuration, weekdayName } from "@/lib/time";
import { NewPersonForm } from "./new-person-form";
import { PersonRow } from "./person-row";

export const dynamic = "force-dynamic";

export default async function HrPeoplePage() {
  await requirePeopleAdmin();

  const [departments, people] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({
      include: {
        department: { select: { name: true } },
        workingPatterns: { orderBy: { weekday: "asc" } },
      },
      orderBy: [{ active: "desc" }, { department: { name: "asc" } }, { displayName: "asc" }],
    }),
  ]);

  return (
    <div>
      <h1 className="page-title">People</h1>
      <p className="page-sub mb-5">
        Accounts and working hours. Only HR can change these.
      </p>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section>
          <h2 className="eyebrow mb-2.5 block">
            Everyone · {people.filter((p) => p.active).length} active
          </h2>

          <div className="flex flex-col gap-1.5">
            {people.map((person) => {
              const weekly = person.workingPatterns.reduce(
                (sum, p) =>
                  sum + (p.endMinutes - p.startMinutes - p.breakMinutes),
                0,
              );

              return (
                <PersonRow
                  key={person.id}
                  departments={departments}
                  person={{
                    id: person.id,
                    username: person.username,
                    displayName: person.displayName,
                    role: person.role,
                    active: person.active,
                    department: person.department.name,
                    departmentId: person.departmentId,
                    startDate: person.startDate
                      ? person.startDate.toISOString().slice(0, 10)
                      : null,
                    endDate: person.endDate
                      ? person.endDate.toISOString().slice(0, 10)
                      : null,
                    weeklySummary: weekly
                      ? `${formatDuration(weekly)} a week`
                      : "no hours set",
                    patternSummary: person.workingPatterns.map((p) => ({
                      weekday: p.weekday,
                      label: weekdayName(p.weekday).slice(0, 3),
                      hours: `${formatClock(p.startMinutes)}–${formatClock(p.endMinutes)}`,
                      breakMinutes: p.breakMinutes,
                      breakStart:
                        p.breakStartMinutes != null
                          ? formatClock(p.breakStartMinutes)
                          : null,
                    })),
                  }}
                />
              );
            })}
          </div>
        </section>

        <NewPersonForm departments={departments} />
      </div>
    </div>
  );
}
