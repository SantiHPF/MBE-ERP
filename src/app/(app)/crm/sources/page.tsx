import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { scheduleZone, today } from "@/lib/time";
import { sourcesDue, type SourceInput } from "@/lib/crm/due";
import { SourceList } from "./source-list";

export const dynamic = "force-dynamic";

/**
 * Date and time in the company's zone, formatted on the server.
 *
 * These land in a client component, so leaving it to the browser would render
 * one hour on the server and another in the page for anybody travelling.
 */
function stamp(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: scheduleZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(at)
    .replace(",", "");
}

export default async function SourcesPage() {
  const user = await requireUser();
  const { t } = await getT();

  const sources = await prisma.crmSource.findMany({
    where: { departmentId: user.departmentId },
    include: {
      contacts: {
        orderBy: [{ active: "desc" }, { name: "asc" }],
        include: {
          // What was said last time, so it is in front of you before you ring
          // rather than a click away.
          interactions: {
            orderBy: { happenedAt: "desc" },
            take: 1,
            include: { user: { select: { displayName: true } } },
          },
        },
      },
      _count: { select: { candidates: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  // Who is owed a call is worked out by the same rules the scheduler uses, so
  // the badge here and the task in My Day can never say different things.
  const due = new Set(
    sourcesDue(sources as unknown as SourceInput[], today()).map((s) => s.sourceId),
  );

  const rows = sources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    phone: source.phone,
    email: source.email,
    offersUpdatedAt: source.offersUpdatedAt?.toISOString().slice(0, 10) ?? null,
    // Same stamp as the contacts below it: "we rang them on the 3rd" and "we
    // rang them at 09:05 on the 3rd" are different facts when you are
    // deciding whether to try again this afternoon.
    lastContactedAt: source.lastContactedAt ? stamp(source.lastContactedAt) : null,
    notes: source.notes,
    active: source.active,
    due: due.has(source.id),
    candidateCount: source._count.candidates,
    contacts: source.contacts.map((c) => {
      const last = c.interactions[0];
      return {
        id: c.id,
        name: c.name,
        jobTitle: c.jobTitle,
        phone: c.phone,
        email: c.email,
        notes: c.notes,
        active: c.active,
        // Date and time: "we rang them on the 3rd" is a different fact from
        // "we rang them at 09:05 on the 3rd" when you are deciding whether to
        // try again this afternoon.
        lastContactedAt: c.lastContactedAt ? stamp(c.lastContactedAt) : null,
        lastCall: last
          ? {
              outcome: last.outcome,
              notes: last.notes,
              at: stamp(last.happenedAt),
              by: last.user.displayName,
            }
          : null,
      };
    }),
  }));

  return (
    <>
      {rows.length === 0 ? (
        <p className="empty">{t("crm.nothingHere")}</p>
      ) : null}
      <SourceList sources={rows} />
    </>
  );
}
