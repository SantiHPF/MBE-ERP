import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";
import { parseClock } from "../src/lib/time";
import { refreshRotationLedger } from "../src/lib/scheduling/run";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Weekly hours are deliberately uneven across these people -- a short Friday,
 * a late Monday start, a three-day week, someone who never works Mondays.
 * The scheduling tests lean on that, and so does anyone eyeballing the
 * calendar to check it looks right.
 */
/** [start, end, breakMinutes, breakStart] -- breakStart positions the gap. */
type PatternSpec = Record<number, [string, string, number, string?]>;

const FULL_WEEK: PatternSpec = {
  1: ["09:00", "18:00", 60, "13:00"],
  2: ["09:00", "18:00", 60, "13:00"],
  3: ["09:00", "18:00", 60, "13:00"],
  4: ["09:00", "18:00", 60, "13:00"],
  5: ["09:00", "14:00", 0],
};

const LATE_MONDAY: PatternSpec = {
  1: ["11:00", "18:00", 30, "14:00"],
  2: ["09:00", "17:00", 60, "13:00"],
  3: ["09:00", "17:00", 60, "13:00"],
  4: ["09:00", "17:00", 60, "13:00"],
  5: ["09:00", "17:00", 60, "13:00"],
};

const THREE_DAYS: PatternSpec = {
  1: ["09:00", "15:00", 30, "12:00"],
  3: ["09:00", "15:00", 30, "12:00"],
  5: ["09:00", "15:00", 30, "12:00"],
};

const EARLY_SHIFT: PatternSpec = {
  1: ["08:00", "16:00", 45, "12:30"],
  2: ["08:00", "16:00", 45, "12:30"],
  3: ["08:00", "16:00", 45, "12:30"],
  4: ["08:00", "16:00", 45, "12:30"],
  5: ["08:00", "16:00", 45, "12:30"],
};

const NO_MONDAYS: PatternSpec = {
  2: ["09:00", "18:00", 60, "13:00"],
  3: ["09:00", "18:00", 60, "13:00"],
  4: ["09:00", "18:00", 60, "13:00"],
  5: ["09:00", "18:00", 60, "13:00"],
};

async function createUser(opts: {
  username: string;
  displayName: string;
  role: "WORKER" | "MANAGER" | "ADMIN";
  departmentId: string;
  pattern: PatternSpec;
}) {
  const user = await prisma.user.create({
    data: {
      username: opts.username,
      displayName: opts.displayName,
      role: opts.role,
      departmentId: opts.departmentId,
      // Development seed only. Real accounts are created in the admin screens.
      passwordHash: await hashPassword("password"),
    },
  });

  await prisma.workingPattern.createMany({
    data: Object.entries(opts.pattern).map(
      ([weekday, [start, end, brk, brkStart]]) => ({
        userId: user.id,
        weekday: Number(weekday),
        startMinutes: parseClock(start),
        endMinutes: parseClock(end),
        breakMinutes: brk,
        breakStartMinutes: brkStart ? parseClock(brkStart) : null,
      }),
    ),
  });

  return user;
}

