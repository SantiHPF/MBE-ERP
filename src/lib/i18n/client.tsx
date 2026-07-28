"use client";

import { createContext, useContext, useMemo } from "react";
import { DICTIONARIES, translate, type Dictionary, type Locale } from "./dictionary";

const LocaleContext = createContext<{ locale: Locale; dict: Dictionary }>({
  locale: "ES",
  dict: DICTIONARIES.ES,
});

/** Wraps the app so client components can translate without a round trip. */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, dict: DICTIONARIES[locale] }),
    [locale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useT() {
  const { dict, locale } = useContext(LocaleContext);
  return {
    locale,
    t: (key: string, ...args: (string | number)[]) =>
      translate(dict, key, ...args),
  };
}
