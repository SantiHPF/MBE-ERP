"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { search } from "@/lib/search/actions";
import type { SearchHit, SearchKind } from "@/lib/search/rank";

const GROUP_KEY: Record<SearchKind, string> = {
  task: "search.tasks",
  person: "search.people",
  p1n: "search.p1ns",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const [highlight, setHighlight] = useState(0);
  const [pending, startTransition] = useTransition();

  const dialogRef = useRef<HTMLDivElement>(null);

  // What had focus right before the palette opened, so it can get that focus
  // back on close. This is captured at the two call sites that open the
  // palette -- not in a useEffect -- because the input below has autoFocus,
  // and React applies autoFocus synchronously during the commit phase, the
  // same pass that attaches refs, which always runs before any passive
  // effect fires. By the time a useEffect body keyed on `open` could read
  // document.activeElement, the palette's own input has already stolen it.
  // There is no effect timing that sees the real trigger -- it has to be
  // read before setOpen(true) is even called.
  const triggerRef = useRef<HTMLElement | null>(null);

  // Mirrors `open` for the mount-once keydown listener below, which cannot
  // put `open` in its dependency array without re-registering itself (and
  // duplicate listeners is exactly the bug that guard is there to avoid).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Counts up once per search actually sent. A server action cannot be
  // aborted mid-flight the way a fetch can -- there is no request to cancel,
  // only an answer to ignore. So instead of cancelling, each response is
  // stamped with the id it was sent under and only accepted if that id is
  // still the newest one outstanding when it comes back. That is what stops
  // a slow "r" from landing after a fast "rev" and clobbering it.
  const requestId = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          // Only capture on the closed-to-open edge. Capturing on the way
          // back out would record whatever had focus inside the dialog --
          // the input, a result -- and overwrite the real trigger with it.
          if (!o) triggerRef.current = document.activeElement as HTMLElement | null;
          return !o;
        });
        return;
      }
      if (!openRef.current) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // A dialog that traps focus visually but lets Tab walk into the page
      // behind the backdrop is not actually modal. The focusable set is
      // queried here rather than cached because the result list -- and so
      // the last tab stop -- changes on every keystroke.
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Restores focus to whatever was captured in triggerRef -- on every close
  // path: Escape, a backdrop click, or picking a result. Without this,
  // closing drops focus to <body> and tabbing has to start over from the top
  // of the page. Guarded by isConnected because picking a result navigates,
  // and although the shared layout keeps the top bar mounted across routes,
  // a detached node is a silent no-op to .focus() rather than an error, so
  // the guard is cheap insurance against a class of bug rather than a fix
  // for one actually seen.
  useEffect(() => {
    if (open) return;
    const trigger = triggerRef.current;
    if (trigger && trigger.isConnected) trigger.focus();
  }, [open]);

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
      const thisRequest = ++requestId.current;
      startTransition(async () => {
        const results = await search(q);
        if (thisRequest === requestId.current) setHits(results);
      });
    }, 180);
    return () => clearTimeout(id);
  }, [query, open]);

  // A fresh box every time, rather than yesterday's search waiting in it.
  useEffect(() => {
    if (!open) {
      // Closing invalidates anything still in flight: bumping the id means
      // a response from a search already dismissed can never match the
      // "current" id again, even if the user reopens and starts a new
      // session before that old response lands.
      requestId.current += 1;
      setQuery("");
      setHits([]);
    }
  }, [open]);

  // The highlighted row always starts at the top of whatever just arrived,
  // rather than at whatever index the previous list happened to leave it on.
  useEffect(() => {
    setHighlight(0);
  }, [hits]);

  const openPalette = () => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  };

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[highlight] ?? hits[0];
      if (hit) go(hit.href);
    }
  };

  return (
    <>
      {children(openPalette)}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-6 pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("search.open")}
            className="popover w-full max-w-[520px] overflow-hidden"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={t("search.placeholder")}
              className="w-full border-b border-line bg-transparent px-4 py-3 text-body
                         text-ink placeholder:text-faint"
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
                <ul role="listbox">
                  {hits.map((hit, i) => {
                    // The group heading appears once, above the first of its
                    // kind -- rankHits has already clustered them.
                    const first = i === 0 || hits[i - 1].kind !== hit.kind;
                    const selected = i === highlight;
                    return (
                      <li key={`${hit.kind}:${hit.id}`} role="presentation">
                        {first && (
                          <p className="eyebrow px-4 pt-3 pb-1">
                            {t(GROUP_KEY[hit.kind])}
                          </p>
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => go(hit.href)}
                          className={`flex w-full items-baseline gap-2 px-4 py-2 text-left
                                     transition-colors hover:bg-surface-2 ${
                                       selected ? "bg-surface-2" : ""
                                     }`}
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