async function main() {
  // Idempotent: wipe and rebuild, so `npm run seed` is safe to re-run.
  await prisma.$transaction([
    prisma.pauseEvent.deleteMany(),
    prisma.timeEntry.deleteMany(),
    prisma.triageAction.deleteMany(),
    prisma.actionItem.deleteMany(),
    prisma.task.deleteMany(),
    prisma.meeting.deleteMany(),
    prisma.rotationLedger.deleteMany(),
    prisma.recurringRule.deleteMany(),
    prisma.taskTemplate.deleteMany(),
    prisma.sheetSource.deleteMany(),
    prisma.absence.deleteMany(),
    prisma.dayOverride.deleteMany(),
    prisma.workingPattern.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.department.deleteMany(),
  ]);

  const operations = await prisma.department.create({
    data: { name: "Operations" },
  });
  const clientServices = await prisma.department.create({
    data: { name: "Client Services" },
  });

  await createUser({
    username: "santi",
    displayName: "Santi Hernandez",
    role: "ADMIN",
    departmentId: operations.id,
    pattern: FULL_WEEK,
  });

  await createUser({
    username: "marta",
    displayName: "Marta Ruiz",
    role: "MANAGER",
    departmentId: operations.id,
    pattern: FULL_WEEK,
  });

  const luis = await createUser({
    username: "luis",
    displayName: "Luis Ferrer",
    role: "WORKER",
    departmentId: operations.id,
    pattern: FULL_WEEK,
  });

  const ana = await createUser({
    username: "ana",
    displayName: "Ana Molina",
    role: "WORKER",
    departmentId: operations.id,
    pattern: LATE_MONDAY,
  });

  const pau = await createUser({
    username: "pau",
    displayName: "Pau Serra",
    role: "WORKER",
    departmentId: operations.id,
    pattern: THREE_DAYS,
  });

  await createUser({
    username: "carmen",
    displayName: "Carmen Ortiz",
    role: "MANAGER",
    departmentId: clientServices.id,
    pattern: FULL_WEEK,
  });

  const diego = await createUser({
    username: "diego",
    displayName: "Diego Vidal",
    role: "WORKER",
    departmentId: clientServices.id,
    pattern: EARLY_SHIFT,
  });

  const elena = await createUser({
    username: "elena",
    displayName: "Elena Pons",
    role: "WORKER",
    departmentId: clientServices.id,
    pattern: NO_MONDAYS,
  });

  // ------------------------------------------------------------- catalogue

  const templates = await Promise.all(
    [
      {
        name: "Warehouse stock count",
        category: "Recurring ops",
        estimatedMinutes: 90,
        departmentId: operations.id,
      },
      {
        name: "Supplier order review",
        category: "Recurring ops",
        estimatedMinutes: 60,
        departmentId: operations.id,
      },
      {
        name: "Equipment safety check",
        category: "Compliance",
        estimatedMinutes: 45,
        departmentId: operations.id,
      },
      {
        name: "Weekly ops report",
        category: "Reporting",
        estimatedMinutes: 120,
        departmentId: operations.id,
      },
      {
        name: "Client check-in call",
        category: "Accounts",
        estimatedMinutes: 30,
        departmentId: clientServices.id,
      },
      {
        name: "Invoice reconciliation",
        category: "Finance",
        estimatedMinutes: 75,
        departmentId: clientServices.id,
      },
      {
        name: "Support inbox sweep",
        category: "Support",
        estimatedMinutes: 45,
        departmentId: clientServices.id,
      },
    ].map((data) => prisma.taskTemplate.create({ data })),
  );

  const byName = Object.fromEntries(templates.map((t) => [t.name, t]));

  // ---------------------------------------------------- recurring schedule

  await prisma.recurringRule.createMany({
    data: [
      {
        templateId: byName["Warehouse stock count"].id,
        departmentId: operations.id,
        weekdays: [1, 4],
      },
      {
        templateId: byName["Supplier order review"].id,
        departmentId: operations.id,
        weekdays: [2],
      },
      {
        templateId: byName["Equipment safety check"].id,
        departmentId: operations.id,
        weekdays: [1, 3, 5],
      },
      {
        // Fixed slot: the report is due before the Friday management call.
        templateId: byName["Weekly ops report"].id,
        departmentId: operations.id,
        weekdays: [5],
        fixedStartMinutes: parseClock("09:00"),
        fixedEndMinutes: parseClock("11:00"),
      },
      {
        templateId: byName["Client check-in call"].id,
        departmentId: clientServices.id,
        weekdays: [1, 2, 3, 4, 5],
        instancesPerOccurrence: 3,
      },
      {
        templateId: byName["Invoice reconciliation"].id,
        departmentId: clientServices.id,
        weekdays: [3],
      },
      {
        templateId: byName["Support inbox sweep"].id,
        departmentId: clientServices.id,
        weekdays: [1, 2, 3, 4, 5],
      },
    ],
  });

  // ------------------------------------------------------ prior history
  //
  // Rotation history is derived from finished tasks, not stored as a bare
  // counter, so "Luis has done the stock count four times" has to be four
  // actual tasks. Seeding real rows keeps the ledger consistent with the
  // thing it summarises.

  const history: {
    template: string;
    userId: string;
    daysAgo: number;
    actualMinutes: number;
  }[] = [
    // Luis has been carrying the stock count.
    { template: "Warehouse stock count", userId: luis.id, daysAgo: 3, actualMinutes: 95 },
    { template: "Warehouse stock count", userId: luis.id, daysAgo: 7, actualMinutes: 88 },
    { template: "Warehouse stock count", userId: luis.id, daysAgo: 10, actualMinutes: 102 },
    { template: "Warehouse stock count", userId: luis.id, daysAgo: 14, actualMinutes: 90 },
    { template: "Warehouse stock count", userId: ana.id, daysAgo: 17, actualMinutes: 110 },
    // Pau has never had it -- the engine should give him a turn first.

    // Same story in Client Services: Diego has been absorbing the inbox.
    { template: "Support inbox sweep", userId: diego.id, daysAgo: 2, actualMinutes: 50 },
    { template: "Support inbox sweep", userId: diego.id, daysAgo: 3, actualMinutes: 44 },
    { template: "Support inbox sweep", userId: diego.id, daysAgo: 4, actualMinutes: 61 },
    { template: "Support inbox sweep", userId: diego.id, daysAgo: 8, actualMinutes: 39 },
    { template: "Support inbox sweep", userId: diego.id, daysAgo: 9, actualMinutes: 47 },
    { template: "Support inbox sweep", userId: diego.id, daysAgo: 11, actualMinutes: 45 },
    { template: "Support inbox sweep", userId: elena.id, daysAgo: 15, actualMinutes: 52 },
    { template: "Support inbox sweep", userId: elena.id, daysAgo: 16, actualMinutes: 41 },
  ];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const [index, row] of history.entries()) {
    const template = byName[row.template];
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - row.daysAgo);

    const task = await prisma.task.create({
      data: {
        externalKey: `seed-history:${index}`,
        title: template.name,
        estimatedMinutes: template.estimatedMinutes,
        dueDate: date,
        scheduledDate: date,
        scheduledStart: parseClock("09:00"),
        scheduledEnd: parseClock("09:00") + template.estimatedMinutes,
        departmentId: template.departmentId,
        templateId: template.id,
        assigneeId: row.userId,
        origin: "RECURRING",
        status: "DONE",
      },
    });

    // A finished task has a time entry -- that is where actual-vs-estimate
    // comes from later.
    const startedAt = new Date(date);
    startedAt.setUTCHours(9, 0, 0, 0);
    await prisma.timeEntry.create({
      data: {
        taskId: task.id,
        userId: row.userId,
        startedAt,
        endedAt: new Date(startedAt.getTime() + row.actualMinutes * 60_000),
      },
    });
  }

  await refreshRotationLedger();

  console.log("Seeded:");
  console.log(`  ${history.length} finished tasks as rotation history`);
  console.log(`  2 departments, 8 users (password: "password")`);
  console.log(`  ${templates.length} catalogue templates, 7 recurring rules`);
  console.log(`  admin login: santi / password`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
