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
      className={
        active
          ? "rounded-md bg-[var(--color-canvas)] px-3 py-1.5 font-medium text-[var(--color-accent)]"
          : "rounded-md px-3 py-1.5 text-[var(--color-muted)] hover:bg-[var(--color-canvas)]"
      }
    >
      {children}
    </Link>
  );
}
