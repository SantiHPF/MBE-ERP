import { describe, expect, it } from "vitest";
import {
  candidatesDue,
  nextContact,
  sourceIsDue,
  sourcesDue,
  type CandidateInput,
  type SourceInput,
} from "./due";

const TODAY = new Date(Date.UTC(2026, 6, 28)); // 28 July 2026
const daysAgo = (n: number) =>
  new Date(Date.UTC(2026, 6, 28 - n));

function contact(
  id: string,
  over: Partial<SourceInput["contacts"][number]> = {},
): SourceInput["contacts"][number] {
  return {
    id,
    name: id,
    jobTitle: null,
    phone: null,
    active: true,
    lastContactedAt: null,
    ...over,
  };
}

function source(over: Partial<SourceInput> = {}): SourceInput {
  return {
    id: "s1",
    name: "Universidad de Sevilla",
    active: true,
    lastContactedAt: null,
    contacts: [],
    ...over,
  };
}

function candidate(over: Partial<CandidateInput> = {}): CandidateInput {
  return {
    id: "c1",
    name: "Marta",
    phone: null,
    active: true,
    stage: "CALL",
    lastAttemptedAt: null,
    ...over,
  };
}

describe("sourceIsDue", () => {
  it("is due when we have never spoken to them", () => {
    expect(sourceIsDue(source({ lastContactedAt: null }), TODAY)).toBe(true);
  });

  it("is due at two months", () => {
    // Exactly the interval counts as due -- waiting another day serves nobody.
    expect(
      sourceIsDue(source({ lastContactedAt: new Date(Date.UTC(2026, 4, 28)) }), TODAY),
    ).toBe(true);
  });

  it("is not due at seven weeks", () => {
    expect(sourceIsDue(source({ lastContactedAt: daysAgo(49) }), TODAY)).toBe(false);
  });

  it("is due at nine weeks", () => {
    expect(sourceIsDue(source({ lastContactedAt: daysAgo(63) }), TODAY)).toBe(true);
  });

  it("clamps a short month rather than overshooting", () => {
    // 31 December plus two months is 28 February, not 3 March. The reused
    // addMonths already handles this; the test pins it for the CRM too.
    const dec31 = new Date(Date.UTC(2025, 11, 31));
    expect(sourceIsDue(source({ lastContactedAt: dec31 }), new Date(Date.UTC(2026, 1, 28)))).toBe(true);
    expect(sourceIsDue(source({ lastContactedAt: dec31 }), new Date(Date.UTC(2026, 1, 27)))).toBe(false);
  });

  it("leaves a retired source alone however long it has been", () => {
    expect(sourceIsDue(source({ active: false, lastContactedAt: null }), TODAY)).toBe(false);
  });
});

describe("nextContact", () => {
  it("picks whoever we spoke to longest ago", () => {
    const s = source({
      contacts: [
        contact("ana", { lastContactedAt: daysAgo(10) }),
        contact("luis", { lastContactedAt: daysAgo(90) }),
        contact("eva", { lastContactedAt: daysAgo(40) }),
      ],
    });
    expect(nextContact(s)?.id).toBe("luis");
  });

  it("prefers somebody we have never called", () => {
    const s = source({
      contacts: [
        contact("ana", { lastContactedAt: daysAgo(200) }),
        contact("nuevo", { lastContactedAt: null }),
      ],
    });
    expect(nextContact(s)?.id).toBe("nuevo");
  });

  /** The whole point: a different person each cycle. */
  it("moves on to the next person once the first has been called", () => {
    const before = source({
      contacts: [contact("ana"), contact("luis")],
    });
    expect(nextContact(before)?.id).toBe("ana");

    const after = source({
      contacts: [
        contact("ana", { lastContactedAt: TODAY }),
        contact("luis", { lastContactedAt: null }),
      ],
    });
    expect(nextContact(after)?.id).toBe("luis");
  });

  it("comes back round to the first once everybody has had a turn", () => {
    const s = source({
      contacts: [
        contact("ana", { lastContactedAt: daysAgo(120) }),
        contact("luis", { lastContactedAt: daysAgo(60) }),
      ],
    });
    expect(nextContact(s)?.id).toBe("ana");
  });

  it("skips people who have left", () => {
    const s = source({
      contacts: [
        contact("ana", { active: false, lastContactedAt: null }),
        contact("luis", { lastContactedAt: daysAgo(5) }),
      ],
    });
    expect(nextContact(s)?.id).toBe("luis");
  });

  it("returns nothing when there is nobody on record", () => {
    expect(nextContact(source({ contacts: [] }))).toBeNull();
  });
});

describe("sourcesDue", () => {
  it("names the person to ring alongside the university", () => {
    const [call] = sourcesDue(
      [source({ contacts: [contact("ana", { jobTitle: "Career services", phone: "600" })] })],
      TODAY,
    );

    expect(call.sourceName).toBe("Universidad de Sevilla");
    expect(call.contactName).toBe("ana");
    expect(call.contactJobTitle).toBe("Career services");
    expect(call.phone).toBe("600");
    expect(call.neverContacted).toBe(true);
  });

  it("still raises the call when no contacts are on record yet", () => {
    // Somebody has to go and find a name; silently skipping it is how a
    // university goes a year without being called.
    const [call] = sourcesDue([source({ contacts: [] })], TODAY);
    expect(call.sourceId).toBe("s1");
    expect(call.contactId).toBeNull();
  });

  it("puts the longest ignored first", () => {
    const calls = sourcesDue(
      [
        source({ id: "a", name: "A", lastContactedAt: daysAgo(70) }),
        source({ id: "b", name: "B", lastContactedAt: null }),
        source({ id: "c", name: "C", lastContactedAt: daysAgo(200) }),
      ],
      TODAY,
    );
    expect(calls.map((c) => c.sourceId)).toEqual(["b", "c", "a"]);
  });

  it("leaves out the ones spoken to recently", () => {
    expect(
      sourcesDue([source({ lastContactedAt: daysAgo(3) })], TODAY),
    ).toEqual([]);
  });
});

describe("candidatesDue", () => {
  it("raises a call for somebody sitting in Call", () => {
    expect(candidatesDue([candidate()], TODAY)).toEqual([
      { candidateId: "c1", name: "Marta", phone: null },
    ]);
  });

  it("ignores every other stage", () => {
    const others = ["APPLIED", "PROCESS", "TEST", "OFFER", "HIRED"].map((stage) =>
      candidate({ id: stage, stage }),
    );
    expect(candidatesDue(others, TODAY)).toEqual([]);
  });

  /** One attempt is the rule -- answered or not, we do not chase. */
  it("drops them once they have been reached for", () => {
    expect(candidatesDue([candidate({ lastAttemptedAt: TODAY })], TODAY)).toEqual([]);
  });

  it("ignores anybody already inactive", () => {
    expect(candidatesDue([candidate({ active: false })], TODAY)).toEqual([]);
  });

  it("lists them by name so the order does not wander", () => {
    const due = candidatesDue(
      [
        candidate({ id: "1", name: "Zoe" }),
        candidate({ id: "2", name: "Ana" }),
        candidate({ id: "3", name: "Marta" }),
      ],
      TODAY,
    );
    expect(due.map((c) => c.name)).toEqual(["Ana", "Marta", "Zoe"]);
  });
});
