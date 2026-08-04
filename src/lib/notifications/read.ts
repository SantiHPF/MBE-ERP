import "server-only";
import { prisma } from "@/lib/db";
import { hasRole, canDecideAbsences } from "@/lib/auth/guards";
import type { SessionUser } from "@/lib/auth/session";
import { getTriageQueue, getStuckQueue } from "@/lib/triage/queue";
import { buildFeed, type Feed, type FeedInput } from "./feed";

/** Enough of a message to recognise it; the thread has the rest. */
const PREVIEW = 90;

/**
 * Everything waiting for one person, gathered from where it already lives.
 *
 * The two task sources are the very queries /triage renders, which is the
 * point: the bell and the Pendientes page read the same rows, so they cannot
 * come to different conclusions about what is outstanding.
 *
 * Role gating happens here rather than at the render site. A WORKER simply
 * has three empty arrays, so nothing downstream needs to know about roles.
 */
export async function getNotifications(user: SessionUser): Promise<Feed> {
  const isManager = hasRole(user, "MANAGER");
  const isHr = canDecideAbsences(user);

  const [messages, absences, orphans, blocks, row] = await Promise.all([
    prisma.message.findMany({
      where: { recipientId: user.id, readAt: null },
      select: {
        id: true,
        body: true,
        createdAt: true,
        sender: { select: { displayName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    isHr
      ? prisma.absence.findMany({
          where: { status: "PENDING" },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            createdAt: true,
            // The relation is *named* AbsenceSubject; the field is `user`.
            user: { select: { displayName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [],
    isManager ? getTriageQueue(user.departmentId) : [],
    isManager ? getStuckQueue(user.departmentId) : [],
    prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationsSeenAt: true },
    }),
  ]);

  const input: FeedInput = {
    messages: messages.map((m) => ({
      id: m.id,
      from: m.sender.displayName,
      preview: m.body.slice(0, PREVIEW),
      at: m.createdAt.toISOString(),
    })),
    absences: absences.map((a) => ({
      id: a.id,
      person: a.user.displayName,
      dates: `${short(a.startDate)} – ${short(a.endDate)}`,
      at: a.createdAt.toISOString(),
    })),
    /*
     * Orphans and blocks carry no timestamp of their own in these types --
     * getTriageQueue orders by the date the work was scheduled for, and
     * getStuckQueue by when it stopped.
     *
     * StuckTask.when is already `createdAt.toISOString()`, so it passes
     * straight through. An orphan carries only a "YYYY-MM-DD" day key, and
     * the day the work was due is the honest instant to sort it by -- that
     * is the day the decision is needed by. An orphan with no scheduled date
     * has no position on the list and is dropped rather than dated to now.
     */
    orphans: orphans
      .filter((o) => o.scheduledDate !== null)
      .map((o) => ({
        id: o.id,
        title: o.title,
        at: `${o.scheduledDate}T00:00:00.000Z`,
      })),
    blocks: blocks.map((b) => ({
      id: b.blockId,
      title: b.title,
      at: b.when,
    })),
  };

  return buildFeed(input, row?.notificationsSeenAt?.toISOString() ?? null);
}

/** dd/mm, which is all a date range needs at 12px. */
function short(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}`;
}
