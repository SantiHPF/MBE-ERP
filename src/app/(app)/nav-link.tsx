"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One link, in either shell: the sidebar from `lg` up, and the wrapped
 * horizontal row below it. The current page is marked with a bar that sits
 * under the link when the nav runs across and beside it when it runs down --
 * an underline tied to the bottom edge of a row means nothing in a column.
 */
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      /* Links sit a step above the group headings above them: larger, darker
         and sentence case, so the two never read as the same kind of thing. */
      className={`relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors lg:px-2.5 lg:text-[13.5px] ${
        active
          ? "font-semibold text-ink lg:bg-accent-wash lg:text-accent"
          : "text-muted hover:bg-surface-2 hover:text-ink lg:text-ink/80"
      }`}
    >
      {children}
      {active && (
        <span
          className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-accent
                     lg:inset-x-auto lg:inset-y-1 lg:left-0 lg:h-auto lg:w-0.5"
        />
      )}
    </Link>
  );
}
