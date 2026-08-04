"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";

/**
 * "Marcar leídos".
 *
 * There is nothing per-row to mark, so this is one timestamp: everything
 * older than the moment you looked is read, and anything landing afterwards
 * is not. Revalidating the layout is what clears the badge, since that is
 * where the count is rendered.
 */
export async function markSeen(): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { notificationsSeenAt: new Date() },
  });
  revalidatePath("/", "layout");
}
