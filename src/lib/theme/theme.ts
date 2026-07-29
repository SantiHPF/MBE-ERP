/**
 * Light or dark, as a choice rather than only whatever the operating system
 * says.
 *
 * Kept in a cookie, not on the User row where the language lives. Language is
 * a property of the person -- it follows them to any screen. Theme is a
 * property of the screen: the same person wants dark on a laptop at night and
 * light on the monitor by the window. A cookie also covers /login, where there
 * is no account to read a preference from yet.
 *
 * Everything here is pure, so the two pickers -- both client components -- can
 * import it. Reading the cookie needs next/headers and lives in read.ts, the
 * same split session-cookie.ts already makes for the same reason.
 */

export const THEME_COOKIE = "task_erp_theme";

export const THEMES = ["SYSTEM", "LIGHT", "DARK"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * What the sidebar's one button does. SYSTEM first so the cycle starts from
 * where somebody who has never touched it already is.
 */
export function nextTheme(current: Theme): Theme {
  return current === "SYSTEM" ? "LIGHT" : current === "LIGHT" ? "DARK" : "SYSTEM";
}

/**
 * The value for <html data-theme>. SYSTEM sets no attribute at all, so the
 * media query in globals.css is left to decide -- an explicit "system" would
 * have to be special-cased in CSS for no gain.
 */
export function themeAttribute(theme: Theme): string | undefined {
  return theme === "SYSTEM" ? undefined : theme.toLowerCase();
}
