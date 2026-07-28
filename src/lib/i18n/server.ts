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
