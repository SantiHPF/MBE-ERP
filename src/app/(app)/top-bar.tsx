"use client";

import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { crumbFor } from "./breadcrumb";
import { Icon } from "./icons";

/**
 * The strip above every page.
 *
 * A client component because it names the page from the pathname, which is
 * the one thing the server layout cannot know -- the layout does not
 * re-render between navigations, so a server-resolved title would freeze on
 * whatever page you first landed on.
 *
 * The right-hand slot is a prop rather than a hard-coded pair: the bell needs
 * server-fetched counts and the palette needs a server action, and neither
 * belongs inside a component whose job is the title.
 */
export function TopBar({
  onOpenSearch,
  children,
}: {
  // Optional for now: layout.tsx is a server component and cannot pass a
  // callback, and the palette that owns this state arrives in Task 12. That
  // task makes the prop required again and removes the button's `disabled`.
  onOpenSearch?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useT();
  const crumb = crumbFor(usePathname());

  return (
    <header
      className="sticky top-0 z-30 flex h-[57px] items-center gap-4 border-b border-line
                 bg-surface/92 px-6 backdrop-blur-[8px] lg:px-8"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        {/* An unknown route gets no title rather than a confident wrong one. */}
        {crumb && (
          <>
            <h2 className="truncate text-body font-semibold">
              {t(crumb.titleKey)}
            </h2>
            {crumb.trailKey && (
              <span className="truncate text-tiny text-faint">
                {t(crumb.trailKey)}
              </span>
            )}
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/*
          A button that looks like a field. It opens the palette rather than
          accepting text, so making it an <input> would promise typing that
          goes nowhere.
        */}
        <button
          type="button"
          onClick={onOpenSearch}
          disabled={!onOpenSearch}
          aria-label={t("search.open")}
          className="hidden h-[31px] w-[224px] items-center gap-2 rounded-[var(--radius-control)]
                     border border-line-strong px-2.5 text-left text-small text-faint
                     transition-colors hover:border-faint sm:flex"
        >
          <Icon name="search" className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t("search.placeholder")}</span>
          <kbd className="num shrink-0 rounded border border-line px-1 text-mini text-faint">
            {t("search.hint")}
          </kbd>
        </button>
        {children}
      </div>
    </header>
  );
}
