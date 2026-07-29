import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";
import { parseClock } from "../src/lib/time";

/**
 * The real organisation.
 *
 * Only the founding accounts are here. Everybody else is created through
 * HR → People in the app, which is the point of that screen existing. Run
 * `npm run seed:demo` instead if you want the throwaway sample data.
 *
 * Working hours use the local split shift: a long morning, a two-hour break,
 * then an afternoon. Because the break is positioned, work is scheduled around
 * it rather than through it.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * The founding accounts' first password.
 *
 * Read from the environment, with a random value when it is not set, so that
 * no usable credential lives in this file or in the history of it. Set
 * SEED_PASSWORD when you want a known one for local development; otherwise the
 * generated one is printed once at the end of the run and never stored.
 *
 * The old hard-coded default is still in git history. It was never deployed,
 * but it must not come back.
 */
const INITIAL_PASSWORD =
  process.env.SEED_PASSWORD ?? randomBytes(9).toString("base64url");

const DEPARTMENTS = [
  "HR (Human Resources)",
  "ADE (Admin & Legal)",
  "ATIC (Informatica)",
  "MYD (Marketing y Diseño)",
  "ACA (Academics)",
];

/** [weekday, start, end, breakMinutes, breakStart?] */
type Shift = [number, string, string, number, string?];

/** 09:00-14:00, break, 16:00-19:00 -- eight worked hours. */
const SPLIT = (weekday: number): Shift => [
  weekday,
  "09:00",
  "19:00",
  120,
  "14:00",
];

/** 09:00-14:00 only -- five hours, no break. */
const MORNING = (weekday: number): Shift => [weekday, "09:00", "14:00", 0];

/** 16:00-19:00 only -- a three-hour afternoon. */
const AFTERNOON = (weekday: number): Shift => [weekday, "16:00", "19:00", 0];

const PEOPLE: {
  username: string;
  displayName: string;
  department: string;
  role: "WORKER" | "MANAGER" | "HR" | "ADMIN";
  shifts: Shift[];
}[] = [
  {
    username: "santi",
    displayName: "Santiago Hernandez",
    department: "HR (Human Resources)",
    role: "HR",
    shifts: [
      SPLIT(1),
      SPLIT(2),
      SPLIT(3),
      SPLIT(4),
      MORNING(5),
      AFTERNOON(6),
    ],
  },
  {
    username: "chao",
    displayName: "Chao Alarcon",
    department: "ATIC (Informatica)",
    role: "WORKER",
    shifts: [
      MORNING(1),
      SPLIT(2),
      MORNING(3),
      SPLIT(4),
      MORNING(5),
    ],
  },
];

async function main() {
  // Safe to re-run: wipes and rebuilds.
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

  const departments = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const created = await prisma.department.create({ data: { name } });
    departments.set(name, created.id);
  }

  const passwordHash = await hashPassword(INITIAL_PASSWORD);

  for (const person of PEOPLE) {
    const departmentId = departments.get(person.department);
    if (!departmentId) throw new Error(`Unknown department: ${person.department}`);

    const user = await prisma.user.create({
      data: {
        username: person.username,
        displayName: person.displayName,
        role: person.role,
        departmentId,
        passwordHash,
      },
    });

    await prisma.workingPattern.createMany({
      data: person.shifts.map(([weekday, start, end, brk, breakStart]) => ({
        userId: user.id,
        weekday,
        startMinutes: parseClock(start),
        endMinutes: parseClock(end),
        breakMinutes: brk,
        breakStartMinutes: breakStart ? parseClock(breakStart) : null,
      })),
    });
  }

  console.log(`\nSeeded ${DEPARTMENTS.length} departments:`);
  for (const name of DEPARTMENTS) console.log(`  ${name}`);

  console.log(`\nSeeded ${PEOPLE.length} people:`);
  for (const p of PEOPLE) {
    console.log(`  ${p.displayName} — ${p.username} (${p.role})`);
  }

  console.log(`\n  Password for both: ${INITIAL_PASSWORD}`);
  console.log(
    process.env.SEED_PASSWORD
      ? "  From SEED_PASSWORD. Change it in HR → People after signing in.\n"
      : "  Generated, and shown only here. Write it down, then change it in HR → People.\n",
  );
  console.log("  The task catalogue is empty — add it once the lists arrive.");
  console.log("  Everyone else gets added through HR → People.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
