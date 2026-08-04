"use client";

import { useEffect, useState } from "react";
import { unreadCount } from "@/lib/messages/actions";

/** How often to ask. Slow enough to be free, quick enough to feel live. */
const EVERY_MS = 30_000;

/**
 * How many messages are waiting.
 *
 * The count is server-rendered with the layout, which is right for every
 * navigation and useless if you sit on one page all morning -- which is
 * exactly what somebody deep in a task does. So it also asks, on a timer.
 *
 * This is the first recurring server call in the app, so two rules:
 *
 *   - only while the tab is visible. A dozen idle tabs left open overnight
 *     would otherwise be a dozen requests a minute, all night, for nothing.
 *   - one indexed count and nothing else, through a read-only server action --
 *     the same idiom offerFillers() uses, rather than introducing this
 *     codebase's first route handler for a number.
 */
export function MessageBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);

  // A navigation brings a fresh figure with it; trust it over the polled one.
  useEffect(() => setCount(initial), [initial]);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await unreadCount();
        if (!cancelled) setCount(next);
      } catch {
        // A dropped connection is not worth telling anybody about; the next
        // tick will get it, and the badge simply stays as it was.
      }
    };

    const id = setInterval(check, EVERY_MS);
    // Coming back to the tab should not mean waiting up to thirty seconds.
    document.addEventListener("visibilitychange", check);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (count === 0) return null;

  /* Pause, not accent, and the same as the requests badge in the layout:
     both mean "n things are waiting for you", and two colours for one
     meaning reads as two different kinds of thing. */
  return (
    <span className="num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pause px-1 text-[10px] font-semibold text-white">
      {count}
    </span>
  );
}
