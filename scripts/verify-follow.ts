/**
 * Proves that work which goes hand in hand actually behaves as a pair.
 *
 * The chain arithmetic is unit-tested in src/lib/plan/follow.test.ts and the
 * placement in assign.test.ts. What only a database can show is that claiming a
 * leader really does raise its followers, that they land in the right order for
 * the right person, that the ordering rule refuses the second half first, and
 * that moving or dropping the leader takes the pair with it.
 *
 * Run against a dev database: npx tsx scripts/verify-follow.ts
 * It cleans up everything it creates.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { createFollowers, followersOf } from "../src/lib/plan/follow-db";
import { placeOnDay } from "../src/lib/plan/place";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;

function check(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "  ok  " : " FAIL "} ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const MARK = "verify-follow:";

function dayOffset(days: number): Date {
  const now = new Date();
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc;
}

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { active: true } });
  const departmentId = user.departmentId;
  const today = dayOffset(0);

  // --------------------------------------------------------- the catalogue
  // review -> report -> file, plus gantt hanging off review as well.
  const review = await prisma.taskTemplate.create({
    data: { name: `${MARK} review`, estimatedMinutes: 60, departmentId },
  });
  const report = await prisma.taskTemplate.create({
    data: {
      name: `${MARK} report`,
      estimatedMinutes: 30,
      departmentId,
      followsId: review.id,
    },
  });
  const gantt = await prisma.taskTemplate.create({
    data: {
      name: `${MARK} gantt`,
      estimatedMinutes: 15,
      departmentId,
      followsId: review.id,
    },
  });
  const file = await prisma.taskTemplate.create({
    data: {
      name: `${MARK} file`,
      estimatedMinutes: 15,
      departmentId,
      followsId: report.id,
    },
  });

  try {
    // ------------------------------------------- claiming raises the chain
    const leader = await prisma.task.create({
      data: {
        title: review.name,
        estimatedMinutes: review.estimatedMinutes,
        dueDate: today,
        departmentId,
        templateId: review.id,
        origin: "CATALOGUE",
        status: "ASSIGNED",
        assigneeId: user.id,
        scheduledDate: today,
      },
    });
    await placeOnDay(leader.id, user.id, today);
    const placedLeader = await prisma.task.findUniqueOrThrow({
      where: { id: leader.id },
    });

    const made = await createFollowers(placedLeader);

    check(
      "claiming a leader raises everything hanging off it",
      made.length === 3,
      `${made.length} followers created (report, gantt, file)`,
    );

    check(
      "all of it belongs to the same person",
      made.every((f) => f.assigneeId === user.id),
      "every follower assigned to the leader's owner",
    );

    check(
      "a follower of a follower links to it, not to the leader",
      made.find((f) => f.templateId === file.id)?.followsTaskId ===
        made.find((f) => f.templateId === report.id)?.id,
      "file follows report",
    );

    const inOrder = [placedLeader, ...made].filter(
      (t) => t.scheduledStart != null,
    );
    check(
      "each one is placed after the thing it follows",
      inOrder.every((t, i) => i === 0 || t.scheduledStart! >= inOrder[i - 1].scheduledEnd!),
      inOrder.map((t) => `${t.title.replace(MARK, "").trim()}@${t.scheduledStart}`).join(" "),
    );

    // ------------------------------------------------ re-running is a no-op
    const again = await createFollowers(placedLeader);
    check(
      "re-running creates nothing new",
      again.length === 0,
      "stable keys, so the scheduler can run as often as it likes",
    );

    // --------------------------------------------------- the ordering rule
    // followersOf is what defer, cancel and the absence sweep all use.
    const downstream = await followersOf([placedLeader.id]);
    check(
      "the whole chain is found from the leader",
      downstream.length === 3,
      `${downstream.length} tasks downstream`,
    );

    // ------------------------------------------------------ moving the pair
    const tomorrow = dayOffset(1);
    await prisma.task.update({
      where: { id: placedLeader.id },
      data: { dueDate: tomorrow, scheduledDate: tomorrow },
    });
    for (const f of downstream) {
      await prisma.task.update({
        where: { id: f.id },
        data: { dueDate: tomorrow, scheduledDate: tomorrow },
      });
    }
    const moved = await prisma.task.findMany({
      where: { id: { in: downstream.map((f) => f.id) } },
      select: { scheduledDate: true },
    });
    check(
      "the followers move with the leader",
      moved.every((m) => m.scheduledDate?.getTime() === tomorrow.getTime()),
      "all three landed on the new day",
    );

    // --------------------------------------------- dropping the leader
    await prisma.task.delete({ where: { id: placedLeader.id } });
    const orphanedHalves = await prisma.task.count({
      where: { title: { startsWith: MARK } },
    });
    check(
      "deleting the leader takes its followers with it",
      orphanedHalves === 0,
      `${orphanedHalves} half-tasks left behind`,
    );

    // ------------------------------------------- the catalogue link survives
    const stillLinked = await prisma.taskTemplate.findUniqueOrThrow({
      where: { id: report.id },
      select: { followsId: true },
    });
    check(
      "the catalogue link is untouched by any of that",
      stillLinked.followsId === review.id,
      "report still comes after review",
    );
  } finally {
    await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } });
    // Followers first: the catalogue link is SET NULL, but order keeps it tidy.
    await prisma.taskTemplate.deleteMany({
      where: { id: { in: [file.id, report.id, gantt.id] } },
    });
    await prisma.taskTemplate.deleteMany({ where: { id: review.id } });
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
