import "server-only";
import { cookies } from "next/headers";
import { isTheme, THEME_COOKIE, type Theme } from "./theme";

/**
 * Separate from theme.ts because next/headers cannot be bundled for the
 * browser, and both theme pickers are client components that need the types
 * and the cycling logic next door.
 */
export async function readTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  // Anything else -- a stale value, a hand-edited cookie -- falls back to
  // following the operating system rather than failing.
  return isTheme(value) ? value : "SYSTEM";
}
