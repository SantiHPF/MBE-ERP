import { prisma } from "@/lib/db";
import { dateKey, today as todayInZone } from "@/lib/time";
import { candidatesDue, sourcesDue } from "./due";

/**
 * Turns "these people are owed a call" into work on somebody's day.
 *
 * One task per CRM per day, holding the whole list -- not one task per person.
 * Fifteen separate "Call Marta" rows would bury the rest of the day, and the
 * ERP already models several goes at the same thing as one block: quantity,
 * unitMinutes, and doneCount counted off while the timer runs.
 *
 * Called from runSchedule() beside syncOnboarding(), and safe to run as often
 * as you like -- the keys are stable, so nothing is ever duplicated.
 */

export const CALL_TASK_NAMES = {
  SOURCE: "Llamadas a universidades",
  CANDIDATE: "Llamadas a candidatos",
} as const;

/** Per call, when the catalogue has no entry of that name to inherit from. */
const DEFAULT_UNIT_MINUTES = { SOURCE: 15, CANDIDATE: 5 } as const;

type Kind = keyof typeof CALL_TASK_NAMES;

export type CrmSyncSummary = {
  created: number;
  updated: number;
  removed: number;
};

function callKey(kind: Kind, departmentId: string, day: Date): string {
  const slug = kind === "SOURCE" ? "source-calls" : "candidate-calls";
  return `crm:${slug}:${departmentId}:${dateKey(day)}`;
}

/**
 * Keep one batched call task in step with how many calls are actually owed.
 *
 * Started work is never touched: there is tracked time against it, and the
 * person is part way through the list.
 */
async function reconcile(
  kind: Kind,
  departmentId: string,
  day: Date,
  count: number,
  summary: CrmSyncSummary,
): Promise<void> {
  const externalKey = callKey(kind, departmentId, day);
  const existing = await prisma.task.findUnique({ where: { externalKey } });

  const started = existing
    ? ["IN_PROGRESS", "PAUSED", "DONE"].includes(existing.status)
    : false;
  if (started) return;

  // Nothing owed any more -- somebody logged the last call, or the candidates
  // went inactive. Take the task back rather than leaving a phantom block.
  if (count === 0) {
    if (existing) {
      await prisma.task.delete({ where: { id: existing.id } });
      summary.removed += 1;
    }
    return;
  }

  const template = await prisma.taskTemplate.findFirst({
    where: { departmentId, name: CALL_TASK_NAMES[kind], active: true },
  });
  const unit = template?.estimatedMinutes ?? DEFAULT_UNIT_MINUTES[kind];
  const estimatedMinutes = Math.max(1, unit * count);

  if (!existing) {
    await prisma.task.create({
      data: {
        externalKey,
        title: CALL_TASK_NAMES[kind],
        estimatedMinutes,
        unitMinutes: unit,
        quantity: count,
        dueDate: day,
        departmentId,
        templateId: template?.id ?? null,
        origin: "CRM",
        status: "UNASSIGNED",
      },
    });
    summary.created += 1;
    return;
  }

  // The list moved before anybody picked the task up, so the block is a
  // different length now.
  if (existing.quantity !== count || existing.unitMinutes !== unit) {
    await prisma.task.update({
      where: { id: existing.id },
      data: {
        quantity: count,
        unitMinutes: unit,
        estimatedMinutes,
        doneCount: Math.min(existing.doneCount, count),
      },
    });
    summary.updated += 1;
  }
}

export async function syncCrmCalls(
  departmentId?: string,
): Promise<CrmSyncSummary> {
  const summary: CrmSyncSummary = { created: 0, updated: 0, removed: 0 };
  const day = todayInZone();

  // Only today. Tasks are generated a fortnight ahead, but who is owed a call
  // next Tuesday depends on every call logged between now and then -- a task
  // claiming four calls a week out would be fiction.
  const where = departmentId ? { departmentId } : {};

  const [sources, candidates] = await Promise.all([
    prisma.crmSource.findMany({
      where: { ...where, active: true },
      include: {
        contacts: {
          select: {
            id: true,
            name: true,
            jobTitle: true,
            phone: true,
            active: true,
            lastContactedAt: true,
          },
        },
      },
    }),
    prisma.candidate.findMany({
      where: { ...where, active: true, stage: "CALL" },
      select: {
        id: true,
        name: true,
        phone: true,
        active: true,
        stage: true,
        lastAttemptedAt: true,
        departmentId: true,
      },
    }),
  ]);

  // Departments are handled separately: each runs its own CRM, and a call
  // owed by Sales is not work for HR.
  const departments = new Set<string>([
    ...sources.map((s) => s.departmentId),
    ...candidates.map((c) => c.departmentId),
    ...(departmentId ? [departmentId] : []),
  ]);

  for (const id of departments) {
    const dueSources = sourcesDue(
      sources.filter((s) => s.departmentId === id),
      day,
    );
    const dueCandidates = candidatesDue(
      candidates.filter((c) => c.departmentId === id),
      day,
    );

    await reconcile("SOURCE", id, day, dueSources.length, summary);
    await reconcile("CANDIDATE", id, day, dueCandidates.length, summary);
  }

  return summary;
}

export type CallList =
  | {
      kind: "SOURCE";
      sources: (ReturnType<typeof sourcesDue>[number] & {
        /** What was said last time, so nobody reopens a closed question. */
        lastNote: string | null;
      })[];
    }
  | { kind: "CANDIDATE"; candidates: ReturnType<typeof candidatesDue> };

/**
 * The people behind a batched call task, resolved when the panel renders
 * rather than snapshotted when the task was made -- the list is a moving
 * target and a stale one would have somebody ringing a person already called.
 */
export async function callListFor(taskId: string): Promise<CallList | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.origin !== "CRM" || !task.externalKey) return null;

  const day = todayInZone();
  const isSources = task.externalKey.includes(":source-calls:");

  if (isSources) {
    const sources = await prisma.crmSource.findMany({
      where: { departmentId: task.departmentId, active: true },
      include: {
        contacts: {
          select: {
            id: true,
            name: true,
            jobTitle: true,
            phone: true,
            active: true,
            lastContactedAt: true,
          },
        },
      },
    });

    const due = sourcesDue(sources, day);
    if (due.length === 0) return { kind: "SOURCE", sources: [] };

    // The last thing said to each, counting conversations with its people too.
    const ids = due.map((d) => d.sourceId);
    const recent = await prisma.crmInteraction.findMany({
      where: {
        OR: [{ sourceId: { in: ids } }, { contact: { sourceId: { in: ids } } }],
      },
      include: { contact: { select: { sourceId: true } } },
      orderBy: { happenedAt: "desc" },
    });

    const lastBySource = new Map<string, string>();
    for (const row of recent) {
      const key = row.sourceId ?? row.contact?.sourceId;
      if (key && !lastBySource.has(key)) lastBySource.set(key, row.notes);
    }

    return {
      kind: "SOURCE",
      sources: due.map((d) => ({
        ...d,
        lastNote: lastBySource.get(d.sourceId) ?? null,
      })),
    };
  }

  const candidates = await prisma.candidate.findMany({
    where: { departmentId: task.departmentId, active: true, stage: "CALL" },
    select: {
      id: true,
      name: true,
      phone: true,
      active: true,
      stage: true,
      lastAttemptedAt: true,
    },
  });
  return { kind: "CANDIDATE", candidates: candidatesDue(candidates, day) };
}
