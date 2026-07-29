/**
 * Proves the two partial unique indexes from 20260728140000_concurrency_guards
 * actually fire, by racing the exact operations that used to corrupt data.
 *
 * Run against a dev database: npx tsx scripts/verify-concurrency.ts
 * It cleans up everything it creates.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;

function check(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "  ok  " : " FAIL "} ${name} — ${detail}`);
  if (!passed) failures += 1;
}

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { active: true } });
  const department = await prisma.department.findFirstOrThrow();
  const day = new Date("2099-01-05T00:00:00Z");

  // ---------------------------------------------- one running clock per person
  const [a, b] = await Promise.all([
    prisma.task.create({
      data: {
        title: "race A",
        estimatedMinutes: 30,
        dueDate: day,
        departmentId: department.id,
        origin: "MANUAL",
        status: "ASSIGNED",
        assigneeId: user.id,
      },
    }),
    prisma.task.create({
      data: {
        title: "race B",
        estimatedMinutes: 30,
        dueDate: day,
        departmentId: department.id,
        origin: "MANUAL",
        status: "ASSIGNED",
        assigneeId: user.id,
      },
    }),
  ]);

  const starts = await Promise.allSettled([
    prisma.timeEntry.create({ data: { taskId: a.id, userId: user.id } }),
    prisma.timeEntry.create({ data: { taskId: b.id, userId: user.id } }),
  ]);
  const won = starts.filter((r) => r.status === "fulfilled").length;

  check(
    "TimeEntry_one_open_per_user",
    won === 1,
    `${won} of 2 concurrent starts opened a clock (want exactly 1)`,
  );

  await prisma.timeEntry.deleteMany({ where: { taskId: { in: [a.id, b.id] } } });
  await prisma.task.deleteMany({ where: { id: { in: [a.id, b.id] } } });

  // --------------------------------------- one plan-board claim per day
  const template = await prisma.taskTemplate.findFirstOrThrow();
  const people = await prisma.user.findMany({ where: { active: true }, take: 2 });

  const claims = await Promise.allSettled(
    people.map((p) =>
      prisma.task.create({
        data: {
          title: template.name,
          estimatedMinutes: template.estimatedMinutes,
          dueDate: day,
          departmentId: department.id,
          templateId: template.id,
          origin: "CATALOGUE",
          status: "ASSIGNED",
          assigneeId: p.id,
        },
      }),
    ),
  );
  const claimed = claims.filter((r) => r.status === "fulfilled").length;

  check(
    "Task_one_catalogue_claim_per_day",
    claimed === 1,
    `${claimed} of ${people.length} concurrent claims created a task (want exactly 1)`,
  );

  await prisma.task.deleteMany({ where: { dueDate: day } });

  // ------------- a recurring rule may still fire twice for one template/day
  const twice = await Promise.allSettled(
    [1, 2].map((n) =>
      prisma.task.create({
        data: {
          externalKey: `verify:recurring:${n}`,
          title: `${template.name} (${n} of 2)`,
          estimatedMinutes: template.estimatedMinutes,
          dueDate: day,
          departmentId: department.id,
          templateId: template.id,
          origin: "RECURRING",
          status: "UNASSIGNED",
        },
      }),
    ),
  );
  const madeBoth = twice.filter((r) => r.status === "fulfilled").length;

  check(
    "materializer not blocked",
    madeBoth === 2,
    `${madeBoth} of 2 RECURRING instances created (want 2 — instancesPerOccurrence must still work)`,
  );

  await prisma.task.deleteMany({ where: { dueDate: day } });

  console.log(failures === 0 ? "\nall guards behave as intended" : `\n${failures} failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
