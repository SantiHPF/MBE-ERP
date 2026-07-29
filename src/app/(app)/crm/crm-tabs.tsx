"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The two lists, side by side. Same active treatment as the sidebar. */
export function CrmTabs({
  sources,
  candidates,
}: {
  sources: string;
  candidates: string;
}) {
  const pathname = usePathname();

  const tabs = [
    { href: "/crm/sources", label: sources },
    { href: "/crm/candidates", label: candidates },
  ];

  return (
    <nav className="mb-5 flex gap-1 border-b border-line" aria-label="CRM">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative px-3 py-2 text-[13px] transition-colors ${
              active
                ? "font-semibold text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {tab.label}
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
