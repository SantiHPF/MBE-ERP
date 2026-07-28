import { requireUser, hasRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { toDateOnly } from "@/lib/time";
import { P1nList } from "./p1n-list";

export const dynamic = "force-dynamic";

export default async function P1nPage() {
  const user = await requireUser();
  const { t } = await getT();

  const [entries, myTasks] = await Promise.all([
    prisma.p1n.findMany({
      where: { departmentId: user.departmentId },
      include: {
        user: { select: { id: true, displayName: true } },
        task: { select: { title: true } },
        appliedBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    // Only recent work of your own is worth offering to attach.
    prisma.task.findMany({
      where: {
        assigneeId: user.id,
        dueDate: { gte: toDateOnly(new Date(Date.now() - 30 * 86_400_000)) },
      },
      select: { id: true, title: true, dueDate: true },
      orderBy: { dueDate: "desc" },
      take: 60,
    }),
  ]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="page-title">{t("p1n.title")}</h1>
        <p className="page-sub">{t("p1n.subtitle")}</p>
      </div>

      <p className="mb-5 max-w-[72ch] text-[13px] text-muted">{t("p1n.intro")}</p>

      <P1nList
        canApply={hasRole(user, "MANAGER")}
        currentUserId={user.id}
        tasks={myTasks.map((task) => ({
          id: task.id,
          label: `${task.dueDate.toISOString().slice(0, 10)} · ${task.title}`,
        }))}
        entries={entries.map((e) => ({
          id: e.id,
          mistake: e.mistake,
          cause: e.cause,
          solution: e.solution,
          taskTitle: e.task?.title ?? null,
          authorId: e.user.id,
          authorName: e.user.displayName,
          createdAt: e.createdAt.toISOString().slice(0, 10),
          appliedAt: e.appliedAt ? e.appliedAt.toISOString().slice(0, 10) : null,
          appliedByName: e.appliedBy?.displayName ?? null,
          appliedNote: e.appliedNote,
        }))}
      />
    </div>
  );
}
