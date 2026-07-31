import { requireRole, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { CatalogueList } from "./catalogue-list";
import { DepartmentPicker } from "./department-picker";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const user = await requireRole("MANAGER");
  const params = await searchParams;
  const { t } = await getT();

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

  const active = templates.filter((tpl) => tpl.active);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {t("catalogue.title", department.name)}
          </h1>
          <p className="page-sub num">
            {t(
              "catalogue.summary",
              active.length,
              active.filter((x) => x.recurringRules.length > 0).length,
            )}
          </p>
        </div>

        <DepartmentPicker departments={departments} current={departmentId} />
      </div>

      {!canEdit && (
        <p className="notice notice-warn mb-3">
          {t("catalogue.readOnly", department.name)}
        </p>
      )}

      <CatalogueList
        canEdit={canEdit}
        departmentId={departmentId}
        entries={templates.map((tpl) => {
          const rule = tpl.recurringRules[0];
          return {
            id: tpl.id,
            name: tpl.name,
            category: tpl.category,
            estimatedMinutes: tpl.estimatedMinutes,
            sessionMinutes: tpl.sessionMinutes,
            notes: tpl.notes,
            instructions: tpl.instructions,
            isMeeting: tpl.isMeeting,
            repeatable: tpl.repeatable,
            priority: tpl.priority as "MUST" | "NORMAL" | "SPARE_TIME",
            shiftHalf: tpl.shiftHalf,
            followsId: tpl.followsId,
            active: tpl.active,
            rule: rule
              ? {
                  frequency: rule.frequency as "WEEKLY" | "MONTHLY",
                  weekdays: rule.weekdays,
                  monthlyNth: rule.monthlyNth,
                  monthlyDay: rule.monthlyDay,
                  instancesPerOccurrence: rule.instancesPerOccurrence,
                  anchors: rule.anchors,
                  fixedStartMinutes: rule.fixedStartMinutes,
                }
              : null,
          };
        })}
      />
    </div>
  );
}
