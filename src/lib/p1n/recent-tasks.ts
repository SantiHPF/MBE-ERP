import { prisma } from "@/lib/db";
import { toDateOnly } from "@/lib/time";

/**
 * The work a P1N can be attached to: your own, recent enough to remember.
 *
 * Shared by /p1n and My Day so the dropdown offers the same thing from both,
 * and so the "only your own tasks" rule has one definition.
 */
export async function recentTasksForP1n(
  userId: string,
): Promise<{ id: string; label: string }[]> {
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      dueDate: { gte: toDateOnly(new Date(Date.now() - 30 * 86_400_000)) },
      // The job, not its sittings: four rows reading the same title on four
      // dates is a dropdown nobody can pick from, and a P1N is about the work
      // rather than about which afternoon of it went wrong.
      parentTaskId: null,
    },
    select: { id: true, title: true, dueDate: true },
    orderBy: { dueDate: "desc" },
    take: 60,
  });

  return tasks.map((task) => ({
    id: task.id,
    label: `${task.dueDate.toISOString().slice(0, 10)} · ${task.title}`,
  }));
}
