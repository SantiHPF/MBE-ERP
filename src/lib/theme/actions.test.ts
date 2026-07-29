import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one path that writes the theme cookie, with only next/headers and the
 * cache mocked -- the zod parsing and the cookie options are the real ones.
 */

const set = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set, get: vi.fn() })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/i18n/server", () => ({
  // Return the key, so a failure names the message rather than hiding it.
  getT: vi.fn(async () => ({ t: (k: string) => k, locale: "ES", dict: {} })),
}));

const { setTheme } = await import("./actions");
const { revalidatePath } = await import("next/cache");
const { THEME_COOKIE, nextTheme, themeAttribute } = await import("./theme");

function form(theme: string | null): FormData {
  const f = new FormData();
  if (theme !== null) f.set("theme", theme);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setTheme", () => {
  it.each(["SYSTEM", "LIGHT", "DARK"] as const)("accepts %s", async (theme) => {
    const result = await setTheme({}, form(theme));

    expect(result).toEqual({});
    expect(set).toHaveBeenCalledWith(
      THEME_COOKIE,
      theme,
      expect.objectContaining({ path: "/", sameSite: "lax" }),
    );
  });

  it("re-renders every route, because the attribute lives on <html>", async () => {
    await setTheme({}, form("DARK"));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("survives a year, so nobody sets it twice", async () => {
    await setTheme({}, form("DARK"));
    const options = set.mock.calls[0][2];
    expect(options.maxAge).toBeGreaterThan(300 * 24 * 60 * 60);
  });

  it.each([["not-a-theme"], [""], [null]])(
    "rejects %s without writing anything",
    async (value) => {
      const result = await setTheme({}, form(value));

      expect(result.error).toBe("errors.unknownTheme");
      expect(set).not.toHaveBeenCalled();
    },
  );

  /**
   * The theme decides a colour and nothing else, and the page has to be able
   * to read its own setting -- but it still must not be a login-shaped cookie.
   */
  it("is not httpOnly, and is not marked as one by accident", async () => {
    await setTheme({}, form("LIGHT"));
    expect(set.mock.calls[0][2].httpOnly).toBe(false);
  });
});

describe("nextTheme", () => {
  it("cycles system -> light -> dark and back", () => {
    expect(nextTheme("SYSTEM")).toBe("LIGHT");
    expect(nextTheme("LIGHT")).toBe("DARK");
    expect(nextTheme("DARK")).toBe("SYSTEM");
  });

  it("reaches every mode from any starting point", () => {
    let current = "DARK" as ReturnType<typeof nextTheme>;
    const seen = new Set([current]);
    for (let i = 0; i < 3; i++) {
      current = nextTheme(current);
      seen.add(current);
    }
    expect([...seen].sort()).toEqual(["DARK", "LIGHT", "SYSTEM"]);
  });
});

describe("themeAttribute", () => {
  it("sets nothing for SYSTEM, leaving the media query in charge", () => {
    expect(themeAttribute("SYSTEM")).toBeUndefined();
  });

  it("matches the selectors in globals.css, which are lowercase", () => {
    expect(themeAttribute("LIGHT")).toBe("light");
    expect(themeAttribute("DARK")).toBe("dark");
  });
});
