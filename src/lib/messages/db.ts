import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Reading the inbox.
 *
 * A conversation is not a stored thing here -- it is every message between two
 * people in either direction, ordered by time. That keeps the write path to a
 * single row and the unread badge to a single indexed count, which matters
 * because the badge runs on every page load in the app.
 */

export type Correspondent = {
  userId: string;
  displayName: string;
  /** The last thing either of you said, for the list on the left. */
  lastBody: string;
  lastAt: string;
  /** True when the last message was theirs, not yours. */
  fromThem: boolean;
  unread: number;
};

export type ThreadMessage = {
  id: string;
  body: string;
  mine: boolean;
  at: string;
  read: boolean;
  task: { id: string; title: string } | null;
};

/** How many unread messages are waiting. The badge, and the poll. */
export function unreadFor(userId: string): Promise<number> {
  return prisma.message.count({
    where: { recipientId: userId, readAt: null },
  });
}

/**
 * Everybody this person has talked to, most recent first.
 *
 * Folded in memory rather than in SQL: at this headcount the whole
 * correspondence is a few hundred rows, and a DISTINCT ON would have to be
 * raw SQL and would still need a second query for the unread counts.
 */
export async function inbox(userId: string): Promise<Correspondent[]> {
  const messages = await prisma.message.findMany({
    where: { OR: [{ senderId: userId }, { recipientId: userId }] },
    include: {
      sender: { select: { id: true, displayName: true } },
      recipient: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  const byPerson = new Map<string, Correspondent>();

  for (const m of messages) {
    const them = m.senderId === userId ? m.recipient : m.sender;
    const existing = byPerson.get(them.id);

    if (!existing) {
      byPerson.set(them.id, {
        userId: them.id,
        displayName: them.displayName,
        lastBody: m.body,
        lastAt: m.createdAt.toISOString(),
        fromThem: m.senderId !== userId,
        // Counted below; the first row seen is the newest, not the tally.
        unread: 0,
      });
    }

    if (m.recipientId === userId && m.readAt === null) {
      byPerson.get(them.id)!.unread += 1;
    }
  }

  return [...byPerson.values()];
}

/** One conversation, oldest first, which is the order you read it in. */
export async function thread(
  userId: string,
  otherId: string,
): Promise<ThreadMessage[]> {
  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: userId, recipientId: otherId },
        { senderId: otherId, recipientId: userId },
      ],
    },
    include: { task: { select: { id: true, title: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    mine: m.senderId === userId,
    at: m.createdAt.toISOString(),
    read: m.readAt !== null,
    task: m.task ? { id: m.task.id, title: m.task.title } : null,
  }));
}

/**
 * Who this person may write to: anybody who still works here.
 *
 * Deliberately not scoped by department or rank. This started out confined to
 * your own department, with managers able to reach further, and the rule was
 * wrong in both directions -- a worker sent a message from HR had no way to
 * answer it, and a company this size has people talking across departments all
 * day regardless of what the org chart says. A message is one sentence to one
 * person; there is nothing here worth gating.
 */
export async function canWriteTo(user: SessionUser) {
  return prisma.user.findMany({
    where: { active: true, id: { not: user.id } },
    select: { id: true, displayName: true, departmentId: true },
    orderBy: { displayName: "asc" },
  });
}
