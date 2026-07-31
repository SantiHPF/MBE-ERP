import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { scheduleZone, today } from "@/lib/time";
import { sourceIsDue, type SourceInput } from "@/lib/crm/due";

export const dynamic = "force-dynamic";

/**
 * Everything ever said to one university, in one place.
 *
 * The sources list shows the last call per contact and nothing more, which
 * answers "should I ring them" but not "what have we actually agreed with these
 * people over the past two years". Every call is already recorded; this is the
 * page that reads it back.
 *
 * The one subtlety is the query. A CHECK constraint lets an interaction have
 * exactly one subject, and logSourceCall() files a call to a named person
 * against the *person* -- so `sourceId` is null on it. A university's history
 * is therefore its own direct calls *plus* every one of its contacts', which is
 * why asking for `sourceId` alone comes back nearly empty.
 */

/** Date and time in the company's zone, formatted server-side. */
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

/** Years of a two-monthly cycle, and a bound on the page. */
const HISTORY_LIMIT = 200;

export default async function SourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const { t } = await getT();

  const source = await prisma.crmSource.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ active: "desc" }, { name: "asc" }] },
      _count: { select: { candidates: true } },
    },
  });

  // Not found and not yours read the same on purpose: one department should
  // not be able to probe another's for which ids exist.
  if (!source || source.departmentId !== user.departmentId) notFound();

  const contactIds = source.contacts.map((c) => c.id);

  const [history, callCounts] = await Promise.all([
    prisma.crmInteraction.findMany({
      where: {
        OR: [
          { sourceId: source.id },
          ...(contactIds.length > 0 ? [{ contactId: { in: contactIds } }] : []),
        ],
      },
      orderBy: { happenedAt: "desc" },
      take: HISTORY_LIMIT,
      include: {
        user: { select: { displayName: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
    prisma.crmInteraction.groupBy({
      by: ["contactId"],
      where: { contactId: { in: contactIds } },
      _count: { _all: true },
    }),
  ]);

  const callsBy = new Map(
    callCounts.map((row) => [row.contactId, row._count._all]),
  );

  // The same rule the scheduler uses, so this badge and the task in My Day can
  // never say different things.
  const due =
    source.active && sourceIsDue(source as unknown as SourceInput, today());

  const OUTCOME: Record<string, string> = {
    TALKED: t("crm.outcomeTalked"),
    NO_ANSWER: t("crm.outcomeNoAnswer"),
    LEFT_MESSAGE: t("crm.outcomeLeftMessage"),
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/crm/sources" className="text-[12.5px] text-muted hover:text-ink">
          ← {t("crm.backToSources")}
        </Link>
      </div>

      {/* ------------------------------------------------------------ header */}
      <section className="card">
        <header className="card-head flex-wrap gap-2">
          <h2 className="text-[15px] font-semibold">{source.name}</h2>
          <span className="badge">
            {source.type === "UNIVERSITY"
              ? t("crm.university")
              : t("crm.jobPortal")}
          </span>
          {due && <span className="badge badge-warn">{t("crm.dueNow")}</span>}
          {!source.active && <span className="badge">{t("crm.retired")}</span>}
        </header>
        <div className="card-body flex flex-wrap gap-x-6 gap-y-1.5 text-[12.5px]">
          <Fact label={t("crm.lastTalked")}>
            {source.lastContactedAt ? (
              stamp(source.lastContactedAt)
            ) : (
              <span className="text-pause">{t("crm.neverTalked")}</span>
            )}
          </Fact>
          <Fact label={t("crm.contacts")}>{source.contacts.length}</Fact>
          <Fact label={t("crm.candidates")}>{source._count.candidates}</Fact>
          <Fact label={t("crm.callsLogged")}>{history.length}</Fact>
          {source.phone && (
            <Fact label={t("crm.switchboard")}>
              <a
                href={`tel:${source.phone.replace(/\s+/g, "")}`}
                className="text-accent hover:underline"
              >
                {source.phone}
              </a>
            </Fact>
          )}
          {source.email && (
            <Fact label={t("crm.generalEmail")}>
              <a
                href={`mailto:${source.email}`}
                className="text-accent hover:underline"
              >
                {source.email}
              </a>
            </Fact>
          )}
        </div>
        {source.notes && (
          <p className="border-t border-line px-4 py-2.5 text-[12.5px] leading-relaxed">
            {source.notes}
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------- contacts */}
      <section className="card">
        <header className="card-head">
          <span className="eyebrow">{t("crm.contacts")}</span>
        </header>
        {source.contacts.length === 0 ? (
          <p className="empty px-4 py-6">{t("crm.noContacts")}</p>
        ) : (
          <ul className="flex flex-col">
            {source.contacts.map((contact) => (
              <li
                key={contact.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 text-[12.5px] last:border-0"
              >
                <span className="font-medium">{contact.name}</span>
                {contact.jobTitle && (
                  <span className="text-muted">{contact.jobTitle}</span>
                )}
                {!contact.active && (
                  <span className="badge">{t("crm.retired")}</span>
                )}
                <span className="flex-1" />
                {contact.phone && <span className="num text-muted">{contact.phone}</span>}
                {contact.email && <span className="text-muted">{contact.email}</span>}
                <span className="num text-faint">
                  {t("crm.callsN", callsBy.get(contact.id) ?? 0)}
                </span>
                <span className="num w-[130px] shrink-0 text-right text-faint">
                  {contact.lastContactedAt
                    ? stamp(contact.lastContactedAt)
                    : t("crm.neverTalked")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------- the whole log */}
      <section className="card">
        <header className="card-head">
          <span className="eyebrow">{t("crm.callHistory")}</span>
          <span className="num text-[12px] text-muted">
            {t("crm.callsN", history.length)}
            {history.length === HISTORY_LIMIT && ` (${t("crm.mostRecent")})`}
          </span>
        </header>

        {history.length === 0 ? (
          <p className="empty px-4 py-10">{t("crm.noCallsYet")}</p>
        ) : (
          <ul className="flex flex-col">
            {history.map((call) => (
              <li
                key={call.id}
                className="border-b border-line px-4 py-2.5 last:border-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
                  <span className="num w-[130px] shrink-0 text-muted">
                    {stamp(call.happenedAt)}
                  </span>
                  <span className="font-medium">
                    {/* A call made to the switchboard rather than a person. */}
                    {call.contact?.name ?? t("crm.theInstitution")}
                  </span>
                  <span
                    className={`badge ${call.outcome === "TALKED" ? "badge-ok" : ""}`}
                  >
                    {OUTCOME[call.outcome] ?? call.outcome}
                  </span>
                  <span className="flex-1" />
                  <span className="text-faint">{call.user.displayName}</span>
                </div>
                {call.notes && (
                  <p className="mt-1 pl-[142px] text-[12.5px] leading-relaxed text-muted">
                    {call.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="eyebrow">{label}</span>
      <span className="num">{children}</span>
    </span>
  );
}
