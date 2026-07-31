import { dateKey, eachDay, isoWeekday } from "@/lib/time";
import type { DayAnchor } from "./availability";
import type { ShiftHalf } from "./half";

/**
 * Turns recurring rules into concrete, dated task instances.
 *
 * Every generated task carries an externalKey built from the rule, the date
 * and the instance number. That key is unique in the database, so running the
 * materializer twice over the same window produces no duplicates -- which
 * matters because it runs on a schedule and by hand from the admin screen.
 */

export type RuleInput = {
  id: string;
  templateId: string;
  departmentId: string;
  frequency?: "WEEKLY" | "MONTHLY";
  weekdays: number[];
  monthlyNth?: number | null;
  monthlyDay?: number | null;
  instancesPerOccurrence: number;
  /// Points in the shift this fires at. When set, one task per anchor and the
  /// instance count is ignored.
  anchors?: DayAnchor[];
  fixedStartMinutes: number | null;
  fixedEndMinutes: number | null;
  active: boolean;
  template: {
    name: string;
    estimatedMinutes: number;
    active: boolean;
    priority?: "MUST" | "NORMAL" | "SPARE_TIME";
    /// Keep instances in one half of the day. Anchors override it.
    shiftHalf?: ShiftHalf | null;
  };
};

/**
 * Does a monthly rule fire on this date?
 *
 * Two shapes, both taken from the company calendar's RRULEs:
 *   BYDAY=-1MO   -> the last Monday of the month (monthlyNth = -1)
 *   BYMONTHDAY=22 -> the 22nd, whatever weekday that is
 *
 * A month that is too short for the requested day simply does not fire, which
 * is better than silently sliding into the next month.
 */
export function monthlyRuleFires(rule: RuleInput, date: Date): boolean {
  if (rule.monthlyDay != null) {
    return date.getUTCDate() === rule.monthlyDay;
  }

  const weekday = rule.weekdays[0];
  if (weekday == null || isoWeekday(date) !== weekday) return false;
  if (rule.monthlyNth == null) return false;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // Collect every date in the month falling on that weekday.
  const matching: number[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (isoWeekday(new Date(Date.UTC(year, month, day))) === weekday) {
      matching.push(day);
    }
  }

  const index = rule.monthlyNth > 0 ? rule.monthlyNth - 1 : matching.length + rule.monthlyNth;
  return matching[index] === date.getUTCDate();
}

export type PlannedTask = {
  externalKey: string;
  title: string;
  estimatedMinutes: number;
  priority: "MUST" | "NORMAL" | "SPARE_TIME";
  dueDate: Date;
  departmentId: string;
  templateId: string;
  origin: "RECURRING";
  fixedStartMinutes: number | null;
  fixedEndMinutes: number | null;
  /** Set for anchored work; its clock time depends on who ends up with it. */
  anchor: DayAnchor | null;
  /** Morning or afternoon, from the catalogue. Null means anywhere. */
  shiftHalf: ShiftHalf | null;
  /**
   * Anchored repetitions of a rule are one person's routine, so they are
   * assigned together. Null for everything else.
   */
  groupKey: string | null;
};

export function buildRecurringKey(
  ruleId: string,
  date: Date,
  instance: number,
): string {
  return `recurring:${ruleId}:${dateKey(date)}:${instance}`;
}

/**
 * Anchored tasks are keyed on the anchor rather than a position in the list.
 *
 * With instance numbers, adding a midday check renumbers every later one, so
 * the stale sweep in run.ts deletes and recreates tasks that had not changed --
 * losing any that were already assigned. Keying on the anchor makes inserting
 * and reordering no-ops, and moving a check to a different point in the day
 * correctly re-keys only that one.
 */
export function buildAnchoredKey(
  ruleId: string,
  date: Date,
  anchor: DayAnchor,
): string {
  return `recurring:${ruleId}:${dateKey(date)}:a${anchor}`;
}

/**
 * These end up in the task's stored title, so they follow the same rule as
 * ONBOARDING_LABELS: generated names are written in the company's language,
 * not the interface's. An English "on arrival" in an otherwise Spanish day was
 * the giveaway that this was machine-written.
 */
export const ANCHOR_LABEL: Record<DayAnchor, string> = {
  ARRIVAL: "al llegar",
  BEFORE_BREAK: "antes del descanso",
  AFTER_BREAK: "al volver del descanso",
  BEFORE_LEAVING: "antes de salir",
};

/** Keeps order, drops repeats -- two checks at the same anchor would collide. */
function dedupe(anchors: DayAnchor[]): DayAnchor[] {
  return anchors.filter((a, i) => anchors.indexOf(a) === i);
}

