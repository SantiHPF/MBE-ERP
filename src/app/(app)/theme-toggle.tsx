"use client";

import { useActionState } from "react";
import { setTheme } from "@/lib/theme/actions";
import { nextTheme, type Theme } from "@/lib/theme/theme";
import { useT } from "@/lib/i18n/client";

/**
 * One button in the sidebar footer, cycling system -> light -> dark.
 *
 * It shows the icon of the state you are *in*, not the one you are going to,
 * because with three modes an icon that promises the next one tells you
 * nothing about where you are. What it does next is in the title and the
 * accessible name, which is where a promise belongs.
 */
export function ThemeToggle({ current }: { current: Theme }) {
  const [, submit, pending] = useActionState(setTheme, {});
  const { t } = useT();

  const label = t(`theme.${current.toLowerCase()}`);
  const upcoming = t(`theme.${nextTheme(current).toLowerCase()}`);

  return (
    <form action={submit} className="shrink-0">
      <input type="hidden" name="theme" value={nextTheme(current)} />
      <button
        type="submit"
        disabled={pending}
        title={`${t("theme.showing", label)} · ${t("theme.switchTo", upcoming)}`}
        aria-label={`${t("theme.showing", label)} · ${t("theme.switchTo", upcoming)}`}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <ThemeIcon theme={current} />
      </button>
    </form>
  );
}

/**
 * Sun, moon, and a half-filled disc for "whatever the computer says" -- the
 * usual shorthand, and the only one of the three that has to be invented.
 * Inline so nothing is fetched and both halves inherit currentColor.
 */
function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (theme === "LIGHT") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" />
      </svg>
    );
  }

  if (theme === "DARK") {
    return (
      <svg {...common}>
        <path d="M13.5 9.6A5.9 5.9 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
