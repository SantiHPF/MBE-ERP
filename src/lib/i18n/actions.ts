"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";

const Choice = z.object({ locale: z.enum(["EN", "ES"]) });

/** Each person picks their own, so both languages can coexist in one team. */
export async function setLocale(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    const user = await requireUserOrThrow();
    const parsed = Choice.safeParse({ locale: formData.get("locale") });
    if (!parsed.success) return { error: "Unknown language" };

    await prisma.user.update({
      where: { id: user.id },
      data: { locale: parsed.data.locale },
    });

    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save" };
  }
}
