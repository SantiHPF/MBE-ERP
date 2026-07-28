import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Loads the task catalogue from fixtures/catalogue.json, extracted from the
 * "Catalogo" tab of the company spreadsheet.
 *
 *   npx tsx scripts/import-catalogue.ts
 *
 * Matches on department + name, so re-running updates durations and notes
 * rather than creating duplicates. Nothing is deleted: a task that disappears
 * from the sheet is deactivated, not removed, because tasks already scheduled
 * against it still need it to exist.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type Entry = {
  department: string;
  sheetCode: string;
  name: string;
  estimatedMinutes: number;
  notes: string | null;
  instructions: string | null;
  isMeeting?: boolean;
  repeatable?: boolean;
};

async function main() {
  const entries: Entry[] = JSON.parse(
    readFileSync("fixtures/catalogue.json", "utf8"),
  );

  const departments = await prisma.department.findMany();
  const byName = new Map(departments.map((d) => [d.name, d.id]));

  const missing = [
    ...new Set(entries.map((e) => e.department).filter((d) => !byName.has(d))),
  ];
  if (missing.length > 0) {
    throw new Error(
      `These departments do not exist yet: ${missing.join(", ")}. ` +
        `Run \`npm run seed\` first, or create them in HR → People.`,
    );
  }

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    const departmentId = byName.get(entry.department)!;
    seen.add(`${departmentId}:${entry.name}`);

    const existing = await prisma.taskTemplate.findUnique({
      where: { departmentId_name: { departmentId, name: entry.name } },
    });

    if (existing) {
      await prisma.taskTemplate.update({
        where: { id: existing.id },
        data: {
          estimatedMinutes: entry.estimatedMinutes,
          notes: entry.notes,
          instructions: entry.instructions,
          isMeeting: entry.isMeeting ?? false,
          repeatable: entry.repeatable ?? false,
          active: true,
        },
      });
      updated += 1;
    } else {
      await prisma.taskTemplate.create({
        data: {
          departmentId,
          name: entry.name,
          estimatedMinutes: entry.estimatedMinutes,
          notes: entry.notes,
          instructions: entry.instructions,
          isMeeting: entry.isMeeting ?? false,
          repeatable: entry.repeatable ?? false,
        },
      });
      created += 1;
    }
  }

  // Anything previously imported that is no longer in the sheet gets retired
  // rather than deleted -- history and scheduled work still reference it.
  const all = await prisma.taskTemplate.findMany({
    where: { active: true },
    select: { id: true, departmentId: true, name: true },
  });
  const stale = all.filter((t) => !seen.has(`${t.departmentId}:${t.name}`));

  if (stale.length > 0) {
    await prisma.taskTemplate.updateMany({
      where: { id: { in: stale.map((t) => t.id) } },
      data: { active: false },
    });
  }

  console.log(`\nCatalogue imported from fixtures/catalogue.json`);
  console.log(`  created    ${created}`);
  console.log(`  updated    ${updated}`);
  console.log(`  retired    ${stale.length}`);

  const counts = await prisma.taskTemplate.groupBy({
    by: ["departmentId"],
    where: { active: true },
    _count: { _all: true },
    _sum: { estimatedMinutes: true },
  });

  console.log("\n  Active tasks per department:");
  for (const row of counts) {
    const name = departments.find((d) => d.id === row.departmentId)?.name;
    console.log(
      `    ${(name ?? "?").padEnd(26)} ${String(row._count._all).padStart(3)} tasks`,
    );
  }
  console.log(
    "\n  No recurring rules yet — nothing is scheduled automatically until",
  );
  console.log("  the calendar data arrives.\n");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
