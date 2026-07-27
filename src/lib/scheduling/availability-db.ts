import "server-only";
import { prisma } from "@/lib/db";
import { toDateOnly } from "@/lib/time";
import { computeAvailability, type Availability } from "./availability";

/**
 * Database-facing wrapper around computeAvailability. The pure function stays
 * testable; this loads what it needs.
 *
 * Callers scheduling a whole week should prefer getAvailabilityForRange, which
 * fetches once instead of once per person per day.
 */
export async function getAvailability(
  userId: string,
  date: Date,
): Promise<Availability> {
  const day = toDateOnly(date);

  const [patterns, overrides, absences] = await Promise.all([
    prisma.workingPattern.findMany({ where: { userId } }),
    prisma.dayOverride.findMany({ where: { userId, date: day } }),
    prisma.absence.findMany({
      where: { userId, startDate: { lte: day }, endDate: { gte: day } },
    }),
  ]);

  return computeAvailability({ date: day, patterns, overrides, absences });
}

export type AvailabilityByUserDate = Map<string, Map<string, Availability>>;

/**
 * Availability for many people across a date range, in three queries rather
 * than three per person per day. The assignment engine runs on this.
 */
export async function getAvailabilityForRange(
  userIds: string[],
  dates: Date[],
): Promise<AvailabilityByUserDate> {
  if (userIds.length === 0 || dates.length === 0) return new Map();

  const days = dates.map(toDateOnly);
  const first = days[0];
  const last = days[days.length - 1];

  const [patterns, overrides, absences] = await Promise.all([
    prisma.workingPattern.findMany({ where: { userId: { in: userIds } } }),
    prisma.dayOverride.findMany({
      where: { userId: { in: userIds }, date: { gte: first, lte: last } },
    }),
    prisma.absence.findMany({
      where: {
        userId: { in: userIds },
        startDate: { lte: last },
        endDate: { gte: first },
      },
    }),
  ]);

  const groupBy = <T extends { userId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.userId);
      if (list) list.push(row);
      else map.set(row.userId, [row]);
    }
    return map;
  };

  const patternsBy = groupBy(patterns);
  const overridesBy = groupBy(overrides);
  const absencesBy = groupBy(absences);

  const result: AvailabilityByUserDate = new Map();

  for (const userId of userIds) {
    const perDate = new Map<string, Availability>();
    for (const date of days) {
      perDate.set(
        date.toISOString().slice(0, 10),
        computeAvailability({
          date,
          patterns: patternsBy.get(userId) ?? [],
          overrides: overridesBy.get(userId) ?? [],
          absences: absencesBy.get(userId) ?? [],
        }),
      );
    }
    result.set(userId, perDate);
  }

  return result;
}
