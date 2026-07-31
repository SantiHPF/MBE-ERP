import { requireRole } from "@/lib/auth/guards";
import {
  getRecentSlips,
  getStuckQueue,
  getTriageQueue,
  getUnplaced,
} from "@/lib/triage/queue";
import { prisma } from "@/lib/db";
import { formatClock, formatDuration } from "@/lib/time";
import { OrphanCard } from "./orphan-card";
import { StuckCard } from "./stuck-card";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function TriagePage() {
  const user = await requireRole("MANAGER");
  const { t } = await getT();
  const [queue, paused, stuck, unplaced, slips] = await Promise.all([
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
    getStuckQueue(user.departmentId),
    getUnplaced(user.departmentId),
    getRecentSlips(user.departmentId),
  ]);

  return (
    <div>
      <h1 className="page-title">{t("triage.title")}</h1>
      <p className="page-sub mb-5">
        {t("triage.intro")}
      </p>

      {/*
        First, because it is the only section where a person is waiting on an
        answer. An orphan is the system reporting a clash of dates; this is
        somebody saying the plan did not survive contact with the day.
      */}
      {stuck.length > 0 && (
        <section className="mb-8">
          <h2 className="eyebrow mb-2.5 block">
            {t("blocked.somebodyStuck", stuck.length)}
          </h2>
          <div className="flex flex-col gap-2.5">
            {stuck.map((task) => (
              <StuckCard key={task.blockId} task={task} />
            ))}
          </div>
        </section>
      )}

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

      {/*
        Was a bare count with a paragraph of prose, because the engine worked
        out a reason for each one every run and then discarded it. Now it is a
        list, and it says which of them will never fit until they are split up.
      */}
      {unplaced.length > 0 && (
        <section className="mb-8">
          <h2 className="eyebrow mb-2.5 block">
            {t("triage.nobodyHadRoom", unplaced.length)}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {unplaced.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded border border-line bg-surface px-3.5 py-2 text-[13px]"
              >
                <span className="font-medium">{task.title}</span>
                <span className="num text-[12px] text-muted">
                  {formatDuration(task.estimatedMinutes)}
                </span>
                <span className="num text-[11.5px] text-faint">{task.dueDate}</span>
                <span className="flex-1" />
                {task.reason && (
                  <span
                    className={`badge ${
                      task.reason === "needs-splitting" ? "badge-warn" : ""
                    }`}
                  >
                    {t(`triage.why-${task.reason}`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Why the week slipped. TaskDeferral has been written on every deferral
        since the feature shipped and read by nobody, so a manager watching a
        week slide had no way to find out what kept happening.
      */}
      {slips.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2.5 block">
            {t("blocked.recentSlips", slips.length)}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {slips.map((slip) => (
              <li
                key={`${slip.taskId}:${slip.when}`}
                className="rounded border border-line bg-surface px-3.5 py-2 text-[13px]"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{slip.title}</span>
                  <span className="text-xs text-muted">{slip.who}</span>
                  <span className="flex-1" />
                  <span className="num text-[11.5px] text-faint">
                    {slip.from} → {slip.to}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted">{slip.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
