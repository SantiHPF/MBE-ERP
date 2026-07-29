import { addMonths } from "@/lib/people/onboarding";

/**
 * Who is owed a call, and why.
 *
 * Pure on purpose: these are the rules the whole CRM turns on, and they are
 * worth being able to test without a database. The I/O lives in sync.ts, the
 * same split as onboarding.ts / onboarding-db.ts.
 */

/** Universities and portals alike: every two months, for everybody. */
export const SOURCE_INTERVAL_MONTHS = 2;

export type SourceInput = {
  id: string;
  name: string;
  active: boolean;
  lastContactedAt: Date | null;
  contacts: {
    id: string;
    name: string;
    jobTitle: string | null;
    phone: string | null;
    active: boolean;
    lastContactedAt: Date | null;
  }[];
};

export type CandidateInput = {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  stage: string;
  lastAttemptedAt: Date | null;
};

export type SourceCall = {
  sourceId: string;
  sourceName: string;
  /** Whoever is next in the rotation, or null when nobody is on record yet. */
  contactId: string | null;
  contactName: string | null;
  contactJobTitle: string | null;
  phone: string | null;
  lastContactedAt: Date | null;
  /** True when we have never spoken to them at all. */
  neverContacted: boolean;
};

export type CandidateCall = {
  candidateId: string;
  name: string;
  phone: string | null;
};

/**
 * The next person to ring at a source: whoever we spoke to longest ago, with
 * anyone never contacted first.
 *
 * This is what makes "somebody different each time" fall out on its own --
 * logging a call moves that person to the back of the queue, so the next cycle
 * reaches the next one along. Ties break on id so the answer is stable and the
 * same input never produces a different suggestion.
 */
export function nextContact(source: SourceInput): SourceInput["contacts"][number] | null {
  const usable = source.contacts.filter((c) => c.active);
  if (usable.length === 0) return null;

  return [...usable].sort((a, b) => {
    const aAt = a.lastContactedAt?.getTime() ?? -Infinity;
    const bAt = b.lastContactedAt?.getTime() ?? -Infinity;
    if (aAt !== bAt) return aAt - bAt;
    return a.id < b.id ? -1 : 1;
  })[0];
}

/** Has this source gone long enough without a word? */
export function sourceIsDue(source: SourceInput, today: Date): boolean {
  if (!source.active) return false;
  if (!source.lastContactedAt) return true;
  return addMonths(source.lastContactedAt, SOURCE_INTERVAL_MONTHS) <= today;
}

export function sourcesDue(sources: SourceInput[], today: Date): SourceCall[] {
  return sources
    .filter((source) => sourceIsDue(source, today))
    .map((source) => {
      const contact = nextContact(source);
      return {
        sourceId: source.id,
        sourceName: source.name,
        contactId: contact?.id ?? null,
        contactName: contact?.name ?? null,
        contactJobTitle: contact?.jobTitle ?? null,
        phone: contact?.phone ?? null,
        lastContactedAt: source.lastContactedAt,
        neverContacted: source.lastContactedAt === null,
      };
    })
    // Longest ignored first: if the day runs out, it runs out on the ones we
    // spoke to most recently.
    .sort((a, b) => {
      const aAt = a.lastContactedAt?.getTime() ?? -Infinity;
      const bAt = b.lastContactedAt?.getTime() ?? -Infinity;
      if (aAt !== bAt) return aAt - bAt;
      return a.sourceName.localeCompare(b.sourceName);
    });
}

/**
 * Candidates owed a call: the ones sitting in CALL who have not been reached
 * for yet.
 *
 * One attempt is the rule. Trying at all -- whether they answered, whether we
 * left a message -- sets lastAttemptedAt and takes them off this list, and a
 * candidate who did not answer is marked inactive by the caller.
 */
export function candidatesDue(
  candidates: CandidateInput[],
  _today: Date,
): CandidateCall[] {
  return candidates
    .filter((c) => c.active && c.stage === "CALL" && c.lastAttemptedAt === null)
    .map((c) => ({ candidateId: c.id, name: c.name, phone: c.phone }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
