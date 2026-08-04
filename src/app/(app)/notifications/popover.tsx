"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import type { NotificationRow } from "@/lib/notifications/feed";
import { markSeen } from "@/lib/notifications/actions";

const TONE: Record<NotificationRow["tone"], string> = {
  accent: "var(--color-accent)",
  pause: "var(--color-pause)",
  stall: "var(--color-stall)",
};

export function Popover({
  rows,
  onNavigate,
}: {
  rows: NotificationRow[];
  onNavigate: () => void;
}) {
  const { t } = useT();

  return (
    <div className="popover absolute right-0 top-[calc(100%+8px)] z-50 w-[348px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className="eyebrow">{t("notifications.title")}</span>
        <form action={markSeen}>
          <button
            type="submit"
            className="text-tiny font-medium text-accent hover:underline"
          >
            {t("notifications.markRead")}
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        /* One sentence, never an illustration. */
        <p className="px-3.5 py-6 text-center text-small text-muted">
          {t("notifications.empty")}
        </p>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-line last:border-b-0">
              <Link
                href={row.href}
                onClick={onNavigate}
                className="flex gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-surface-2"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TONE[row.tone] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small font-[550]">
                    {t(row.titleKey, ...row.titleArgs)}
                  </span>
                  {/* The company's own words, never translated. */}
                  <span className="block truncate text-tiny text-muted">
                    {row.body}
                  </span>
                </span>
                <span className="num shrink-0 text-mini text-faint">
                  {row.at.slice(11, 16)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
