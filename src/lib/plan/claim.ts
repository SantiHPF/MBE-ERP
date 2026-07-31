import { prisma } from "@/lib/db";
import { fail } from "@/lib/i18n/errors";
import { toDateOnly } from "@/lib/time";

/**
 * Taking a catalogue entry for a day.
 *
 * The plan board does this when somebody ticks a cell; the gap-filler does it
 * when somebody accepts a spare-time job. Both have to survive two people
 * doing it at the same instant, and the handling for that is subtle enough --
 * a conditional update, then a unique-violation catch, then working out who
 * actually won -- that a second copy of it would be a second chance to get it
 * wrong.
 *
 * Placing the task on the day is left to the caller: the board wants it
 * wherever it fits, the gap-filler wants it after the current moment.
 */

export type Claim =
  /** Ours now, or already was. Either way the caller's job is done. */
  | { outcome: "claimed" | "alreadyYours"; taskId: string }
  /** Somebody else has it. `by` is their name when we could find it out. */
  | { outcome: "taken"; by: string | null; title: string };

/** Postgres unique-violation: one of the schema's claim guards fired. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function claimTemplate(
  templateId: string,
  userId: string,
  departmentId: string,
  date: Date,
): Promise<Claim> {
  const day = toDateOnly(date);

  const template = await prisma.taskTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template) fail("errors.notInCatalogue");
  if (template.departmentId !== departmentId) fail("errors.taskOtherDepartment");

  // Somebody may have created the instance since the page loaded.
  const existing = await prisma.task.findFirst({
    where: { templateId: template.id, dueDate: day, status: { not: "CANCELLED" } },
    include: { assignee: { select: { id: true, displayName: true } } },
  });

  if (existing) {
    if (existing.assigneeId === userId) {
      return { outcome: "alreadyYours", taskId: existing.id };
    }
    if (existing.assigneeId === null) {
      const { count } = await prisma.task.updateMany({
        where: { id: existing.id, assigneeId: null },
        data: { assigneeId: userId, status: "ASSIGNED" },
      });
      if (count === 0) return { outcome: "taken", by: null, title: template.name };
      return { outcome: "claimed", taskId: existing.id };
    }
    return {
      outcome: "taken",
      by: existing.assignee?.displayName ?? null,
      title: template.name,
    };
  }

  /**
   * The findFirst above is not a guarantee: somebody can create the task in
   * the gap before this runs. A partial unique index on (templateId, dueDate)
   * for live CATALOGUE tasks makes that a collision rather than a duplicate,
   * and losing the collision means they got there first.
   */
  try {
    const created = await prisma.task.create({
      data: {
        title: template.name,
        estimatedMinutes: template.estimatedMinutes,
        dueDate: day,
        departmentId,
        templateId: template.id,
        priority: template.priority,
        // Copied like anchor and priority, so re-placing it later still honours it.
        shiftHalf: template.shiftHalf,
        origin: "CATALOGUE",
        status: "ASSIGNED",
        assigneeId: userId,
      },
    });
    return { outcome: "claimed", taskId: created.id };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const winner = await prisma.task.findFirst({
      where: {
        templateId: template.id,
        dueDate: day,
        origin: "CATALOGUE",
        status: { not: "CANCELLED" },
      },
      include: { assignee: { select: { id: true, displayName: true } } },
    });

    if (winner?.assigneeId === userId) {
      return { outcome: "alreadyYours", taskId: winner.id };
    }
    return {
      outcome: "taken",
      by: winner?.assignee?.displayName ?? null,
      title: template.name,
    };
  }
}