/**
 * What *should* exist for this window, according to the rules. Comparing this
 * against what already exists is the caller's job.
 */
export function planRecurringTasks(input: {
  rules: RuleInput[];
  from: Date;
  to: Date;
}): PlannedTask[] {
  const planned: PlannedTask[] = [];

  for (const date of eachDay(input.from, input.to)) {
    const weekday = isoWeekday(date);

    for (const rule of input.rules) {
      if (!rule.active || !rule.template.active) continue;

      const fires =
        rule.frequency === "MONTHLY"
          ? monthlyRuleFires(rule, date)
          : rule.weekdays.includes(weekday);
      if (!fires) continue;

      const common = {
        estimatedMinutes: rule.template.estimatedMinutes,
        priority: rule.template.priority ?? "NORMAL",
        dueDate: date,
        departmentId: rule.departmentId,
        templateId: rule.templateId,
        origin: "RECURRING",
        shiftHalf: rule.template.shiftHalf ?? null,
      } as const;

      // Anchored: one task per point in the shift, all belonging to one
      // person's routine. The times themselves depend on whose shift it is,
      // so they are resolved at assignment rather than here.
      const anchors = dedupe(rule.anchors ?? []);
      if (anchors.length > 0) {
        for (const anchor of anchors) {
          planned.push({
            ...common,
            externalKey: buildAnchoredKey(rule.id, date, anchor),
            // Named rather than numbered: "1 of 4" does not say which one.
            title: `${rule.template.name} · ${ANCHOR_LABEL[anchor]}`,
            fixedStartMinutes: null,
            fixedEndMinutes: null,
            anchor,
            groupKey: `${rule.id}:${dateKey(date)}`,
          });
        }
        continue;
      }

      const count = Math.max(1, rule.instancesPerOccurrence);
      for (let instance = 1; instance <= count; instance++) {
        planned.push({
          ...common,
          externalKey: buildRecurringKey(rule.id, date, instance),
          title:
            count > 1
              ? `${rule.template.name} (${instance} of ${count})`
              : rule.template.name,
          fixedStartMinutes: rule.fixedStartMinutes,
          fixedEndMinutes: rule.fixedEndMinutes,
          anchor: null,
          groupKey: null,
        });
      }
    }
  }

  return planned;
}

/**
 * Split a plan against what the database already holds. Anything already
 * present is left completely alone -- it may already be assigned, started or
 * finished, and regenerating it would destroy that.
 */
export function diffAgainstExisting(
  planned: PlannedTask[],
  existingKeys: Set<string>,
): { toCreate: PlannedTask[]; alreadyPresent: number } {
  const toCreate = planned.filter((task) => !existingKeys.has(task.externalKey));
  return { toCreate, alreadyPresent: planned.length - toCreate.length };
}

/** How work already on the calendar is counted against what a rule wants. */
export function coverageKey(templateId: string, date: Date): string {
  return `${templateId}:${dateKey(date)}`;
}

/**
 * Take off what somebody has already put on the calendar themselves.
 *
 * A rule says how many times a day something happens; it does not say those
 * have to come from the rule. Planning your week on the board is a claim on
 * exactly that work, and the rule has no way to see it -- a claim carries no
 * externalKey, so diffAgainstExisting looks straight past it. That is how a
 * board tick on Thursday and the rule's own Thursday instance ended up as two
 * Sucesos on one morning.
 *
 * So the rule tops up rather than adds: it wants four CRM checks, you have
 * already claimed one, it raises three. Claim nothing and you get all four,
 * which is what keeps must-do work arriving whether or not anybody planned it.
 *
 * Repetitions are given up from the end of the day backwards, so what survives
 * is the early part of the routine. "Al llegar" is a real instruction people
 * notice missing; the fourth check of the afternoon is the one that can be the
 * thing you already picked up.
 */
export function dropAlreadyCovered(
  planned: PlannedTask[],
  covered: Map<string, number>,
): { toPlan: PlannedTask[]; covered: number } {
  if (covered.size === 0) return { toPlan: planned, covered: 0 };

  const left = new Map(covered);
  const dropped = new Set<PlannedTask>();

  // Walk backwards so the repetitions given up are the latest ones. Anchored
  // instances are pushed in ANCHOR order, so this gives up "antes de salir"
  // before "al llegar".
  for (let i = planned.length - 1; i >= 0; i -= 1) {
    const task = planned[i];
    const key = coverageKey(task.templateId, task.dueDate);
    const remaining = left.get(key) ?? 0;
    if (remaining <= 0) continue;
    left.set(key, remaining - 1);
    dropped.add(task);
  }

  return {
    toPlan: planned.filter((t) => !dropped.has(t)),
    covered: dropped.size,
  };
}
