import { prisma } from "@/lib/db";
import { addDays, toDateOnly } from "@/lib/time";
import {
  ONBOARDING_LABELS,
  ONBOARDING_MINUTES,
  planOnboarding,
  type OnboardingKind,
} from "./onboarding";

/**
 * Keeps everyone's onboarding interviews in existence.
 *
 * Run on every scheduling pass rather than only when somebody is created, so
 * an indefinite contract keeps producing its two-monthly review instead of
 * running out at whatever horizon was in force the day they joined. Keys are
 * stable, so this is safe to call as often as you like.
 */

/** How far ahead to generate for somebody with no leaving date. */
const HORIZON_DAYS = 400;

/** The interviews belong to HR, who conduct them. */
async function hrDepartmentId(fallback: string): Promise<string> {
  const hr = await prisma.department.findFirst({
    where: { name: { startsWith: "HR" } },
  });
  return hr?.id ?? fallback;
}

/** Durations come from the catalogue when an entry of that name exists. */
async function catalogueMinutes(
  departmentId: string,
): Promise<Partial<Record<OnboardingKind, number>>> {
  const names = Object.values(ONBOARDING_LABELS);
  const templates = await prisma.taskTemplate.findMany({
    where: { departmentId, name: { in: names }, active: true },
  });

  const byName = new Map(templates.map((t) => [t.name, t]));
  const out: Partial<Record<OnboardingKind, number>> = {};
  for (const [kind, label] of Object.entries(ONBOARDING_LABELS)) {
    const template = byName.get(label);
    if (template) out[kind as OnboardingKind] = template.estimatedMinutes;
  }
  return out;
}

export type OnboardingSync = { created: number; removed: number };

export async function syncOnboarding(userId?: string): Promise<OnboardingSync> {
  const people = await prisma.user.findMany({
    where: {
      ...(userId ? { id: userId } : {}),
      active: true,
      startDate: { not: null },
    },
    select: {
      id: true,
      displayName: true,
      startDate: true,
      endDate: true,
      departmentId: true,
    },
  });

  if (people.length === 0) return { created: 0, removed: 0 };

  const horizon = addDays(toDateOnly(new Date()), HORIZON_DAYS);
  const departmentId = await hrDepartmentId(people[0].departmentId);
  const minutes = await catalogueMinutes(departmentId);

  const templates = await prisma.taskTemplate.findMany({
    where: {
      departmentId,
      name: { in: Object.values(ONBOARDING_LABELS) },
      active: true,
    },
  });
  const templateByName = new Map(templates.map((t) => [t.name, t.id]));

  let created = 0;
  const wantedKeys = new Set<string>();

  for (const person of people) {
    const planned = planOnboarding({
      userId: person.id,
      displayName: person.displayName,
      startDate: person.startDate!,
      endDate: person.endDate,
      horizon,
      minutes,
    });

    for (const task of planned) wantedKeys.add(task.externalKey);
    if (planned.length === 0) continue;

    const existing = await prisma.task.findMany({
      where: { externalKey: { in: planned.map((p) => p.externalKey) } },
      select: { externalKey: true },
    });
    const have = new Set(existing.map((e) => e.externalKey));

    const toCreate = planned.filter((p) => !have.has(p.externalKey));
    if (toCreate.length === 0) continue;

    await prisma.task.createMany({
      data: toCreate.map((t) => ({
        externalKey: t.externalKey,
        title: t.title,
        estimatedMinutes: t.estimatedMinutes,
        dueDate: t.dueDate,
        departmentId,
        templateId: templateByName.get(ONBOARDING_LABELS[t.kind]) ?? null,
        origin: "RECURRING" as const,
        status: "UNASSIGNED" as const,
        // These have to happen: they are the joiner's induction, and slipping
        // them quietly is exactly what this system exists to prevent.
        priority: "MUST" as const,
      })),
    });
    created += toCreate.length;
  }

  // Somebody's dates changed, so interviews that no longer apply -- moved
  // start date, or an end date brought forward -- are taken back. Only ones
  // nobody has picked up: anything assigned or started stays.
  const orphaned = await prisma.task.findMany({
    where: {
      externalKey: { startsWith: "onboarding:" },
      status: "UNASSIGNED",
      ...(userId ? { externalKey: { startsWith: `onboarding:${userId}:` } } : {}),
    },
    select: { id: true, externalKey: true },
  });
  const staleIds = orphaned
    .filter((t) => t.externalKey && !wantedKeys.has(t.externalKey))
    .map((t) => t.id);

  if (staleIds.length > 0) {
    await prisma.task.deleteMany({ where: { id: { in: staleIds } } });
  }

  return { created, removed: staleIds.length };
}
