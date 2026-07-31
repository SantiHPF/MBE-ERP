import { prisma } from "@/lib/db";
import type { Task } from "@prisma/client";
import { buildFollowKey, chainFrom, type FollowLink } from "./follow";
import { placeOnDay } from "./place";

/**
 * Turning a catalogue link into real tasks.
 *
 * The I/O half of follow.ts, same split as onboarding.ts / onboarding-db.ts.
 *
 * A follower inherits the leader's day, department, owner and *origin*. The
 * origin matters more than it looks: the gap-filler's cadence rules read it, so
 * a follower of a recurring task has to be recurring too, or the second half of
 * a rhythm would read as ad-hoc debt and get offered for free time on its own.
 */

/** The department's links, which is all chainFrom() needs. */
async function linksFor(departmentId: string): Promise<FollowLink[]> {
  const templates = await prisma.taskTemplate.findMany({
    where: { departmentId, active: true },
    select: { id: true, followsId: true },
  });
  return templates;
}

/**
 * Create everything that hangs off `leader`, each placed after the last.
 *
 * Idempotent: followers are keyed on the leader's externalKey, so re-running
 * the scheduler over the same window finds them rather than making more. A
 * leader with no externalKey -- an ad-hoc claim -- gets keys built from its id,
 * which is just as stable.
 *
 * Returns what was created, in the order it has to happen.
 */
export async function createFollowers(leader: Task): Promise<Task[]> {
  if (!leader.templateId) return [];

  const links = await linksFor(leader.departmentId);
  const followerTemplateIds = chainFrom(leader.templateId, links);
  if (followerTemplateIds.length === 0) return [];

  const templates = await prisma.taskTemplate.findMany({
    where: { id: { in: followerTemplateIds }, active: true },
  });
  const byId = new Map(templates.map((t) => [t.id, t]));

  const leaderKey = leader.externalKey ?? `task:${leader.id}`;
  const created: Task[] = [];

  /**
   * Each link points at the task before it, not at the leader, so a chain of
   * three reads as a chain rather than three things all hanging off the first.
   */
  let previous = leader;

  for (const templateId of followerTemplateIds) {
    const template = byId.get(templateId);
    if (!template) continue;

    const externalKey = buildFollowKey(leaderKey, templateId);

    const existing = await prisma.task.findUnique({ where: { externalKey } });
    if (existing) {
      previous = existing;
      continue;
    }

    const follower = await prisma.task.create({
      data: {
        externalKey,
        title: template.name,
        estimatedMinutes: template.estimatedMinutes,
        dueDate: leader.dueDate,
        departmentId: leader.departmentId,
        templateId: template.id,
        priority: template.priority,
        shiftHalf: template.shiftHalf,
        origin: leader.origin,
        // Unowned work cannot be "after" anything in particular, so a follower
        // of an unassigned leader waits unassigned too and the engine places
        // the pair together.
        assigneeId: leader.assigneeId,
        status: leader.assigneeId ? "ASSIGNED" : "UNASSIGNED",
        scheduledDate: leader.assigneeId ? leader.scheduledDate : null,
        followsTaskId: previous.id,
      },
    });

    // Immediately after whatever it follows, when the leader has a slot at all.
    if (leader.assigneeId && leader.scheduledDate) {
      await placeOnDay(
        follower.id,
        leader.assigneeId,
        leader.scheduledDate,
        previous.scheduledEnd ?? 0,
      );
    }

    const placed = await prisma.task.findUniqueOrThrow({
      where: { id: follower.id },
    });
    created.push(placed);
    previous = placed;
  }

  return created;
}

/**
 * Every task downstream of these, in one query per level.
 *
 * Used by the cascades -- defer, cancel, orphan -- which all have to treat a
 * pair as a pair. Bounded by MAX_CHAIN through the loop rather than recursing
 * without limit.
 */
export async function followersOf(taskIds: string[]): Promise<Task[]> {
  const out: Task[] = [];
  let frontier = taskIds;
  const seen = new Set(taskIds);

  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const next = await prisma.task.findMany({
      where: { followsTaskId: { in: frontier }, status: { not: "CANCELLED" } },
    });

    frontier = [];
    for (const task of next) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      out.push(task);
      frontier.push(task.id);
    }
  }

  return out;
}
