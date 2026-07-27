import { requireRole } from "@/lib/auth/guards";
import { getTriageQueue } from "@/lib/triage/queue";
import { prisma } from "@/lib/db";
import { formatClock } from "@/lib/time";
import { OrphanCard } from "./orphan-card";

export const dynamic = "force-dynamic";

export default async function TriagePage() {
  const user = await requireRole("MANAGER");
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
      <h1 className="text-xl font-semibold tracking-tight">Triage</h1>
      <p className="mt-0.5 mb-5 text-[13px] text-muted">
        Work that needs a decision. Nothing here has been moved automatically.
      </p>

      <section className="mb-8">
        <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
          Orphaned by an absence · {queue.length}
        </h2>

        {queue.length === 0 ? (
          <p className="rounded border border-dashed border-line p-8 text-center text-sm text-muted">
            Nothing orphaned. When somebody is marked away, the work they were
            due to do appears here.
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
        <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
          Stalled right now · {paused.length}
        </h2>

        {paused.length === 0 ? (
          <p className="rounded border border-dashed border-line p-6 text-center text-sm text-muted">
            Nothing is paused.
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
                        since {formatClock(
                          open.pausedAt.getUTCHours() * 60 +
                            open.pausedAt.getUTCMinutes(),
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
          <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.09em] text-faint uppercase">
            Nobody had room · {unassigned}
          </h2>
          <p className="rounded border border-line bg-surface px-3.5 py-2.5 text-[13px] text-muted">
            {unassigned} {unassigned === 1 ? "task" : "tasks"} could not be
            placed in the last scheduling run — the department was full.
            Reducing scope or extending the deadline is the usual fix.
          </p>
        </section>
      )}
    </div>
  );
}
