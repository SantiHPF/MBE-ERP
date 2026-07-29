"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { THEME_COOKIE, THEMES } from "./theme";

const Choice = z.object({ theme: z.enum(THEMES) });

/** A year: long enough that nobody has to set it twice, short enough to expire. */
const A_YEAR = 60 * 60 * 24 * 365;

/**
 * A server action because a cookie cannot be written while a component
 * renders. No sign-in required -- the theme is a property of the screen, and
 * the login page is one of the places it has to work.
 */
export async function setTheme(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    const { t } = await getT();
    const parsed = Choice.safeParse({ theme: formData.get("theme") });
    if (!parsed.success) return { error: t("errors.unknownTheme") };

    (await cookies()).set(THEME_COOKIE, parsed.data.theme, {
      maxAge: A_YEAR,
      path: "/",
      sameSite: "lax",
      // Readable by script on purpose: this decides nothing but a colour, and
      // httpOnly would only stop the page from ever reading its own theme.
      httpOnly: false,
    });

    // The attribute lives on <html> in the root layout, so every route has to
    // be re-rendered for the change to show.
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}
