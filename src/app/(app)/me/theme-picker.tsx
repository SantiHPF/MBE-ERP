"use client";

import { useActionState } from "react";
import { setTheme } from "@/lib/theme/actions";
import { THEMES, type Theme } from "@/lib/theme/theme";
import { useT } from "@/lib/i18n/client";

/**
 * The named version of the sidebar toggle. Built to match LanguagePicker, so
 * the two settings on this page read as the same kind of control -- one form
 * per option rather than a select, because a choice of three is quicker to
 * make than to open.
 */
export function ThemePicker({ current }: { current: Theme }) {
  const [, submit, pending] = useActionState(setTheme, {});
  const { t } = useT();

  return (
    <section className="card">
      <header className="card-head">
        <span className="eyebrow">{t("profile.appearance")}</span>
      </header>
      <div className="card-body">
        <div className="flex flex-wrap gap-1.5">
          {THEMES.map((theme) => (
            <form key={theme} action={submit}>
              <input type="hidden" name="theme" value={theme} />
              <button
                type="submit"
                disabled={pending || theme === current}
                aria-pressed={theme === current}
                className={theme === current ? "btn btn-primary" : "btn"}
              >
                {t(`theme.${theme.toLowerCase()}`)}
              </button>
            </form>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">{t("profile.appearanceHint")}</p>
      </div>
    </section>
  );
}
