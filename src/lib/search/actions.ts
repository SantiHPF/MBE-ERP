"use server";

import { prisma } from "@/lib/db";
import { requireUser, hasRole, canManagePeople } from "@/lib/auth/guards";
import { formatDuration } from "@/lib/time";
import { rankHits, MAX_HITS, type SearchHit } from "./rank";

/**
 * ⌘K, over the three things worth jumping to.
 *
 * Searches the catalogue (task templates) rather than task instances, because
 * "Revisión Portales" is a catalogue entry in how the company talks about it,
 * /catalogue is a real page that lists them, and there is no per-instance task
 * page to deep-link to.
 *
 * Three `contains` queries and no index. This is one company's operations,
 * not a corpus -- a search index would be machinery for a problem that does
 * not exist, and the cap means the query never returns more than eighteen
 * rows however common the word.
 *
 * Each kind is scoped to match what its destination page actually shows:
 * - Task templates: company-wide (/catalogue accepts ?dept parameter)
 * - People: company-wide (/hr/people shows all departments)
 * - P1N: department-scoped (/p1n filters by department)
 */
export async function search(query: string): Promise<SearchHit[]> {
  const user = await requireUser();
  const q = query.trim();
  if (q === "") return [];

  const where = { contains: q, mode: "insensitive" as const };

  const [tasks, people, p1ns] = await Promise.all([
    // Task templates: only for managers and above. /catalogue requires MANAGER role,
    // so we gate the search result at the query to avoid offering inaccessible pages.
    // Search is company-wide since /catalogue accepts ?dept parameter for any department.
    hasRole(user, "MANAGER")
      ? prisma.taskTemplate.findMany({
          where: { active: true, name: where },
          select: { id: true, name: true, estimatedMinutes: true, departmentId: true, department: { select: { name: true } } },
          take: MAX_HITS,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    // People: only for HR and admins. /hr/people requires canManagePeople,
    // so we gate the search result at the query to avoid offering inaccessible pages.
    // Search is company-wide since /hr/people shows all departments.
    // active: true is deliberate — an account that has left is not something you jump to.
    canManagePeople(user)
      ? prisma.user.findMany({
          where: { active: true, displayName: where },
          select: { id: true, displayName: true, username: true },
          take: MAX_HITS,
          orderBy: { displayName: "asc" },
        })
      : Promise.resolve([]),
    // P1Ns: available to everyone. /p1n only requires requireUser().
    prisma.p1n.findMany({
      where: { departmentId: user.departmentId, mistake: where },
      select: { id: true, mistake: true, createdAt: true },
      take: MAX_HITS,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const hits: SearchHit[] = [
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.name,
      sub: t.departmentId === user.departmentId
        ? formatDuration(t.estimatedMinutes)
        : `${formatDuration(t.estimatedMinutes)} · ${t.department.name}`,
      href: `/catalogue?dept=${t.departmentId}`,
    })),
    ...people.map((p) => ({
      kind: "person" as const,
      id: p.id,
      title: p.displayName,
      sub: p.username,
      href: "/hr/people",
    })),
    ...p1ns.map((p) => ({
      kind: "p1n" as const,
      id: p.id,
      title: p.mistake,
      sub: p.createdAt.toISOString().slice(0, 10),
      href: "/p1n",
    })),
  ];

  return rankHits(hits, q);
}
