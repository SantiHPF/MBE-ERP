"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";

const Choice = z.object({ locale: z.enum(["EN", "ES"]) });

/** Each person picks their own, so both languages can coexist in one team. */
export async function setLocale(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Choice.safeParse({ locale: formData.get("locale") });
    if (!parsed.success) return { error: t("errors.unknownLanguage") };

    await prisma.user.update({
      where: { id: user.id },
      data: { locale: parsed.data.locale },
    });

    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}
