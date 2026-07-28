import Link from "next/link";
import { requireRole, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { CatalogueList } from "./catalogue-list";

export const dynamic = "force-dynamic";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const user = await requireRole("MANAGER");
  const params = await searchParams;

  const departments = hasRole(user, "ADMIN")
    ? await prisma.department.findMany({ orderBy: { name: "asc" } })
    : [];

  const departmentId =
    hasRole(user, "ADMIN") && params.dept ? params.dept : user.departmentId;

  const department = await prisma.department.findUniqueOrThrow({
    where: { id: departmentId },
  });

  const templates = await prisma.taskTemplate.findMany({
    where: { departmentId },
    include: { recurringRules: true },
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
  });

  const active = templates.filter((t) => t.active);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {department.name} — task catalogue
          </h1>
          <p className="page-sub num">
            {active.length} active ·{" "}
            {active.filter((t) => t.recurringRules.length > 0).length} on a
            schedule
          </p>
        </div>

        {departments.length > 0 && (
          <div className="flex flex-wrap gap-1 text-[13px]">
            {departments.map((d) => (
              <Link
                key={d.id}
                href={`/catalogue?dept=${d.id}`}
                className={
                  d.id === departmentId
                    ? "rounded-md bg-accent-wash px-2.5 py-1.5 text-[12.5px] font-semibold text-accent"
                    : "rounded-md px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                }
              >
                {d.name.replace(/\s*\(.*\)$/, "")}
              </Link>
            ))}
          </div>
        )}
      </div>

      <CatalogueList
        departmentId={departmentId}
        entries={templates.map((t) => {
          const rule = t.recurringRules[0];
          return {
            id: t.id,
            name: t.name,
            category: t.category,
            estimatedMinutes: t.estimatedMinutes,
            notes: t.notes,
            instructions: t.instructions,
            isMeeting: t.isMeeting,
            repeatable: t.repeatable,
            priority: t.priority as "MUST" | "NORMAL" | "SPARE_TIME",
            active: t.active,
            rule: rule
              ? {
                  frequency: rule.frequency as "WEEKLY" | "MONTHLY",
                  weekdays: rule.weekdays,
                  monthlyNth: rule.monthlyNth,
                  monthlyDay: rule.monthlyDay,
                  instancesPerOccurrence: rule.instancesPerOccurrence,
                  fixedStartMinutes: rule.fixedStartMinutes,
                }
              : null,
          };
        })}
      />
    </div>
  );
}
