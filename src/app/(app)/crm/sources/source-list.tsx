"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import {
  applyFilters,
  EMPTY_FILTERS,
  type Field,
  type FilterState,
} from "@/lib/filters/filters";
import { FilterBar } from "../filter-bar";
import {
  logSourceConversation,
  saveContact,
  saveSource,
  setContactActive,
  setSourceActive,
  type CrmState,
} from "@/lib/crm/actions";

const initial: CrmState = {};

export type ContactRow = {
  id: string;
  name: string;
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
  /** Anything worth knowing before ringing them. Not the conversation log. */
  notes: string | null;
  active: boolean;
  lastContactedAt: string | null;
  lastCall: {
    outcome: "TALKED" | "NO_ANSWER" | "LEFT_MESSAGE";
    notes: string;
    at: string;
    by: string;
  } | null;
};

export type SourceRow = {
  id: string;
  name: string;
  type: "UNIVERSITY" | "JOB_PORTAL";
  /** The switchboard and the info@, as opposed to a named person's line. */
  phone: string | null;
  email: string | null;
  offersUpdatedAt: string | null;
  lastContactedAt: string | null;
  notes: string | null;
  active: boolean;
  due: boolean;
  candidateCount: number;
  contacts: ContactRow[];
};

export function SourceList({ sources }: { sources: SourceRow[] }) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  /**
   * Everything a university row holds, declared once.
   *
   * The contacts' own fields are folded in as text, so searching a person's
   * name or phone number finds the university they work at -- which is how
   * you would actually go looking for them.
   */
  const fields = useMemo<Field<SourceRow>[]>(
    () => [
      { key: "name", label: t("crm.sourceName"), kind: "text", get: (s) => s.name },
      { key: "notes", label: t("crm.notes"), kind: "text", get: (s) => s.notes },
      {
        key: "reach",
        label: t("crm.switchboard"),
        kind: "text",
        get: (s) => [s.phone, s.email],
      },
      {
        key: "people",
        label: t("crm.contacts"),
        kind: "text",
        get: (s) =>
          s.contacts.flatMap((c) => [c.name, c.jobTitle, c.phone, c.email, c.notes]),
      },
      {
        key: "type",
        label: t("crm.sourceType"),
        kind: "enum",
        options: [
          { value: "UNIVERSITY", label: t("crm.university") },
          { value: "JOB_PORTAL", label: t("crm.jobPortal") },
        ],
        get: (s) => s.type,
      },
      {
        key: "due",
        label: t("crm.dueNow"),
        kind: "bool",
        yes: t("crm.dueNow"),
        no: t("filters.notDue"),
        get: (s) => s.due,
      },
      {
        key: "active",
        label: t("filters.status"),
        kind: "bool",
        yes: t("filters.inUse"),
        no: t("crm.retired"),
        get: (s) => s.active,
      },
      {
        key: "hasCandidates",
        label: t("crm.candidates"),
        kind: "bool",
        yes: t("filters.withCandidates"),
        no: t("filters.withoutCandidates"),
        get: (s) => s.candidateCount > 0,
      },
      {
        key: "lastContactedAt",
        label: t("crm.lastTalked"),
        kind: "date",
        get: (s) => s.lastContactedAt,
      },
      {
        key: "offersUpdatedAt",
        label: t("crm.offersUpdated"),
        kind: "date",
        get: (s) => s.offersUpdatedAt,
      },
    ],
    [t],
  );

  const shown = useMemo(
    () => applyFilters(sources, fields, filters),
    [sources, fields, filters],
  );
  /**
   * Contacts are shown by default now.
   *
   * They used to be behind a click on the university's name, with nothing to
   * suggest there was anything behind it -- so the people who work there,
   * which is the point of the screen, were invisible. This set holds the ones
   * deliberately folded away rather than the one deliberately opened.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="btn btn-primary btn-sm"
        >
          {adding ? t("common.close") : t("crm.addSource")}
        </button>
      </div>

      {adding && <SourceForm onDone={() => setAdding(false)} />}

      <FilterBar
        fields={fields}
        state={filters}
        onChange={setFilters}
        shown={shown.length}
        total={sources.length}
      />

      {shown.length === 0 && sources.length > 0 && (
        <p className="empty">{t("filters.nothingMatches")}</p>
      )}

      <div className="flex flex-col gap-2.5">
        {shown.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            open={!collapsed.has(source.id)}
            onToggle={() => toggle(source.id)}
          />
        ))}
      </div>
    </>
  );
}

function SourceCard({
  source,
  open,
  onToggle,
}: {
  source: SourceRow;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [, retire] = useActionState(setSourceActive, initial);

  // The rotation is the point: whoever we spoke to longest ago is next, and
  // anyone never called comes first.
  const next = [...source.contacts]
    .filter((c) => c.active)
    .sort((a, b) => {
      const aAt = a.lastContactedAt ?? "";
      const bAt = b.lastContactedAt ?? "";
      if (aAt !== bAt) return aAt < bAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    })[0];

  return (
    <section className={`card ${source.active ? "" : "opacity-60"}`}>
      <header className="card-head">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-[14px] font-semibold hover:text-accent"
          >
            <span
              aria-hidden
              className={`text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}
            >
              ▶
            </span>
            {source.name}
          </button>
          {/* The whole conversation, which this card only ever shows the tip of. */}
          <Link
            href={`/crm/sources/${source.id}`}
            className="text-[12px] text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            {t("crm.openHistory")}
          </Link>
          <span className="badge">
            {source.type === "UNIVERSITY" ? t("crm.university") : t("crm.jobPortal")}
          </span>
          {/* Says there are people in here even when the card is folded. */}
          <span className="num text-[12px] text-muted">
            {source.contacts.length === 1
              ? t("crm.contactCountOne")
              : t("crm.contactCount", source.contacts.length)}
          </span>
          {source.due && source.active && (
            <span className="badge badge-warn">{t("crm.dueNow")}</span>
          )}
          {!source.active && <span className="badge">{t("crm.retired")}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn btn-sm"
          >
            {editing ? t("common.close") : t("common.edit")}
          </button>
          <form action={retire}>
            <input type="hidden" name="id" value={source.id} />
            <input
              type="hidden"
              name="active"
              value={source.active ? "false" : "true"}
            />
            <button type="submit" className="btn btn-sm btn-danger">
              {source.active ? t("crm.retire") : t("crm.bringBack")}
            </button>
          </form>
        </div>
      </header>

      <div className="card-body flex flex-wrap gap-x-6 gap-y-1.5 text-[12.5px]">
        <Fact label={t("crm.lastTalked")}>
          {source.lastContactedAt ?? (
            <span className="text-pause">{t("crm.neverTalked")}</span>
          )}
        </Fact>
        <Fact label={t("crm.offersUpdated")}>
          {source.offersUpdatedAt ?? "—"}
        </Fact>
        <Fact label={t("crm.candidates")}>{source.candidateCount}</Fact>
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
        {next && (
          <Fact label={t("crm.nextToCall")}>
            {next.name}
            {next.jobTitle && (
              <span className="text-muted"> · {next.jobTitle}</span>
            )}
          </Fact>
        )}
      </div>

      {source.notes && (
        <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
          {source.notes}
        </p>
      )}

      {editing && (
        <div className="border-t border-line p-4">
          <SourceForm source={source} onDone={() => setEditing(false)} />
        </div>
      )}

      {open && (
        <div className="border-t border-line p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">{t("crm.contacts")}</span>
            <button
              type="button"
              onClick={() => setAddingContact((v) => !v)}
              className="btn btn-sm"
            >
              {addingContact ? t("common.close") : t("crm.addContact")}
            </button>
          </div>

          {addingContact && (
            <div className="mb-3">
              <ContactForm
                sourceId={source.id}
                onDone={() => setAddingContact(false)}
              />
            </div>
          )}

          {source.contacts.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("crm.noContacts")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {source.contacts.map((contact) => (
                <ContactRowView
                  key={contact.id}
                  contact={contact}
                  sourceId={source.id}
                  isNext={next?.id === contact.id}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One person at a university, with everything you need before ringing them.
 *
 * This used to be a single line of unlabelled grey spans, which made the job
 * title, the phone number and the date all look like the same kind of thing.
 * Now the identity leads, the ways to reach them are links, and what was said
 * last time sits underneath -- which is the thing you actually want in front
 * of you when the phone starts ringing.
 */
function ContactRowView({
  contact,
  sourceId,
  isNext,
}: {
  contact: ContactRow;
  sourceId: string;
  isNext: boolean;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [calling, setCalling] = useState(false);
  const [, toggle] = useActionState(setContactActive, initial);

  if (editing) {
    return (
      <li className="rounded border border-line bg-surface-2 p-2.5">
        <ContactForm
          sourceId={sourceId}
          contact={contact}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className={`rounded border px-3 py-2.5 ${
        isNext && contact.active
          ? "border-accent bg-accent-wash"
          : "border-line bg-surface"
      } ${contact.active ? "" : "opacity-55"}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13.5px] font-semibold">{contact.name}</span>
        {contact.jobTitle && (
          <span className="text-[12.5px] text-muted">{contact.jobTitle}</span>
        )}
        {isNext && contact.active && (
          <span className="badge badge-accent">{t("crm.nextToCall")}</span>
        )}
        {!contact.active && <span className="badge">{t("crm.retired")}</span>}

        <span className="flex-1" />

        <div className="flex shrink-0 items-center gap-1.5">
          {contact.active && (
            <button
              type="button"
              onClick={() => setCalling(true)}
              className="btn btn-sm btn-primary"
            >
              {t("crm.logACall")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn btn-sm"
          >
            {t("common.edit")}
          </button>
          <form action={toggle}>
            <input type="hidden" name="id" value={contact.id} />
            <input
              type="hidden"
              name="active"
              value={contact.active ? "false" : "true"}
            />
            <button type="submit" className="btn btn-sm">
              {contact.active ? t("crm.retire") : t("crm.bringBack")}
            </button>
          </form>
        </div>
      </div>

      {/* Reachable in one tap rather than copied out by hand. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
        {contact.phone && (
          <a
            href={`tel:${contact.phone.replace(/\s+/g, "")}`}
            className="num text-accent hover:underline"
          >
            {contact.phone}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="text-accent hover:underline">
            {contact.email}
          </a>
        )}
        <span className="num text-faint">
          {contact.lastContactedAt
            ? `${t("crm.lastTalked")} ${contact.lastContactedAt}`
            : t("crm.neverTalked")}
        </span>
      </div>

      {contact.notes && (
        <p className="mt-1.5 rounded border border-line bg-surface-2 px-2 py-1.5 text-[12.5px] text-muted">
          {contact.notes}
        </p>
      )}

      {contact.lastCall && (
        <p className="mt-1.5 text-[12.5px]">
          <span className="eyebrow mr-1.5">{t("crm.lastTime")}</span>
          <span className="badge mr-1.5">
            {t(`crm.outcome${contact.lastCall.outcome}`)}
          </span>
          {contact.lastCall.notes || (
            <span className="text-faint">{t("crm.nothingSaid")}</span>
          )}
          <span className="num ml-1.5 text-faint">
            · {contact.lastCall.by}
          </span>
        </p>
      )}

      {calling && (
        <CallDialog
          contact={contact}
          sourceId={sourceId}
          onClose={() => setCalling(false)}
        />
      )}
    </li>
  );
}

/**
 * Ring somebody and write down what was said, in one place.
 *
 * Logging through the existing logSourceConversation means the two dates that
 * matter -- the university's and this person's -- roll forward in the same
 * transaction as the note, so the call list can never disagree with the log.
 */
function CallDialog({
  contact,
  sourceId,
  onClose,
}: {
  contact: ContactRow;
  sourceId: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [outcome, setOutcome] = useState<"TALKED" | "NO_ANSWER" | "LEFT_MESSAGE">(
    "TALKED",
  );
  const [notes, setNotes] = useState("");
  const [state, submit, pending] = useActionState(
    async (p: CrmState, f: FormData) => {
      const r = await logSourceConversation(p, f);
      if (r.ok) onClose();
      return r;
    },
    initial,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  // Only a conversation needs writing down; nobody picking up speaks for
  // itself. Mirrors the rule the action enforces server-side.
  const ready = outcome !== "TALKED" || notes.trim().length >= 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-title"
        className="w-full max-w-[440px] rounded-[10px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)]"
      >
        <p className="eyebrow">{t("crm.logACall")}</p>
        <h2 id="call-title" className="mt-1 text-[16px] font-semibold">
          {contact.name}
        </h2>
        <p className="mt-0.5 mb-3 text-[12.5px] text-muted">
          {contact.jobTitle}
          {contact.phone && (
            <>
              {contact.jobTitle ? " · " : ""}
              <a
                href={`tel:${contact.phone.replace(/\s+/g, "")}`}
                className="num text-accent hover:underline"
              >
                {contact.phone}
              </a>
            </>
          )}
        </p>

        {contact.lastCall && (
          <p className="notice notice-warn mb-3 text-[12.5px]">
            <span className="eyebrow mb-0.5 block">{t("crm.lastTime")}</span>
            {contact.lastCall.notes || t("crm.nothingSaid")}
            <span className="num mt-0.5 block text-faint">
              {contact.lastCall.at} · {contact.lastCall.by}
            </span>
          </p>
        )}

        <form action={submit}>
          <input type="hidden" name="sourceId" value={sourceId} />
          <input type="hidden" name="contactId" value={contact.id} />
          <input type="hidden" name="outcome" value={outcome} />

          <p className="field-label">{t("crm.howDidItGo")}</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(["TALKED", "LEFT_MESSAGE", "NO_ANSWER"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={outcome === id}
                onClick={() => setOutcome(id)}
                className={
                  outcome === id
                    ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                    : "rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                }
              >
                {t(`crm.outcome${id}`)}
              </button>
            ))}
          </div>

          <label htmlFor="call-notes" className="field-label">
            {t("crm.whatWasSaid")}
          </label>
          <textarea
            id="call-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            autoFocus
            placeholder={t("crm.callPlaceholder")}
            className="field min-h-[80px] resize-y"
          />

          <p
            className={`mt-2 mb-3.5 min-h-4 text-[11.5px] ${
              state.error ? "text-stall" : "text-muted"
            }`}
          >
            {state.error ?? t("crm.rollsTheDate")}
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="btn btn-primary"
            >
              {pending ? t("common.saving") : t("crm.saveCall")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SourceForm({
  source,
  onDone,
}: {
  source?: SourceRow;
  onDone: () => void;
}) {
  const { t } = useT();
  const [state, submit, pending] = useActionState(
    async (p: CrmState, f: FormData) => {
      const r = await saveSource(p, f);
      if (r.ok) onDone();
      return r;
    },
    initial,
  );

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      {source && <input type="hidden" name="id" value={source.id} />}

      <label className="min-w-52 flex-1 text-[11px]">
        <span className="field-label">{t("crm.sourceName")}</span>
        <input
          name="name"
          required
          defaultValue={source?.name}
          autoFocus={!source}
          className="field"
        />
      </label>

      <label className="text-[11px]">
        <span className="field-label">{t("crm.sourceType")}</span>
        <select name="type" defaultValue={source?.type ?? "UNIVERSITY"} className="field">
          <option value="UNIVERSITY">{t("crm.university")}</option>
          <option value="JOB_PORTAL">{t("crm.jobPortal")}</option>
        </select>
      </label>

      <label className="text-[11px]">
        <span className="field-label">{t("crm.offersUpdated")}</span>
        <input
          type="date"
          name="offersUpdatedAt"
          defaultValue={source?.offersUpdatedAt ?? ""}
          className="field num"
        />
      </label>

      {/* The place's own line and address, for when you have no name to ask
          for -- or the person you had has moved on. */}
      <label className="min-w-40 flex-1 text-[11px]">
        <span className="field-label">{t("crm.switchboard")}</span>
        <input
          name="phone"
          defaultValue={source?.phone ?? ""}
          className="field num"
        />
      </label>

      <label className="min-w-52 flex-1 text-[11px]">
        <span className="field-label">{t("crm.generalEmail")}</span>
        <input
          type="email"
          name="email"
          defaultValue={source?.email ?? ""}
          className="field"
        />
      </label>

      <label className="w-full text-[11px]">
        <span className="field-label">{t("crm.notes")}</span>
        <textarea
          name="notes"
          defaultValue={source?.notes ?? ""}
          className="field min-h-[52px] resize-y"
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? t("common.saving") : t("common.save")}
      </button>
      <button type="button" onClick={onDone} className="btn">
        {t("common.cancel")}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-[12px] text-stall">
          {state.error}
        </p>
      )}
    </form>
  );
}

function ContactForm({
  sourceId,
  contact,
  onDone,
}: {
  sourceId: string;
  contact?: ContactRow;
  onDone: () => void;
}) {
  const { t } = useT();
  const [state, submit, pending] = useActionState(
    async (p: CrmState, f: FormData) => {
      const r = await saveContact(p, f);
      if (r.ok) onDone();
      return r;
    },
    initial,
  );

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="sourceId" value={sourceId} />
      {contact && <input type="hidden" name="id" value={contact.id} />}

      {/* This said crm.sourceName -- a copy-paste that happened to render the
          right word in both languages and would have broken the moment either
          was reworded. */}
      <label className="min-w-40 flex-1 text-[11px]">
        <span className="field-label">{t("crm.contactName")}</span>
        <input name="name" required defaultValue={contact?.name} autoFocus className="field" />
      </label>
      <label className="min-w-36 flex-1 text-[11px]">
        <span className="field-label">{t("crm.jobTitle")}</span>
        <input name="jobTitle" defaultValue={contact?.jobTitle ?? ""} className="field" />
      </label>
      <label className="text-[11px]">
        <span className="field-label">{t("crm.phone")}</span>
        <input name="phone" defaultValue={contact?.phone ?? ""} className="field num w-32" />
      </label>
      <label className="min-w-44 flex-1 text-[11px]">
        <span className="field-label">{t("crm.email")}</span>
        <input name="email" type="email" defaultValue={contact?.email ?? ""} className="field" />
      </label>

      <label className="w-full text-[11px]">
        <span className="field-label">{t("crm.contactNotes")}</span>
        <textarea
          name="notes"
          defaultValue={contact?.notes ?? ""}
          placeholder={t("crm.contactNotesEg")}
          className="field min-h-[44px] resize-y"
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
        {pending ? t("common.saving") : t("common.save")}
      </button>
      <button type="button" onClick={onDone} className="btn btn-sm">
        {t("common.cancel")}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-[12px] text-stall">
          {state.error}
        </p>
      )}
    </form>
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
    <span className="flex items-baseline gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className="num">{children}</span>
    </span>
  );
}
