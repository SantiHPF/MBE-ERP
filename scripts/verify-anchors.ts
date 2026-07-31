/**
 * End-to-end check for shift-anchored repetitions, against a dev database.
 *
 * Creates a catalogue task done four times a shift, runs the real scheduler,
 * and asserts one person got all four at their own shift's times -- then moves
 * that person's hours and re-runs to prove the times follow them.
 *
 * Run with: npx tsx scripts/verify-anchors.ts   (cleans up after itself)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { runSchedule } from "../src/lib/scheduling/run";
import { formatClock, addDays, today } from "../src/lib/time";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const NAME = "__anchor check__";
let failures = 0;

function check(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "  ok  " : " FAIL "} ${name} — ${detail}`);
  if (!passed) failures += 1;
}

async function cleanup() {
  const tpl = await prisma.taskTemplate.findFirst({ where: { name: NAME } });
  if (!tpl) return;
  await prisma.task.deleteMany({ where: { templateId: tpl.id } });
  await prisma.rotationLedger.deleteMany({ where: { templateId: tpl.id } });
  await prisma.recurringRule.deleteMany({ where: { templateId: tpl.id } });
  await prisma.taskTemplate.delete({ where: { id: tpl.id } });
}

async function main() {
  await cleanup();

  const department = await prisma.department.findFirstOrThrow();
  const from = today();
  const to = addDays(from, 6);

  const template = await prisma.taskTemplate.create({
    data: {
      name: NAME,
      estimatedMinutes: 10,
      departmentId: department.id,
      priority: "NORMAL",
    },
  });

  await prisma.recurringRule.create({
    data: {
      templateId: template.id,
      departmentId: department.id,
      frequency: "WEEKLY",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      anchors: ["ARRIVAL", "BEFORE_BREAK", "AFTER_BREAK", "BEFORE_LEAVING"],
      instancesPerOccurrence: 1,
      sourceNote: "verify-anchors",
    },
  });

  await runSchedule({ from, to, departmentId: department.id });

  const made = await prisma.task.findMany({
    where: { templateId: template.id, dueDate: { gte: from, lte: to } },
    include: { assignee: { select: { displayName: true } } },
    orderBy: [{ dueDate: "asc" }, { scheduledStart: "asc" }],
  });

  check(
    "one task per anchor per day",
    made.length > 0 && made.length % 4 === 0,
    `${made.length} tasks over 7 days (want a multiple of 4)`,
  );

  check(
    "every task carries its anchor",
    made.every((t) => t.anchor !== null),
    `${made.filter((t) => t.anchor).length}/${made.length} anchored`,
  );

  // Group by day and confirm each day's four belong to one person.
  const byDay = new Map<string, typeof made>();
  for (const t of made) {
    const key = t.dueDate.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }

  const split = [...byDay.entries()].filter(
    ([, list]) => new Set(list.map((t) => t.assigneeId)).size > 1,
  );
  check(
    "a day's repetitions all go to one person",
    split.length === 0,
    split.length === 0
      ? `${byDay.size} days, each held by a single person`
      : `${split.length} day(s) split across people`,
  );

  const sample = [...byDay.entries()].find(([, l]) => l[0].assigneeId);
  if (sample) {
    const [day, list] = sample;
    const who = list[0].assignee?.displayName ?? "?";
    const times = list
      .map((t) => `${t.anchor}=${t.scheduledStart != null ? formatClock(t.scheduledStart) : "—"}`)
      .join("  ");
    console.log(`\n     ${day}: ${who}\n     ${times}`);

    const pattern = await prisma.workingPattern.findFirst({
      where: {
        userId: list[0].assigneeId!,
        weekday: ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
      },
    });
    const arrival = list.find((t) => t.anchor === "ARRIVAL");

    /**
     * An anchor means "at that point, or as soon after as there is room" --
     * work already done or in flight that morning still holds its slot. So the
     * test is that arrival is never *before* the shift starts and is the first
     * of the four, not that it sits exactly on the start minute.
     */
    const starts = list
      .map((t) => t.scheduledStart)
      .filter((s): s is number => s != null);

    check(
      "arrival is at or after the start of that person's shift",
      !!pattern &&
        arrival?.scheduledStart != null &&
        arrival.scheduledStart >= pattern.startMinutes,
      `arrival at ${arrival?.scheduledStart != null ? formatClock(arrival.scheduledStart) : "—"}, shift starts ${pattern ? formatClock(pattern.startMinutes) : "?"}` +
        (pattern && arrival?.scheduledStart !== pattern.startMinutes
          ? " (pushed by work already on the day)"
          : ""),
    );

    check(
      "the ones that fit run in order through the day",
      starts.every((s, i) => i === 0 || s >= starts[i - 1]),
      starts.map((s) => formatClock(s)).join(" → ") || "(none placed)",
    );

    /**
     * The property that actually matters, and the one this used to get wrong.
     *
     * It asserted all four were placed, which passed while "antes del descanso"
     * sat at 18:00 -- after the break it is named for. On a day already full of
     * real work some anchors genuinely cannot be honoured, and going unplaced
     * is the honest answer; what must never happen is one being placed in the
     * wrong half of the day.
     */
    const divide = pattern?.breakStartMinutes ?? null;
    const misplaced = divide
      ? list.filter((t) => {
          if (t.scheduledStart == null) return false;
          const wantsMorning =
            t.anchor === "ARRIVAL" || t.anchor === "BEFORE_BREAK";
          return wantsMorning
            ? t.scheduledStart >= divide
            : t.scheduledStart < divide;
        })
      : [];

    check(
      "none is placed in the wrong half of the day",
      misplaced.length === 0,
      misplaced.length === 0
        ? `${starts.length} placed, each in its own half`
        : misplaced
            .map((t) => `${t.anchor}@${formatClock(t.scheduledStart!)}`)
            .join(" "),
    );

    // Move their start an hour later; the anchored work should follow.
    if (pattern) {
      await prisma.workingPattern.update({
        where: { id: pattern.id },
        data: { startMinutes: pattern.startMinutes + 60 },
      });
      await prisma.task.deleteMany({ where: { templateId: template.id } });
      await runSchedule({ from, to, departmentId: department.id });

      const again = await prisma.task.findFirst({
        where: {
          templateId: template.id,
          anchor: "ARRIVAL",
          assigneeId: list[0].assigneeId,
          dueDate: new Date(`${day}T00:00:00Z`),
        },
      });

      /**
       * Arrival follows the shift, but "as soon after as there is room" --
       * the same rule the check above states and this one used to contradict
       * by demanding the exact minute. On a day already full it lands later;
       * what it must never do is start before the person does.
       *
       * When the old placement *was* exactly on the old start, the day plainly
       * had room, and then the new one has to be exactly on the new start.
       */
      const newStart = pattern.startMinutes + 60;
      const wasOnTheDot = arrival?.scheduledStart === pattern.startMinutes;
      const now = again?.scheduledStart ?? null;

      check(
        "the times follow a change of hours",
        now != null && now >= newStart && (!wasOnTheDot || now === newStart),
        `arrival now ${now != null ? formatClock(now) : "—"}, shift now starts ${formatClock(newStart)}` +
          (wasOnTheDot ? " (had room, so must be exact)" : " (day already busy)"),
      );

      await prisma.workingPattern.update({
        where: { id: pattern.id },
        data: { startMinutes: pattern.startMinutes },
      });
    }
  }

  await cleanup();
  console.log(failures === 0 ? "\nanchors behave as intended" : `\n${failures} failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
