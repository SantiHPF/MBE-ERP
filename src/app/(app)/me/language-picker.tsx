"use client";

import { useActionState } from "react";
import { setLocale } from "@/lib/i18n/actions";
import { LOCALE_NAMES, type Locale } from "@/lib/i18n/dictionary";
import { useT } from "@/lib/i18n/client";

export function LanguagePicker({ current }: { current: Locale }) {
  const [, submit, pending] = useActionState(setLocale, {});
  const { t } = useT();

  return (
    <section className="card">
      <header className="card-head">
        <span className="eyebrow">{t("profile.language")}</span>
      </header>
      <div className="card-body">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(LOCALE_NAMES) as Locale[]).map((code) => (
            <form key={code} action={submit}>
              <input type="hidden" name="locale" value={code} />
              <button
                type="submit"
                disabled={pending || code === current}
                aria-pressed={code === current}
                className={
                  code === current
                    ? "btn btn-primary"
                    : "btn"
                }
              >
                {LOCALE_NAMES[code]}
              </button>
            </form>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">{t("profile.languageHint")}</p>
      </div>
    </section>
  );
}
