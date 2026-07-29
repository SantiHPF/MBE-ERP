import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARIES, translate, type Locale } from "./dictionary";

/**
 * translate() falls back to returning the key when it is missing, which keeps
 * a typo from crashing a page but also means TypeScript cannot catch one --
 * the interface just shows "errors.taskGone" to the user. These tests are what
 * actually holds the dictionary together.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Every t("...") / message("...") / fail("...") key used in the app. */
function usedKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pattern = /\b(?:t|message|fail)\(\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"/g;

  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      found.set(key, [...(found.get(key) ?? []), file]);
    }
  }
  return found;
}

function lookup(locale: Locale, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      DICTIONARIES[locale],
    );
}

describe("dictionary", () => {
  const keys = usedKeys();

  it("finds the keys the app actually uses", () => {
    // A guard on the regex itself: if this collapses, the tests below pass
    // vacuously and stop protecting anything.
    expect(keys.size).toBeGreaterThan(100);
  });

  it.each(["EN", "ES"] as const)("has every used key in %s", (locale) => {
    const missing = [...keys.entries()]
      .filter(([key]) => typeof lookup(locale, key) !== "string")
      .map(([key, files]) => `${key} (used in ${files[0]})`);

    expect(missing).toEqual([]);
  });

  it("gives EN and ES the same shape", () => {
    const paths = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([k, v]) =>
            paths(v, prefix ? `${prefix}.${k}` : k),
          )
        : [prefix];

    expect(paths(DICTIONARIES.ES).sort()).toEqual(paths(DICTIONARIES.EN).sort());
  });

  it("keeps the same placeholders in both languages", () => {
    const slots = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();

    const mismatched = [...keys.keys()].filter((key) => {
      const en = lookup("EN", key);
      const es = lookup("ES", key);
      if (typeof en !== "string" || typeof es !== "string") return false;
      return String(slots(en)) !== String(slots(es));
    });

    expect(mismatched).toEqual([]);
  });

  /**
   * Keys built from a variable -- t(`theme.${x}`) -- are invisible to the
   * scan above, because the regex only sees string literals. Those are
   * exactly the keys nothing else would catch, so the families are listed
   * here by hand. Add to this when you add another computed key.
   */
  const computed = [
    ...["system", "light", "dark"].map((x) => `theme.${x}`),
    ...["SICK", "HOLIDAY", "PERSONAL", "OTHER"].map(
      (x) => `calendar.categories.${x}`,
    ),
    ...["nthLast", "nth1", "nth2", "nth3", "nth4"].map((x) => `catalogue.${x}`),
    ...["RECURRING", "CATALOGUE", "SHEET", "MEETING", "MANUAL", "CRM"].map(
      (x) => `origin.${x}`,
    ),
    ...[
      "BREAK",
      "WAITING_CLIENT",
      "WAITING_INTERNAL",
      "MEETING",
      "INTERRUPTION",
      "OTHER",
    ].map((x) => `pause.reasons.${x}`),
    ...[
      "LOGIN",
      "TASK_START",
      "TASK_END",
      "LOGOUT",
      "DAY_CLOSED",
      "AUTO_CLOSE",
      "MANUAL",
    ].map((x) => `attendance.source${x}`),
    ...["TALKED", "NO_ANSWER", "LEFT_MESSAGE"].map((x) => `crm.outcome${x}`),
  ];

  it.each(["EN", "ES"] as const)("has every computed key in %s", (locale) => {
    const missing = computed.filter(
      (key) => typeof lookup(locale, key) !== "string",
    );
    expect(missing).toEqual([]);
  });

  it("fills placeholders in order", () => {
    expect(translate(DICTIONARIES.EN, "errors.tookItFirst", "Ana")).toBe(
      "Ana took that one first.",
    );
    expect(
      translate(DICTIONARIES.ES, "errors.alreadyHasIt", "Ana", "Sucesos"),
    ).toBe("Ana ya tiene Sucesos ese día.");
  });
});
