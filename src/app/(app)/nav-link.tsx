"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

/**
 * One link, in either shell: the sidebar from `lg` up, and the wrapped
 * horizontal row below it. The current page is marked with a bar that sits
 * under the link when the nav runs across and beside it when it runs down --
 * an underline tied to the bottom edge of a row means nothing in a column.
 */
export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2 rounded-[var(--radius-nav)] px-3 py-1.5 text-[13px] transition-colors lg:px-2 lg:text-cell ${
        active
          ? "font-semibold text-ink lg:bg-accent-wash lg:text-accent"
          : "text-muted hover:bg-surface-2 hover:text-ink lg:text-ink/80"
      }`}
    >
      {/* Slightly held back, so a row of nineteen glyphs reads as texture
          under the labels rather than competing with them. */}
      <Icon name={icon} className="shrink-0 opacity-85" />
      {children}
      {active && (
        /* Inset from the item's own top and bottom rather than run edge to
           edge: a rail the full height of the row reads as a border on the
           column, not a mark on the item. */
        <span
          className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-accent
                     lg:inset-x-auto lg:top-1.5 lg:bottom-1.5 lg:left-0 lg:h-auto lg:w-0.5"
        />
      )}
    </Link>
  );
}
