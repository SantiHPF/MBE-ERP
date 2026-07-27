import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";
import { parseClock } from "../src/lib/time";

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

  // Seed some rotation history so fairness has something to work with on the
  // very first scheduling run rather than falling straight to the tie-break.
  await prisma.rotationLedger.createMany({
    data: [
      {
        templateId: byName["Warehouse stock count"].id,
        userId: luis.id,
        completedCount: 4,
        lastAssignedAt: new Date(),
      },
      {
        templateId: byName["Warehouse stock count"].id,
        userId: ana.id,
        completedCount: 1,
      },
      {
        templateId: byName["Warehouse stock count"].id,
        userId: pau.id,
        completedCount: 0,
      },
      {
        templateId: byName["Support inbox sweep"].id,
        userId: diego.id,
        completedCount: 6,
        lastAssignedAt: new Date(),
      },
      {
        templateId: byName["Support inbox sweep"].id,
        userId: elena.id,
        completedCount: 2,
      },
    ],
  });

  console.log("Seeded:");
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
