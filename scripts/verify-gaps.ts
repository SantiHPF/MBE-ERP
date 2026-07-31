/**
 * Proves the gap-filler ranks the four pools the way it claims to, and that
 * two people cannot both take the same offer.
 *
 * The pure rules are covered by src/lib/gaps/*.test.ts. What only a database
 * can show is that the queries in offer-db.ts actually find each pool, and
 * that the conditional updates in actions.ts are real guards rather than
 * decoration.
 *
 * Run against a dev database: npx tsx scripts/verify-gaps.ts
 * It cleans up everything it creates.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { fillerOffers } from "../src/lib/gaps/offer-db";
import type { Gap } from "../src/lib/gaps/gap";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;

function check(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "  ok  " : " FAIL "} ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const MARK = "verify-gaps:";

/** One unbroken hour, 10:00-11:00. */
const HOUR: Gap = {
  start: 600,
  end: 660,
  minutes: 60,
  segments: [{ start: 600, end: 660 }],
};

function dayOffset(days: number): Date {
  const d = new Date();
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc;
}

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { active: true } });
  const departmentId = user.departmentId;
  const today = dayOffset(0);

  // ------------------------------------------------------------- the fixtures
  const template = await prisma.taskTemplate.create({
    data: {
      name: `${MARK} spare filler`,
      estimatedMinutes: 30,
      priority: "SPARE_TIME",
      departmentId,
    },
  });

  const made = await Promise.all([
    // tier 1: nobody has it and it was due yesterday
    prisma.task.create({
      data: {
        title: `${MARK} overdue unassigned`,
        estimatedMinutes: 30,
        dueDate: dayOffset(-1),
        departmentId,
        origin: "MANUAL",
        status: "UNASSIGNED",
        priority: "NORMAL",
      },
    }),
    // tier 2: dropped by an absence
    prisma.task.create({
      data: {
        title: `${MARK} orphan`,
        estimatedMinutes: 30,
        dueDate: today,
        departmentId,
        origin: "MANUAL",
        status: "ORPHANED",
        priority: "MUST",
        orphanedAt: new Date(),
        orphanReason: "verify",
      },
    }),
    // tier 3: mine, but not until later in the week -- and a MUST, which the
    // tiers must still keep behind the NORMAL owed today
    prisma.task.create({
      data: {
        title: `${MARK} next week`,
        estimatedMinutes: 30,
        dueDate: dayOffset(3),
        departmentId,
        origin: "MANUAL",
        status: "ASSIGNED",
        priority: "MUST",
        assigneeId: user.id,
        scheduledDate: dayOffset(3),
      },
    }),
    // Small enough for the tight gap below, so that check discriminates rather
    // than passing on an empty list.
    prisma.task.create({
      data: {
        title: `${MARK} short one`,
        estimatedMinutes: 15,
        dueDate: today,
        departmentId,
        origin: "MANUAL",
        status: "UNASSIGNED",
        priority: "NORMAL",
      },
    }),
    // Owed to a point in the day: never offered, however much time is free.
    prisma.task.create({
      data: {
        title: `${MARK} anchored orphan`,
        estimatedMinutes: 30,
        dueDate: today,
        departmentId,
        origin: "RECURRING",
        status: "ORPHANED",
        priority: "MUST",
        anchor: "ARRIVAL",
        orphanedAt: new Date(),
        orphanReason: "verify",
      },
    }),
    // A cadence occurrence long past -- the "Entrevista Bimensual de 2023" case.
    prisma.task.create({
      data: {
        title: `${MARK} stale cadence`,
        estimatedMinutes: 30,
        dueDate: dayOffset(-400),
        departmentId,
        origin: "RECURRING",
        status: "UNASSIGNED",
        priority: "MUST",
      },
    }),
    // The same rhythm, but today's occurrence: this one is fine to offer.
    prisma.task.create({
      data: {
        title: `${MARK} cadence today`,
        estimatedMinutes: 30,
        dueDate: today,
        departmentId,
        origin: "RECURRING",
        status: "UNASSIGNED",
        priority: "NORMAL",
      },
    }),
    // A cadence occurrence in the future: never dragged forward...
    prisma.task.create({
      data: {
        title: `${MARK} cadence ahead`,
        estimatedMinutes: 30,
        dueDate: dayOffset(2),
        departmentId,
        origin: "RECURRING",
        status: "ASSIGNED",
        priority: "MUST",
        assigneeId: user.id,
        scheduledDate: dayOffset(2),
      },
    }),
    // ...unless an absence dropped it, when rescuing it is the point.
    prisma.task.create({
      data: {
        title: `${MARK} orphaned tomorrow`,
        estimatedMinutes: 30,
        dueDate: dayOffset(1),
        departmentId,
        origin: "RECURRING",
        status: "ORPHANED",
        priority: "NORMAL",
        orphanedAt: new Date(),
        orphanReason: "verify",
      },
    }),
  ]);

  const [overdue, orphan, nextWeek, short] = made;

  try {
    // ------------------------------------------------------------- the order
    const offers = await fillerOffers(user.id, departmentId, HOUR, today, [], 10);
    const mine = offers.filter((o) => o.title.startsWith(MARK));
    const order = mine.map((o) => o.source);

    check(
      "all four pools are found",
      new Set(order).size === 4,
      `found ${JSON.stringify(order)}`,
    );

    /**
     * The leading block is one representative per tier, in tier order; after
     * that pickOffers() fills the remaining slots by pure rank, so repeats are
     * expected and say nothing about ordering.
     */
    const seen = new Set<string>();
    const leading: string[] = [];
    for (const source of order) {
      if (seen.has(source)) break;
      seen.add(source);
      leading.push(source);
    }
    check(
      "debt comes before filler",
      leading.join(",") === "unassigned,orphaned,pullForward,spare",
      `tiers led with ${leading.join(",") || "(empty)"}`,
    );

    check(
      "a NORMAL owed today outranks a MUST due later in the week",
      mine[0]?.taskId === overdue.id,
      `top offer was ${mine[0]?.title ?? "(none)"}`,
    );

    // ------------------------------------------- work owed to a time or a rhythm
    const titles = mine.map((o) => o.title);
    const has = (suffix: string) => titles.includes(`${MARK} ${suffix}`);

    check(
      "anchored work is never offered, even from triage",
      !has("anchored orphan"),
      "the ARRIVAL orphan stayed out",
    );
    check(
      "a cadence occurrence long past is not caught up",
      !has("stale cadence"),
      "the 400-day-old recurring task stayed out",
    );
    check(
      "the same rhythm's occurrence due today is offered",
      has("cadence today"),
      "today's recurring task was offered",
    );
    check(
      "a cadence occurrence is never dragged forward",
      !has("cadence ahead"),
      "the recurring task due in two days stayed out",
    );
    check(
      "but an orphaned one is rescued, which is the point of triage",
      has("orphaned tomorrow"),
      "tomorrow's orphan was offered",
    );

    // ---------------------------------------------- no tier starves the others
    check(
      "every tier that has something gets a slot",
      new Set(offers.map((o) => o.source)).size >= 3,
      `sources offered: ${[...new Set(offers.map((o) => o.source))].join(",")}`,
    );

    // ---------------------------------------------------- nothing that is too big
    const tight: Gap = {
      start: 600,
      end: 620,
      minutes: 20,
      segments: [{ start: 600, end: 620 }],
    };
    const tightOffers = await fillerOffers(
      user.id,
      departmentId,
      tight,
      today,
      [],
      10,
    );
    const tightMine = tightOffers.filter((o) => o.title.startsWith(MARK));
    check(
      "a 20m gap gets the 15m job and none of the 30m ones",
      tightMine.length === 1 && tightMine[0].taskId === short.id,
      `offered ${tightMine.map((o) => o.title).join(", ") || "(nothing)"}`,
    );
    check(
      "nothing longer than the gap is offered",
      tightOffers.every((o) => o.estimatedMinutes <= 20),
      `${tightOffers.length} offers, all within 20m`,
    );

    // ----------------------------------------------------- skipping is honoured
    const afterSkip = await fillerOffers(
      user.id,
      departmentId,
      HOUR,
      today,
      [overdue.id],
      10,
    );
    check(
      "a skipped offer does not come back",
      !afterSkip.some((o) => o.taskId === overdue.id),
      "skipped task absent from the next round",
    );

    // ------------------------------------------------- two people, one unassigned task
    // The guard takeFiller() uses for tier 1, raced directly.
    const grabs = await Promise.all([
      prisma.task.updateMany({
        where: { id: overdue.id, assigneeId: null },
        data: { assigneeId: user.id, status: "ASSIGNED" },
      }),
      prisma.task.updateMany({
        where: { id: overdue.id, assigneeId: null },
        data: { assigneeId: user.id, status: "ASSIGNED" },
      }),
    ]);
    check(
      "only one person can take an unassigned task",
      grabs.filter((g) => g.count === 1).length === 1,
      `${grabs.filter((g) => g.count === 1).length} of 2 updates won`,
    );

    // ------------------------------------------------------ two people, one orphan
    const claims = await Promise.all([
      prisma.task.updateMany({
        where: { id: orphan.id, status: "ORPHANED" },
        data: { assigneeId: user.id, status: "ASSIGNED", orphanedAt: null },
      }),
      prisma.task.updateMany({
        where: { id: orphan.id, status: "ORPHANED" },
        data: { assigneeId: user.id, status: "ASSIGNED", orphanedAt: null },
      }),
    ]);
    check(
      "only one person can take an orphan out of triage",
      claims.filter((c) => c.count === 1).length === 1,
      `${claims.filter((c) => c.count === 1).length} of 2 updates won`,
    );

    // --------------------------------------- spare-time work is claimed once a day
    const twice = await Promise.allSettled([
      prisma.task.create({
        data: {
          title: template.name,
          estimatedMinutes: template.estimatedMinutes,
          dueDate: today,
          departmentId,
          templateId: template.id,
          origin: "CATALOGUE",
          status: "ASSIGNED",
          assigneeId: user.id,
        },
      }),
      prisma.task.create({
        data: {
          title: template.name,
          estimatedMinutes: template.estimatedMinutes,
          dueDate: today,
          departmentId,
          templateId: template.id,
          origin: "CATALOGUE",
          status: "ASSIGNED",
          assigneeId: user.id,
        },
      }),
    ]);
    check(
      "the catalogue claim index stops a duplicate spare-time task",
      twice.filter((r) => r.status === "fulfilled").length === 1,
      `${twice.filter((r) => r.status === "fulfilled").length} of 2 creates won`,
    );

    // Once claimed, it stops being offered.
    const afterClaim = await fillerOffers(
      user.id,
      departmentId,
      HOUR,
      today,
      [],
      10,
    );
    check(
      "spare-time work already taken today is not offered again",
      !afterClaim.some((o) => o.templateId === template.id && o.taskId === null),
      "template no longer in the spare pool",
    );

    void nextWeek;
  } finally {
    await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } });
    await prisma.taskTemplate.deleteMany({ where: { id: template.id } });
  }

  console.log(
    failures === 0 ? "\nall good" : `\n${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
