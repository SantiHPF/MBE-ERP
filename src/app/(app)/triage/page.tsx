import { requireRole } from "@/lib/auth/guards";
import { getTriageQueue } from "@/lib/triage/queue";
import { prisma } from "@/lib/db";
import { formatClock } from "@/lib/time";
import { OrphanCard } from "./orphan-card";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function TriagePage() {
  const user = await requireRole("MANAGER");
  const { t } = await getT();
  const [queue, paused, unassigned] = await Promise.all([
    getTriageQueue(user.departmentId),
    prisma.task.findMany({
      where: { departmentId: user.departmentId, status: "PAUSED" },
      include: {
        assignee: { select: { displayName: true } },
        timeEntries: {
          include: { pauses: { where: { resumedAt: null } } },
        },
      },
    }),
    prisma.task.count({
      where: { departmentId: user.departmentId, status: "UNASSIGNED" },
    }),
  ]);

  return (
    <div>
      <h1 className="page-title">{t("triage.title")}</h1>
      <p className="page-sub mb-5">
        {t("triage.intro")}
      </p>

      <section className="mb-8">
        <h2 className="eyebrow mb-2.5 block">
          {t("triage.orphaned", queue.length)}
        </h2>

        {queue.length === 0 ? (
          <p className="empty">
            {t("triage.nothingOrphaned")}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {queue.map((task) => (
              <OrphanCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="eyebrow mb-2.5 block">
          {t("triage.stalled", paused.length)}
        </h2>

        {paused.length === 0 ? (
          <p className="empty">
            {t("triage.nothingPaused")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {paused.map((task) => {
              const open = task.timeEntries.flatMap((e) => e.pauses)[0];
              return (
                <li
                  key={task.id}
                  className="rounded border border-pause bg-pause-wash px-3.5 py-2.5"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium">{task.title}</span>
                    <span className="text-xs text-muted">
                      {task.assignee?.displayName}
                    </span>
                    <span className="flex-1" />
                    {open && (
                      <span className="num text-[11px] text-muted">
                        {t(
                          "triage.since",
                          formatClock(
                            open.pausedAt.getUTCHours() * 60 +
                              open.pausedAt.getUTCMinutes(),
                          ),
                        )}
                      </span>
                    )}
                  </div>
                  {open && (
                    <p className="mt-1 text-[13px]">
                      <span className="mr-1.5 rounded border border-pause px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-pause uppercase">
                        {open.reasonCode.replace(/_/g, " ")}
                      </span>
                      {open.reasonText}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {unassigned > 0 && (
        <section>
          <h2 className="eyebrow mb-2.5 block">
            {t("triage.nobodyHadRoom", unassigned)}
          </h2>
          <p className="rounded border border-line bg-surface px-3.5 py-2.5 text-[13px] text-muted">
            {t(
              "triage.nobodyHadRoomText",
              `${unassigned} ${unassigned === 1 ? t("common.task") : t("common.tasks")}`,
            )}
          </p>
        </section>
      )}
    </div>
  );
}
