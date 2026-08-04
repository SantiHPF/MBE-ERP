"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { search } from "@/lib/search/actions";
import type { SearchHit, SearchKind } from "@/lib/search/rank";

const GROUP_KEY: Record<SearchKind, string> = {
  task: "search.tasks",
  person: "search.people",
  p1n: "search.p1ns",
};

/**
 * ⌘K.
 *
 * Holds the open state and hands an `open()` down to whatever should trigger
 * it, so the top bar's search button does not have to own a dialog and the
 * keyboard shortcut does not have to live in a component about titles.
 */
export function CommandPalette({
  children,
}: {
  children: (open: () => void) => React.ReactNode;
}) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /*
   * Debounced, because this fires a server action per keystroke otherwise.
   * 180ms is under the threshold where a list feels laggy and well over the
   * gap between two keys in a word.
   */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q === "") {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      startTransition(async () => setHits(await search(q)));
    }, 180);
    return () => clearTimeout(id);
  }, [query, open]);

  // A fresh box every time, rather than yesterday's search waiting in it.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      {children(() => setOpen(true))}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-6 pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("search.open")}
            className="popover w-full max-w-[520px] overflow-hidden"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              className="w-full border-b border-line bg-transparent px-4 py-3 text-body
                         text-ink outline-none placeholder:text-faint"
            />

            <div className="max-h-[380px] overflow-y-auto">
              {query.trim() === "" ? (
                <p className="px-4 py-6 text-center text-small text-muted">
                  {t("search.prompt")}
                </p>
              ) : hits.length === 0 && !pending ? (
                <p className="px-4 py-6 text-center text-small text-muted">
                  {t("search.empty", query.trim())}
                </p>
              ) : (
                <ul>
                  {hits.map((hit, i) => {
                    // The group heading appears once, above the first of its
                    // kind -- rankHits has already clustered them.
                    const first = i === 0 || hits[i - 1].kind !== hit.kind;
                    return (
                      <li key={`${hit.kind}:${hit.id}`}>
                        {first && (
                          <p className="eyebrow px-4 pt-3 pb-1">
                            {t(GROUP_KEY[hit.kind])}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => go(hit.href)}
                          className="flex w-full items-baseline gap-2 px-4 py-2 text-left
                                     transition-colors hover:bg-surface-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-small">
                            {hit.title}
                          </span>
                          {hit.sub && (
                            <span className="num shrink-0 text-mini text-faint">
                              {hit.sub}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
