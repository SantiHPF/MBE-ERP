import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeAvailability } from "../src/lib/scheduling/availability";
import { formatClock, formatDuration, toDateOnly, addDays, weekdayName } from "../src/lib/time";

/**
 * Prints everyone's real capacity for a week, with breaks and absences
 * applied. Useful for sanity-checking a roster before wondering why the
 * assignment engine did something.
 *
 *   npx tsx scripts/show-availability.ts [YYYY-MM-DD]
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const arg = process.argv[2];
  const start = toDateOnly(arg ? new Date(arg) : new Date());
  // Rewind to the Monday of that week.
  const monday = addDays(start, -((start.getUTCDay() + 6) % 7));

  const users = await prisma.user.findMany({
    where: { active: true },
    include: { workingPatterns: true, department: true },
    orderBy: [{ department: { name: "asc" } }, { username: "asc" }],
  });

  // Show Monday to Friday always, plus any weekend day somebody works --
  // Saturday shifts are normal here and must not be silently dropped.
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
  const worked = new Set(
    users.flatMap((u) => u.workingPatterns.map((p) => p.weekday)),
  );
  const days = allDays.filter((_, i) => i + 1 <= 5 || worked.has(i + 1));

  const absences = await prisma.absence.findMany({
    where: {
      startDate: { lte: allDays[6] },
      endDate: { gte: allDays[0] },
    },
  });
  const overrides = await prisma.dayOverride.findMany({
    where: { date: { gte: allDays[0], lte: allDays[6] } },
  });

  // Widen the name column to fit the longest name rather than truncating.
  const nameWidth = Math.max(
    16,
    ...users.map((u) => u.displayName.length + 2),
  );

  console.log(`\nWeek of ${monday.toISOString().slice(0, 10)}\n`);

  let currentDept = "";
  for (const user of users) {
    if (user.department.name !== currentDept) {
      currentDept = user.department.name;
      console.log(`— ${currentDept} —`);
    }

    let weekTotal = 0;
    const cells = days.map((date) => {
      const availability = computeAvailability({
        date,
        patterns: user.workingPatterns,
        overrides: overrides.filter((o) => o.userId === user.id),
        absences: absences.filter((a) => a.userId === user.id),
      });
      weekTotal += availability.availableMinutes;

      if (!availability.rostered) return "     off";
      if (availability.availableMinutes === 0) return "   absent";
      return formatDuration(availability.availableMinutes).padStart(8);
    });

    console.log(
      `  ${user.displayName.padEnd(nameWidth)}${cells.join("")}   = ${formatDuration(weekTotal)}`,
    );
  }

  console.log(
    `\n  ${"".padEnd(nameWidth)}${days
      .map((d) =>
        weekdayName(((d.getUTCDay() + 6) % 7) + 1)
          .slice(0, 3)
          .padStart(8),
      )
      .join("")}\n`,
  );

  // Show one person's windows in full, so breaks are visible.
  const sample = users[0];
  if (sample) {
    const availability = computeAvailability({
      date: days[0],
      patterns: sample.workingPatterns,
    });
    console.log(
      `  ${sample.displayName} on Monday: ` +
        availability.windows
          .map((w) => `${formatClock(w.start)}–${formatClock(w.end)}`)
          .join(", "),
    );
  }
  console.log();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
