"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { Feed } from "@/lib/notifications/feed";
import { Icon } from "../icons";
import { Popover } from "./popover";

/**
 * `zone` arrives as a prop rather than being read here because
 * `scheduleZone()` reads `process.env.SCHEDULE_TIMEZONE` and so is
 * server-only -- it cannot run in this client component. It is threaded
 * down from the server layout (see layout.tsx) for the same reason
 * NowProvider takes it: the company's day is decided in Madrid, not in
 * whatever timezone the server process happens to be in.
 */
export function Bell({ feed, zone }: { feed: Feed; zone: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Navigating away closes it -- the popover is a signpost, not a window.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("common.notifications")}
        aria-expanded={open}
        className="relative flex h-[31px] w-[31px] items-center justify-center rounded-[var(--radius-control)]
                   border border-line-strong text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="bell" />
        {feed.unread > 0 && (
          /* Ringed in the surface colour so it reads as sitting on the bell
             rather than beside it. */
          <span
            className="num absolute -right-1.5 -top-1.5 flex h-[15px] min-w-[15px] items-center
                       justify-center rounded-full bg-stall px-1 text-[9.5px] font-bold text-white
                       ring-2 ring-surface"
          >
            {feed.unread}
          </span>
        )}
      </button>

      {open && (
        <Popover rows={feed.rows} zone={zone} onNavigate={() => setOpen(false)} />
      )}
    </div>
  );
}
