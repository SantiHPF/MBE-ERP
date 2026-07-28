import { requirePeopleAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { formatClock, formatDuration, weekdayName } from "@/lib/time";
import { NewDepartmentForm } from "./new-person-form";
import { AddPersonPanel } from "./add-person-panel";
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
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">People</h1>
          <p className="page-sub">
            Accounts, working hours and employment dates. Only HR can change
            these.
          </p>
        </div>
        <AddPersonPanel departments={departments} />
      </div>

      <div className="flex flex-col gap-5">
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

        <NewDepartmentForm />
      </div>
    </div>
  );
}
