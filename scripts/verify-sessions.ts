/**
 * Proves that a job too long for one sitting behaves itself.
 *
 * The arithmetic is unit-tested in src/lib/plan/sessions.test.ts. What only a
 * database can show is that a ten-hour job really does land as sittings across
 * several working days, that the parent stays invisible to everything that
 * reads a day, that nothing counts its minutes twice, that finishing early
 * gives the remaining days back -- and, most importantly, that re-running the
 * scheduler leaves every sitting exactly where it was.
 *
 * Run against a dev database: npx tsx scripts/verify-sessions.ts
 * It cleans up everything it creates.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { ensureSessions, finishSplitJob } from "../src/lib/plan/sessions-db";
import { getDayView } from "../src/lib/tasks/day";
import { getNowState } from "../src/lib/tasks/now-db";
import { pace } from "../src/lib/tasks/pace";
import { runSchedule } from "../src/lib/scheduling/run";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;

function check(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "  ok  " : " FAIL "} ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const MARK = "verify-sessions:";

function dayOffset(days: number): Date {
  const now = new Date();
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc;
}

const key = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
  // Somebody with a real working pattern, or there are no windows to place in.
  const user = await prisma.user.findFirstOrThrow({
    where: { active: true, workingPatterns: { some: {} } },
  });
  const departmentId = user.departmentId;

  try {
    // ------------------------------------------------- a ten-hour ATIC job
    const job = await prisma.task.create({
      data: {
        title: `${MARK} memoria tecnica`,
        estimatedMinutes: 600,
        dueDate: dayOffset(9),
        departmentId,
        origin: "MANUAL",
        status: "ASSIGNED",
        assigneeId: user.id,
      },
    });

    const split = await ensureSessions(job.id);
    check(
      "a ten-hour job is cut into sittings",
      split.split && split.created === 4,
      `${split.created} sittings, ${split.placed} placed, ${split.unplaced} unplaced`,
    );

    const parent = await prisma.task.findUniqueOrThrow({
      where: { id: job.id },
      include: { sessions: { orderBy: { sessionIndex: "asc" } } },
    });

    check(
      "the parent is not work",
      parent.status === "SPLIT" &&
        parent.scheduledDate === null &&
        parent.scheduledStart === null &&
        parent.scheduledEnd === null,
      `status ${parent.status}, slot ${key(parent.scheduledDate)}`,
    );

    check(
      "the sittings add back up to the whole estimate",
      parent.sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0) === 600,
      parent.sessions.map((s) => s.estimatedMinutes).join(" + "),
    );

    const placedDays = parent.sessions
      .filter((s) => s.scheduledDate)
      .map((s) => key(s.scheduledDate));
    check(
      "they are spread across more than one day",
      new Set(placedDays).size > 1,
      placedDays.join(", ") || "none placed",
    );

    // Sitting n never starts before sitting n-1 finishes.
    const ordered = parent.sessions.filter((s) => s.scheduledDate);
    let monotonic = true;
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const next = ordered[i];
      const sameDay = key(prev.scheduledDate) === key(next.scheduledDate);
      if (key(next.scheduledDate) < key(prev.scheduledDate)) monotonic = false;
      if (sameDay && (next.scheduledStart ?? 0) < (prev.scheduledEnd ?? 0)) {
        monotonic = false;
      }
    }
    check(
      "the sittings never read backwards",
      monotonic,
      ordered
        .map((s) => `${s.sessionIndex}:${key(s.scheduledDate)}@${s.scheduledStart}`)
        .join(" "),
    );

    check(
      "none of them lands past the deadline",
      parent.sessions.every(
        (s) => !s.scheduledDate || key(s.scheduledDate) <= key(parent.dueDate),
      ),
      `due ${key(parent.dueDate)}`,
    );

    // --------------------------------------------- the parent stays hidden
    const firstDay = ordered[0]?.scheduledDate ?? dayOffset(0);
    const view = await getDayView(user.id, firstDay);
    check(
      "the parent never appears in My Day",
      !view.tasks.some((t) => t.id === job.id),
      `${view.tasks.length} tasks on ${key(firstDay)}`,
    );

    const now = await getNowState(user.id, firstDay);
    check(
      "nor in the now-bar",
      !now.tasks.some((t) => t.id === job.id),
      `${now.tasks.length} tasks in state`,
    );

    const sittingsToday = view.tasks.filter((t) => t.session !== null);
    check(
      "a sitting shows as one sitting of the job",
      sittingsToday.length > 0 && sittingsToday[0].session!.total === 4,
      sittingsToday[0]
        ? `sitting ${sittingsToday[0].session!.index} of ${sittingsToday[0].session!.total}`
        : "no sitting found on the day",
    );

    // ------------------------------------------------------ no double count
    const mine = view.tasks.filter((t) => t.session !== null);
    const minutesToday = mine.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    check(
      "the day counts one sitting, not the whole job",
      minutesToday > 0 && minutesToday < 600,
      `${minutesToday} minutes of the job planned on ${key(firstDay)}`,
    );

    const reading = pace(view.windows, view.tasks, 0);
    check(
      "pace does not ask for ten hours of work today",
      reading.remainingMinutes < 600,
      `${reading.remainingMinutes} minutes still owed today`,
    );

    // ------------------------------------------- the engine leaves it alone
    const before = await prisma.task.findMany({
      where: { parentTaskId: job.id },
      select: {
        id: true,
        scheduledDate: true,
        scheduledStart: true,
        scheduledEnd: true,
      },
      orderBy: { sessionIndex: "asc" },
    });

    await runSchedule({ departmentId });

    const after = await prisma.task.findMany({
      where: { parentTaskId: job.id },
      select: {
        id: true,
        scheduledDate: true,
        scheduledStart: true,
        scheduledEnd: true,
      },
      orderBy: { sessionIndex: "asc" },
    });

    check(
      "re-running the scheduler leaves every sitting where it was",
      JSON.stringify(before.map((s) => [key(s.scheduledDate), s.scheduledStart])) ===
        JSON.stringify(after.map((s) => [key(s.scheduledDate), s.scheduledStart])),
      `${before.length} sittings before, ${after.length} after`,
    );

    const stillOne = await prisma.task.count({
      where: { parentTaskId: job.id },
    });
    check(
      "and does not raise a second set of them",
      stillOne === 4,
      `${stillOne} sittings`,
    );

    // ------------------------------------------------- finishing it early
    const [one, two] = after;
    await prisma.task.updateMany({
      where: { id: { in: [one.id, two.id] } },
      data: { status: "DONE" },
    });
    const finished = await finishSplitJob(two.id);
    check(
      "finishing the job early stands the rest of it down",
      finished.cancelled === 2,
      `${finished.cancelled} sittings cancelled`,
    );

    const closed = await prisma.task.findUniqueOrThrow({
      where: { id: job.id },
      include: { sessions: true },
    });
    check(
      "and closes the job",
      closed.status === "DONE",
      `status ${closed.status}`,
    );
    check(
      "and gives the days back",
      closed.sessions
        .filter((s) => s.status === "CANCELLED")
        .every((s) => s.scheduledDate === null),
      "cancelled sittings hold no slot",
    );

    // --------------------------------------------------- the standing rule
    const stray = await prisma.task.count({
      where: { status: "SPLIT", scheduledDate: { not: null } },
    });
    check(
      "no parent anywhere in the database holds a slot",
      stray === 0,
      `${stray} parents with a scheduled date`,
    );

    // -------------------------------------- claiming a long catalogue entry
    // The partial unique index has to tolerate a sitting sharing its parent's
    // templateId and due date, or an ordinary claim raises P2002.
    const template = await prisma.taskTemplate.create({
      data: {
        name: `${MARK} proyecto`,
        estimatedMinutes: 600,
        departmentId,
      },
    });
    let claimError: string | null = null;
    try {
      const claimed = await prisma.task.create({
        data: {
          title: template.name,
          estimatedMinutes: template.estimatedMinutes,
          dueDate: dayOffset(9),
          departmentId,
          templateId: template.id,
          origin: "CATALOGUE",
          status: "ASSIGNED",
          assigneeId: user.id,
        },
      });
      await ensureSessions(claimed.id);
    } catch (error) {
      claimError = error instanceof Error ? error.message : String(error);
    }
    check(
      "a long catalogue entry can be claimed without a unique violation",
      claimError === null,
      claimError ?? "claimed and split",
    );

    await prisma.task.deleteMany({ where: { templateId: template.id } });
    await prisma.taskTemplate.delete({ where: { id: template.id } });
  } finally {
    // Parents first: the sittings cascade.
    await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } });
    await prisma.taskTemplate.deleteMany({
      where: { name: { startsWith: MARK } },
    });
  }

  console.log(failures === 0 ? "\nall good" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
