/**
 * End-to-end check for attendance, against a dev database.
 *
 * Simulates a workday nobody closed -- signed in, started a task, walked away
 * with the timer running -- then runs the sweep and asserts the day was closed
 * at the end of the rostered shift rather than at whatever time the sweep
 * happened to run, and that the abandoned timer was ended with it.
 *
 * Creates its own throwaway department and deletes it afterwards. The first
 * version of verify-crm assumed an empty database and failed the moment there
 * was demo data in it, which is not much of a test.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  closeDay,
  markActivity,
  markArrival,
  sweepOpenDays,
} from "../src/lib/attendance/attendance-db";
import { elapsedSeconds, MAX_OPEN_SECONDS } from "../src/lib/tasks/elapsed";
import {
  addDays,
  instantAt,
  scheduleZone,
  today,
  toDateOnly,
} from "../src/lib/time";

const TAG = `__attendance_check__${Date.now()}`;

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  const mark = condition ? "  ok  " : " FAIL ";
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

/**
 * The clock time an instant shows on the company's clock.
 *
 * Asserting on UTC here is what made the first version of this script pass
 * while the app was two hours wrong: the fixtures were built in UTC but the
 * shift is measured in Europe/Madrid.
 */
function clockIn(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: scheduleZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

async function main() {
  const department = await prisma.department.create({ data: { name: TAG } });

  const user = await prisma.user.create({
    data: {
      username: `${TAG}_user`,
      passwordHash: "x",
      displayName: "Attendance Check",
      departmentId: department.id,
      // 09:00-18:00, no break, every weekday and both weekend days so the
      // check does not depend on which day it is run.
      workingPatterns: {
        create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinutes: 9 * 60,
          endMinutes: 18 * 60,
          breakMinutes: 0,
        })),
      },
    },
  });

  const template = await prisma.taskTemplate.create({
    data: { name: `${TAG} job`, estimatedMinutes: 30, departmentId: department.id },
  });

  // ---------------------------------------------------------- a normal day

  await markArrival(user.id, "LOGIN");
  await markActivity(user.id);

  let day = await prisma.attendanceDay.findUniqueOrThrow({
    where: { userId_date: { userId: user.id, date: today() } },
  });
  check("signing in opens the day", day.status === "OPEN" && day.startedAt != null);
  check("and records which signal it was", day.startSource === "LOGIN");

  const closed = await closeDay(user.id);
  day = await prisma.attendanceDay.findUniqueOrThrow({ where: { id: day.id } });
  check("closing the day closes the record", closed.closed && day.status === "CLOSED");
  check("marked as a deliberate close", day.endSource === "DAY_CLOSED");

  // Coming back to one more job must reopen it rather than leave a record
  // saying they had gone home.
  await markArrival(user.id, "TASK_START");
  day = await prisma.attendanceDay.findUniqueOrThrow({ where: { id: day.id } });
  check(
    "starting work again reopens the day",
    day.status === "OPEN" && day.endedAt === null,
  );

  // ------------------------------------------- yesterday, nobody closed it

  const yesterday = addDays(today(), -1);
  // 16:20 on the company's clock: the last thing they did, inside the shift.
  const lastSignal = instantAt(yesterday, 16 * 60 + 20);
  const arrived = instantAt(yesterday, 9 * 60);

  const abandoned = await prisma.attendanceDay.create({
    data: {
      userId: user.id,
      date: yesterday,
      startedAt: arrived,
      startSource: "LOGIN",
      firstLoginAt: arrived,
      lastActivityAt: lastSignal,
      status: "OPEN",
    },
  });

  // And a timer left running with it.
  const task = await prisma.task.create({
    data: {
      title: `${TAG} abandoned`,
      estimatedMinutes: 30,
      dueDate: yesterday,
      scheduledDate: yesterday,
      departmentId: department.id,
      templateId: template.id,
      assigneeId: user.id,
      status: "IN_PROGRESS",
      origin: "CATALOGUE",
    },
  });
  const entry = await prisma.timeEntry.create({
    data: {
      taskId: task.id,
      userId: user.id,
      // Started three days ago, so it is unambiguously past the cap.
      startedAt: addDays(toDateOnly(new Date()), -3),
    },
  });

  const before = await prisma.timeEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { pauses: true },
  });
  const runaway = elapsedSeconds([before], new Date(), Number.MAX_SAFE_INTEGER);
  check(
    "an unswept timer would have counted for days",
    runaway > 48 * 3600,
    `${Math.round(runaway / 3600)}h`,
  );

  const summary = await sweepOpenDays();
  check("the sweep closed a day", summary.daysClosed >= 1);
  check("and ended the abandoned timer", summary.entriesClosed >= 1);

  const swept = await prisma.attendanceDay.findUniqueOrThrow({
    where: { id: abandoned.id },
  });
  check(
    "closed at the last real signal, not at sweep time",
    swept.endedAt != null && clockIn(swept.endedAt) === "16:20",
    swept.endedAt ? clockIn(swept.endedAt) : "null",
  );
  check("flagged as a guess", swept.status === "NEEDS_REVIEW");
  check("and as inferred", swept.endSource === "AUTO_CLOSE");

  const after = await prisma.timeEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { pauses: true },
  });
  check("the timer now has an end", after.endedAt != null);
  check(
    "and stops at the cap rather than running on",
    elapsedSeconds([after]) === MAX_OPEN_SECONDS,
    `${Math.round(elapsedSeconds([after]) / 3600)}h`,
  );

  // The task itself is untouched: unfinished work must never be marked done.
  const taskAfter = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  check("the unfinished task is not marked done", taskAfter.status === "IN_PROGRESS");

  // ------------------------------------- a rostered day capped at the shift

  const twoDaysAgo = addDays(today(), -2);
  const lateSignal = instantAt(twoDaysAgo, 23 * 60);
  const cameIn = instantAt(twoDaysAgo, 9 * 60);
  const capped = await prisma.attendanceDay.create({
    data: {
      userId: user.id,
      date: twoDaysAgo,
      startedAt: cameIn,
      startSource: "LOGIN",
      firstLoginAt: cameIn,
      lastActivityAt: lateSignal,
      status: "OPEN",
    },
  });

  await sweepOpenDays();
  const cappedAfter = await prisma.attendanceDay.findUniqueOrThrow({
    where: { id: capped.id },
  });
  check(
    "a signal at 23:00 is capped at the end of the shift",
    cappedAfter.endedAt != null && clockIn(cappedAfter.endedAt) === "18:00",
    cappedAfter.endedAt ? clockIn(cappedAfter.endedAt) : "null",
  );

  // ------------------------------------------------------------- clean up

  await prisma.timeEntry.deleteMany({ where: { userId: user.id } });
  await prisma.task.deleteMany({ where: { departmentId: department.id } });
  await prisma.attendanceDay.deleteMany({ where: { userId: user.id } });
  await prisma.taskTemplate.deleteMany({ where: { departmentId: department.id } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.department.delete({ where: { id: department.id } });

  console.log(
    failures === 0
      ? "\nAll attendance checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
