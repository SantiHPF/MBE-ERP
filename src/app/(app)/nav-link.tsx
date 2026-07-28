"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
      className={`relative rounded-md px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? "font-semibold text-ink"
          : "text-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
      {/* An underline marks the current page without the pill fighting the
          buttons elsewhere on the row for attention. */}
      {active && (
        <span className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-accent" />
      )}
    </Link>
  );
}
