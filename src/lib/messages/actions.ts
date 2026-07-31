"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { unreadFor } from "./db";

/**
 * Messages between people.
 *
 * The first thing in this app that is a notification rather than a record, and
 * it stays deliberately small: no threads, no groups, no attachments. What was
 * missing was the ability to say why -- "I'm giving you Tuesday because I'll
 * be at the fair" -- and that is one sentence to one person.
 */

export type MessageState = { error?: string; ok?: boolean };

const Send = z.object({
  recipientId: z.string().min(1, "errors.pickSomebody"),
  body: z.string().trim().min(1, "errors.saySomething").max(2000),
  taskId: z.string().optional(),
});

export async function sendMessage(
  _prev: MessageState,
  formData: FormData,
): Promise<MessageState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Send.safeParse({
      recipientId: formData.get("recipientId"),
      body: formData.get("body"),
      taskId: formData.get("taskId") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    if (parsed.data.recipientId === user.id) {
      return { error: t("errors.cannotMessageYourself") };
    }

    const recipient = await prisma.user.findUnique({
      where: { id: parsed.data.recipientId },
      select: { id: true, active: true, departmentId: true },
    });
    if (!recipient?.active) return { error: t("errors.personGone") };

    /**
     * No department or rank check, matching canWriteTo(): anybody may write to
     * anybody. The only boundaries left are that the person exists, still works
     * here, and is not you.
     */
    await prisma.message.create({
      data: {
        senderId: user.id,
        recipientId: recipient.id,
        body: parsed.data.body,
        taskId: parsed.data.taskId ?? null,
      },
    });

    // The badge lives in the layout, so the whole tree has to know.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSend") };
  }
}

/**
 * Opening a conversation marks it read.
 *
 * All of it at once rather than per message: you are looking at the thread,
 * and pretending the ones below the fold are still unread would make the badge
 * lie in the other direction.
 */
export async function markRead(
  _prev: MessageState,
  formData: FormData,
): Promise<MessageState> {
  try {
    const user = await requireUserOrThrow();
    const otherId = String(formData.get("otherId") ?? "");
    if (!otherId) return { ok: true };

    await prisma.message.updateMany({
      where: { recipientId: user.id, senderId: otherId, readAt: null },
      data: { readAt: new Date() },
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

/**
 * How many are waiting. Read-only, and called on a timer from NowProvider.
 *
 * A server action rather than a route handler, which is the same idiom
 * offerFillers() already uses -- this codebase has no route handlers and this
 * is not the feature to introduce the first one for. One indexed count, so
 * polling it costs about as little as a request can.
 */
export async function unreadCount(): Promise<number> {
  try {
    const user = await requireUserOrThrow();
    return await unreadFor(user.id);
  } catch {
    // A signed-out tab left open must not spew errors into the console every
    // thirty seconds. Zero is the honest answer to "how many are waiting".
    return 0;
  }
}
