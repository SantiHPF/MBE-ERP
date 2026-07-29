import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { formatClock } from "../src/lib/time";
import { weekdayLabel } from "../src/lib/i18n/dates";

/**
 * Loads recurring rules from a fixture extracted from the department's
 * calendar export.
 *
 *   npx tsx scripts/import-recurring.ts fixtures/recurring-hr.json
 *
 * Rules are keyed by template, so re-running replaces a task's schedule rather
 * than stacking a second copy on top of it.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type RuleSpec = {
  task: string;
  estimatedMinutes: number | null;
  frequency: "WEEKLY" | "MONTHLY";
  weekdays: number[];
  monthlyNth?: number;
  monthlyDay?: number;
  fixedStartMinutes?: number;
  fixedEndMinutes?: number;
  sourceNote?: string;
};

function describe(rule: RuleSpec): string {
  if (rule.frequency === "MONTHLY") {
    if (rule.monthlyDay != null) return `monthly on day ${rule.monthlyDay}`;
    const nth = rule.monthlyNth === -1 ? "last" : `#${rule.monthlyNth}`;
    return `monthly, ${nth} ${weekdayLabel("EN", rule.weekdays[0])}`;
  }
  const days = rule.weekdays.map((d) => weekdayLabel("EN", d, "short")).join(" ");
  return rule.weekdays.length === 5 ? "every weekday" : days;
}

async function main() {
  const path = process.argv[2] ?? "fixtures/recurring-hr.json";
  const { department, rules } = JSON.parse(readFileSync(path, "utf8")) as {
    department: string;
    rules: RuleSpec[];
  };

  const dept = await prisma.department.findUnique({ where: { name: department } });
  if (!dept) throw new Error(`Department not found: ${department}`);

  const templates = await prisma.taskTemplate.findMany({
    where: { departmentId: dept.id },
  });
  const byName = new Map(templates.map((t) => [t.name.toLowerCase(), t]));

  let created = 0;
  const missing: string[] = [];

  for (const rule of rules) {
    const template = byName.get(rule.task.toLowerCase());
    if (!template) {
      missing.push(rule.task);
      continue;
    }

    // One schedule per task: replace rather than accumulate.
    await prisma.recurringRule.deleteMany({ where: { templateId: template.id } });

    await prisma.recurringRule.create({
      data: {
        templateId: template.id,
        departmentId: dept.id,
        frequency: rule.frequency,
        weekdays: rule.weekdays,
        monthlyNth: rule.monthlyNth ?? null,
        monthlyDay: rule.monthlyDay ?? null,
        fixedStartMinutes: rule.fixedStartMinutes ?? null,
        fixedEndMinutes: rule.fixedEndMinutes ?? null,
        sourceNote: rule.sourceNote ?? null,
      },
    });
    created += 1;
  }

  console.log(`\n${department} — ${created} recurring rules imported\n`);

  const imported = await prisma.recurringRule.findMany({
    where: { departmentId: dept.id },
    include: { template: true },
    orderBy: { template: { name: "asc" } },
  });

  for (const r of imported) {
    const spec = rules.find(
      (x) => x.task.toLowerCase() === r.template.name.toLowerCase(),
    )!;
    const fixed =
      r.fixedStartMinutes != null
        ? `  fixed ${formatClock(r.fixedStartMinutes)}`
        : "";
    console.log(
      `  ${r.template.name.padEnd(34)}${String(r.template.estimatedMinutes).padStart(4)}m  ${describe(spec).padEnd(28)}${fixed}`,
    );
  }

  if (missing.length > 0) {
    console.log(`\n  Not found in the catalogue (${missing.length}):`);
    for (const m of missing) console.log(`    ${m}`);
  }
  console.log();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
