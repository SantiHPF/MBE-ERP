import { prisma } from "@/lib/db";

/**
 * Logging a conversation.
 *
 * The log is the record; `lastContactedAt` on the source, the contact and the
 * candidate is a derived copy of it, kept because "who is owed a call" has to
 * be a query rather than an aggregate over every conversation ever had. Both
 * are written in one transaction so they can never disagree -- a log entry
 * whose date never rolled forward would put somebody on the call list forever.
 */

export type LogInput = {
  departmentId: string;
  userId: string;
  outcome: "TALKED" | "NO_ANSWER" | "LEFT_MESSAGE";
  notes: string;
  taskId?: string | null;
  happenedAt?: Date;
};

/**
 * A call to somebody at a university or portal.
 *
 * Both dates move: the source so the two-month clock restarts, and the contact
 * so the next cycle reaches somebody else. Reaching for them counts even if
 * nobody picked up -- otherwise an unanswered call would have us ringing the
 * same person again tomorrow and never working through the list.
 */
export async function logSourceCall(
  input: LogInput & { sourceId: string; contactId?: string | null },
): Promise<void> {
  const happenedAt = input.happenedAt ?? new Date();

  await prisma.$transaction([
    prisma.crmInteraction.create({
      data: {
        departmentId: input.departmentId,
        // The check constraint allows exactly one subject, so a call to a
        // named person is logged against the person; the source's date is
        // still rolled below.
        ...(input.contactId
          ? { contactId: input.contactId }
          : { sourceId: input.sourceId }),
        userId: input.userId,
        outcome: input.outcome,
        notes: input.notes,
        taskId: input.taskId ?? null,
        happenedAt,
      },
    }),
    prisma.crmSource.update({
      where: { id: input.sourceId },
      data: { lastContactedAt: happenedAt },
    }),
    ...(input.contactId
      ? [
          prisma.crmContact.update({
            where: { id: input.contactId },
            data: { lastContactedAt: happenedAt },
          }),
        ]
      : []),
  ]);
}

/**
 * A call to a candidate.
 *
 * One attempt is the rule, so `lastAttemptedAt` is set whatever happened. When
 * nobody answered they also go inactive with "no reply" -- that was the
 * decision, and leaving them in the pipeline unreachable is exactly the quiet
 * rot this is meant to prevent.
 */
export async function logCandidateCall(
  input: LogInput & { candidateId: string },
): Promise<void> {
  const happenedAt = input.happenedAt ?? new Date();
  const noAnswer = input.outcome === "NO_ANSWER";

  await prisma.$transaction([
    prisma.crmInteraction.create({
      data: {
        departmentId: input.departmentId,
        candidateId: input.candidateId,
        userId: input.userId,
        outcome: input.outcome,
        notes: input.notes,
        taskId: input.taskId ?? null,
        happenedAt,
      },
    }),
    prisma.candidate.update({
      where: { id: input.candidateId },
      data: {
        lastAttemptedAt: happenedAt,
        ...(noAnswer
          ? {
              active: false,
              dropReason: "NO_REPLY" as const,
              dropNote: input.notes || null,
            }
          : {}),
      },
    }),
  ]);
}

/** Everything ever said to a source, including to the people inside it. */
export async function sourceHistory(sourceId: string) {
  return prisma.crmInteraction.findMany({
    where: {
      OR: [{ sourceId }, { contact: { sourceId } }],
    },
    include: {
      user: { select: { displayName: true } },
      contact: { select: { name: true } },
    },
    orderBy: { happenedAt: "desc" },
  });
}

export async function candidateHistory(candidateId: string) {
  return prisma.crmInteraction.findMany({
    where: { candidateId },
    include: { user: { select: { displayName: true } } },
    orderBy: { happenedAt: "desc" },
  });
}
