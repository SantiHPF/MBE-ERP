import "server-only";
import { getSessionUser } from "@/lib/auth/session";
import { DICTIONARIES, translate, type Dictionary, type Locale } from "./dictionary";

/**
 * Translation for server components. Reads the signed-in person's choice,
 * falling back to Spanish, which is what the company speaks.
 */
export async function getT(): Promise<{
  t: (key: string, ...args: (string | number)[]) => string;
  locale: Locale;
  dict: Dictionary;
}> {
  const user = await getSessionUser();
  const locale = (user?.locale ?? "ES") as Locale;
  const dict = DICTIONARIES[locale];
  return {
    locale,
    dict,
    t: (key, ...args) => translate(dict, key, ...args),
  };
}

/**
 * Language for pages seen before signing in.
 *
 * There is no account to read a preference from, so this defaults to Spanish
 * -- what the company speaks -- and only switches to English when the browser
 * explicitly asks for it ahead of Spanish.
 */
export async function getLoginT(): Promise<{
  t: (key: string, ...args: (string | number)[]) => string;
  locale: Locale;
}> {
  const { headers } = await import("next/headers");
  const accept = (await headers()).get("accept-language") ?? "";

  const wantsEnglish = accept
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((l) => l.tag.startsWith("en") || l.tag.startsWith("es"))
    .sort((a, b) => b.q - a.q)[0]
    ?.tag.startsWith("en");

  const locale: Locale = wantsEnglish ? "EN" : "ES";
  const dict = DICTIONARIES[locale];
  return { locale, t: (key, ...args) => translate(dict, key, ...args) };
}
