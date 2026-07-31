import type { Priority } from "@/lib/scheduling/assign";
import { findSlot, type Window } from "@/lib/scheduling/availability";
import { daysBetween } from "@/lib/time";
import type { Gap } from "./gap";

/**
 * Which task to offer for the time you have.
 *
 * Two rules stacked, and the order between them matters:
 *
 *   1. The tier is a hard sort key. Debt before filler -- clear what is owed
 *      today before borrowing from tomorrow, and never offer spare-time work
 *      while real work sits unplaced. A NORMAL in tier 1 beats a MUST in tier
 *      3 on purpose.
 *   2. Inside a tier, a score: how important, how late, how well it fits.
 *
 * The score exists because the Priority enum alone cannot say "late". MUST /
 * NORMAL / SPARE_TIME is the right vocabulary for the nightly engine, which is
 * placing work on the day it is due; it is not enough here, where a NORMAL that
 * was due yesterday genuinely should beat a MUST due next week.
 *
 * Pure, like assign.ts, so the ranking can be tested without a database.
 */

export type FillerSource = "unassigned" | "orphaned" | "pullForward" | "spare";

export type Tier = 1 | 2 | 3 | 4;

export const TIER: Record<FillerSource, Tier> = {
  /** Owed today and nobody has it. */
  unassigned: 1,
  /** Dropped by an absence, waiting in triage. */
  orphaned: 2,
  /** Mine, but not until later this week. */
  pullForward: 3,
  /** Catalogue work that exists for exactly this moment. */
  spare: 4,
};

export type Filler = {
  /** Null for a SPARE_TIME template that has no task row yet. */
  taskId: string | null;
  templateId: string | null;
  title: string;
  estimatedMinutes: number;
  priority: Priority;
  dueDate: Date;
  source: FillerSource;
};

const PRIORITY_WEIGHT: Record<Priority, number> = {
  MUST: 100,
  NORMAL: 50,
  SPARE_TIME: 0,
};

/**
 * How much the calendar is pressing.
 *
 * Overdue outranks everything a priority can say, and gets worse by the day so
 * nothing rots quietly at the bottom of the list. Capped, because past a
 * fortnight late the exact number has stopped being informative.
 */
export function urgencyWeight(dueDate: Date, today: Date): number {
  const days = daysBetween(today, dueDate);
  if (days < 0) return Math.min(200, 120 + 10 * -days);
  if (days === 0) return 80;
  if (days === 1) return 40;
  if (days <= 7) return 20 - 2 * days;
  return 0;
}

/**
 * How well the job uses the gap.
 *
 * Measured against the tightest stretch that can actually hold it, so a job
 * that fills a hole neatly is preferred to one that leaves a useless stub.
 * Never negative: a short task in a long gap is still a fine answer, just a
 * less satisfying one, and penalising it would leave the time empty instead.
 */
export function fitWeight(estimatedMinutes: number, segments: Window[]): number {
  let best = 0;
  for (const w of segments) {
    const length = w.end - w.start;
    if (length < estimatedMinutes) continue;
    best = Math.max(best, estimatedMinutes / length);
  }

  if (best >= 0.8) return 30;
  if (best >= 0.5) return 20;
  if (best >= 0.25) return 10;
  return 0;
}

export function score(filler: Filler, gap: Gap, today: Date): number {
  return (
    PRIORITY_WEIGHT[filler.priority] +
    urgencyWeight(filler.dueDate, today) +
    fitWeight(filler.estimatedMinutes, gap.segments)
  );
}

/** Arbitrary, but stable -- see below. */
function identity(filler: Filler): string {
  return filler.taskId ?? filler.templateId ?? filler.title;
}

/**
 * Everything that fits, best first.
 *
 * The final tie-break is on identity for the same reason compareForTask() has
 * one: re-opening the dialog must offer the same task in the same order, not
 * reshuffle the choice under somebody who was halfway through making it.
 */
/**
 * Trim a ranked list to what the dialog will show, without starving a tier.
 *
 * Rank alone is not enough. Tier is a hard sort key, so a department with a
 * dozen things owed today fills every slot from tier 1 and the orphaned work in
 * triage is never seen -- which is exactly how a queue of stale interviews hid
 * a fortnight of dropped work. Giving every non-empty tier its best entry first
 * guarantees "something else" can always reach the others.
 *
 * The first entry is still the best overall, because tier 1 sorts first, so
 * pressing Start without reading is still the right answer.
 */
export function pickOffers<T extends Filler>(ranked: T[], limit: number): T[] {
  const seen = new Set<Tier>();
  const representatives: T[] = [];
  const rest: T[] = [];

  for (const filler of ranked) {
    const tier = TIER[filler.source];
    if (seen.has(tier)) rest.push(filler);
    else {
      seen.add(tier);
      representatives.push(filler);
    }
  }

  return [...representatives, ...rest].slice(0, limit);
}

export function rankFillers(
  fillers: Filler[],
  gap: Gap,
  today: Date,
): Filler[] {
  return fillers
    .filter(
      (f) =>
        f.estimatedMinutes > 0 &&
        findSlot(gap.segments, f.estimatedMinutes) !== null,
    )
    .map((filler) => ({
      filler,
      tier: TIER[filler.source],
      score: score(filler, gap, today),
    }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        // Same score: take the bigger bite out of the gap.
        b.filler.estimatedMinutes - a.filler.estimatedMinutes ||
        identity(a.filler).localeCompare(identity(b.filler)),
    )
    .map((row) => row.filler);
}
