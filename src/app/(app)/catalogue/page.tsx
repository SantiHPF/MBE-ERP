import { requireRole, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { CatalogueList } from "./catalogue-list";
import { DepartmentPicker } from "./department-picker";

export const dynamic = "force-dynamic";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const user = await requireRole("MANAGER");
  const params = await searchParams;

  // Any manager can browse every department's catalogue -- knowing what
  // another team does is useful and harmless. Editing is a separate question,
  // settled just below and enforced again on the server.
  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
  });

  const departmentId =
    params.dept && departments.some((d) => d.id === params.dept)
      ? params.dept
      : user.departmentId;

  const canEdit = hasRole(user, "ADMIN") || departmentId === user.departmentId;

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

        <DepartmentPicker departments={departments} current={departmentId} />
      </div>

      {!canEdit && (
        <p className="notice notice-warn mb-3">
          You are looking at {department.name}. Only that department&rsquo;s
          managers can change it.
        </p>
      )}

      <CatalogueList
        canEdit={canEdit}
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
