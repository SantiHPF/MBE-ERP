"use client";

import { CommandPalette } from "./command-palette";
import { TopBar } from "./top-bar";

/**
 * The render-prop composition of the palette and the top bar has to live
 * here, on the client side of the boundary.
 *
 * `layout.tsx` is a server component. A server component can hand a client
 * component a rendered element -- React serialises those into the RSC
 * payload -- but it can never hand over a function: `CommandPalette`'s
 * `children` is `(open: () => void) => React.ReactNode`, and a function is
 * not serialisable. So `<CommandPalette>{(open) => <TopBar ... />}</...>`
 * cannot be written in `layout.tsx` at all, however natural it looks.
 *
 * The fix is not to remove the render prop -- CommandPalette still needs to
 * own the open state and hand a trigger down to whatever should open it.
 * It is to move that wiring to a client component of its own, which layout
 * can render with an ordinary element prop (`bell`) instead of a function.
 * Client-to-client function props are unremarkable; only the server-to-client
 * hop is the illegal one.
 *
 * Do not inline this back into layout.tsx or "simplify" it away: that
 * reintroduces the exact server/client violation this file exists to avoid,
 * and the failure mode is a runtime error on every page, not a build error --
 * `tsc --noEmit` and `next build` both pass regardless.
 */
export function ShellChrome({ bell }: { bell: React.ReactNode }) {
  return (
    <CommandPalette>
      {(open) => <TopBar onOpenSearch={open}>{bell}</TopBar>}
    </CommandPalette>
  );
}
