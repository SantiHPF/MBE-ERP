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
  weekdays: number[];
  instancesPerOccurrence: number;
  fixedStartMinutes: number | null;
  fixedEndMinutes: number | null;
  active: boolean;
  template: {
    name: string;
    estimatedMinutes: number;
    active: boolean;
  };
};

export type PlannedTask = {
  externalKey: string;
  title: string;
  estimatedMinutes: number;
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
      if (!rule.weekdays.includes(weekday)) continue;

      const count = Math.max(1, rule.instancesPerOccurrence);
      for (let instance = 1; instance <= count; instance++) {
        planned.push({
          externalKey: buildRecurringKey(rule.id, date, instance),
          title:
            count > 1
              ? `${rule.template.name} (${instance} of ${count})`
              : rule.template.name,
          estimatedMinutes: rule.template.estimatedMinutes,
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
