import { redirect } from "next/navigation";
import { requireUser, canDecideAbsences } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dateKey, formatClock } from "@/lib/time";
import { isEffective } from "@/lib/absence/effective";
import { DecisionButtons } from "./decision-buttons";

export const dynamic = "force-dynamic";

export default async function HrAbsencesPage() {
  const user = await requireUser();
  if (!canDecideAbsences(user)) redirect("/my-day");

  const [pending, decided] = await Promise.all([
    prisma.absence.findMany({
      where: { status: "PENDING" },
      include: {
        user: { select: { displayName: true, department: { select: { name: true } } } },
      },
      orderBy: { startDate: "asc" },
    }),
    prisma.absence.findMany({
      where: { status: { not: "PENDING" } },
      include: {
        user: { select: { displayName: true, department: { select: { name: true } } } },
        decidedBy: { select: { displayName: true } },
      },
      orderBy: { decidedAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div>
      <h1 className="page-title">Absence requests</h1>
      <p className="page-sub mb-5 max-w-[65ch]">
        Sick days already apply to the schedule when they are reported — nobody
        is counted as at work while they are off. Your decision records them.
        Holiday and personal leave do nothing until you approve them.
      </p>

      <section className="mb-8">
        <h2 className="eyebrow mb-2.5 block">
          Waiting for you · {pending.length}
        </h2>

        {pending.length === 0 ? (
          <p className="empty">
            Nothing waiting.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {pending.map((a) => {
              const counting = isEffective(a);
              return (
                <article
                  key={a.id}
                  className={`rounded border bg-surface shadow-sm ${
                    counting ? "border-pause" : "border-line"
                  }`}
                >
                  <header className="flex flex-wrap items-baseline gap-2 border-b border-line px-3.5 py-2.5">
                    <span className="text-sm font-semibold">
                      {a.user.displayName}
                    </span>
                    <span className="text-xs text-muted">
                      {a.user.department.name}
                    </span>
                    <span className="rounded border border-line px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-muted uppercase">
                      {a.category.toLowerCase()}
                    </span>
                    <span className="flex-1" />
                    <span
                      className={`text-[11px] font-semibold ${
                        counting ? "text-pause" : "text-muted"
                      }`}
                    >
                      {counting
                        ? "Already off — schedule updated"
                        : "Not applied yet"}
                    </span>
                  </header>

                  <div className="px-3.5 py-3">
                    <p className="num text-[13px]">
                      {dateKey(a.startDate)}
                      {dateKey(a.endDate) !== dateKey(a.startDate) &&
                        ` → ${dateKey(a.endDate)}`}
                      {a.scope === "PARTIAL" &&
                        a.startMinutes != null &&
                        a.endMinutes != null && (
                          <span className="text-muted">
                            {" "}
                            · {formatClock(a.startMinutes)}–
                            {formatClock(a.endMinutes)}
                          </span>
                        )}
                    </p>
                    {a.note && (
                      <p className="mt-1 text-[13px] text-muted">{a.note}</p>
                    )}

                    <div className="mt-3">
                      <DecisionButtons absenceId={a.id} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-2.5 block">
          Decided
        </h2>

        {decided.length === 0 ? (
          <p className="empty">
            Nothing decided yet.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
                  <th className="px-3.5 py-2">Person</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Decision</th>
                  <th className="px-3.5 py-2">By</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="px-3.5 py-2">
                      {a.user.displayName}
                      <span className="ml-1.5 text-xs text-muted">
                        {a.user.department.name}
                      </span>
                    </td>
                    <td className="num px-3 py-2">
                      {dateKey(a.startDate)}
                      {dateKey(a.endDate) !== dateKey(a.startDate) &&
                        ` → ${dateKey(a.endDate)}`}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {a.category.toLowerCase()}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-1.5 py-px text-[9.5px] font-semibold tracking-wider uppercase ${
                          a.status === "APPROVED"
                            ? "border-run text-run"
                            : "border-stall text-stall"
                        }`}
                      >
                        {a.status.toLowerCase()}
                      </span>
                      {a.decisionNote && (
                        <span className="ml-1.5 text-xs text-muted">
                          {a.decisionNote}
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2 text-muted">
                      {a.decidedBy?.displayName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
