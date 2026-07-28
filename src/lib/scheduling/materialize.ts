import { dateKey, eachDay, isoWeekday } from "@/lib/time";

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
  fixedStartMinutes: number | null;
  fixedEndMinutes: number | null;
  active: boolean;
  template: {
    name: string;
    estimatedMinutes: number;
    active: boolean;
    priority?: "MUST" | "NORMAL" | "SPARE_TIME";
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
};

export function buildRecurringKey(
  ruleId: string,
  date: Date,
  instance: number,
): string {
  return `recurring:${ruleId}:${dateKey(date)}:${instance}`;
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

      const count = Math.max(1, rule.instancesPerOccurrence);
      for (let instance = 1; instance <= count; instance++) {
        planned.push({
          externalKey: buildRecurringKey(rule.id, date, instance),
          title:
            count > 1
              ? `${rule.template.name} (${instance} of ${count})`
              : rule.template.name,
          estimatedMinutes: rule.template.estimatedMinutes,
          priority: rule.template.priority ?? "NORMAL",
          dueDate: date,
          departmentId: rule.departmentId,
          templateId: rule.templateId,
          origin: "RECURRING",
          fixedStartMinutes: rule.fixedStartMinutes,
          fixedEndMinutes: rule.fixedEndMinutes,
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
