import { dateKey, toDateOnly } from "@/lib/time";

/**
 * The interviews a new joiner generates automatically.
 *
 *   Entrevista de Referencias -- the day they start
 *   Entrevista Semanal        -- one week in
 *   Entrevista Bimensual      -- two months in, then every two months
 *
 * The bimonthly one runs until they leave. Somebody on an indefinite contract
 * has no leaving date, so it is generated up to a horizon and topped up on
 * every scheduling run rather than being written out to infinity.
 *
 * Keys are stable, so regenerating never duplicates.
 */

export type OnboardingKind = "REFERENCES" | "WEEKLY" | "BIMONTHLY";

export type OnboardingTask = {
  externalKey: string;
  kind: OnboardingKind;
  title: string;
  dueDate: Date;
  estimatedMinutes: number;
};

export const ONBOARDING_LABELS: Record<OnboardingKind, string> = {
  REFERENCES: "Entrevista de Referencias",
  WEEKLY: "Entrevista Semanal",
  BIMONTHLY: "Entrevista Bimensual",
};

/** Default durations, used when the catalogue has no entry of that name. */
export const ONBOARDING_MINUTES: Record<OnboardingKind, number> = {
  REFERENCES: 10,
  WEEKLY: 30,
  BIMONTHLY: 30,
};

/**
 * Add months, clamping to the end of a short month: 31 January plus one month
 * is 28 February, not 3 March.
 */
export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const shifted = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted;
}

export function addDays(date: Date, days: number): Date {
  const next = toDateOnly(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function planOnboarding(input: {
  userId: string;
  displayName: string;
  startDate: Date;
  /** Null for an indefinite contract. */
  endDate: Date | null;
  /** How far ahead to generate the recurring review when there is no end. */
  horizon: Date;
  minutes?: Partial<Record<OnboardingKind, number>>;
}): OnboardingTask[] {
  const start = toDateOnly(input.startDate);
  const end = input.endDate ? toDateOnly(input.endDate) : null;
  const horizon = toDateOnly(input.horizon);

  // Never generate past the leaving date, nor past the horizon.
  const limit = end && end < horizon ? end : horizon;

  const minutes = { ...ONBOARDING_MINUTES, ...input.minutes };
  const out: OnboardingTask[] = [];

  const add = (kind: OnboardingKind, due: Date) => {
    if (due < start) return;
    if (end && due > end) return;
    out.push({
      externalKey: `onboarding:${input.userId}:${kind}:${dateKey(due)}`,
      kind,
      title: `${ONBOARDING_LABELS[kind]} — ${input.displayName}`,
      dueDate: due,
      estimatedMinutes: minutes[kind]!,
    });
  };

  // As soon as they begin.
  add("REFERENCES", start);

  // One week in.
  add("WEEKLY", addDays(start, 7));

  // Two months in, then every two months, until they leave.
  for (let n = 2; ; n += 2) {
    const due = addMonths(start, n);
    if (due > limit) break;
    add("BIMONTHLY", due);
    // A guard against a runaway loop if the dates are nonsense.
    if (n > 600) break;
  }

  return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}
