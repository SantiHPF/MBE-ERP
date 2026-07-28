"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { getLoginT } from "@/lib/i18n/server";

// Keys, not sentences: the wording is resolved once the locale is known.
const LoginInput = z.object({
  username: z.string().trim().min(1, "login.enterUsername"),
  password: z.string().min(1, "login.enterPassword"),
});

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const { t } = await getLoginT();

  const parsed = LoginInput.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: t(parsed.error.issues[0].message) };
  }

  const user = await prisma.user.findUnique({
    where: { username: parsed.data.username.toLowerCase() },
  });

  // Same message whether the username is unknown or the password is wrong --
  // no point telling an attacker which usernames exist.
  const invalid = { error: t("login.wrongDetails") };
  if (!user || !user.active) return invalid;

  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok) return invalid;

  await createSession(user.id);
  redirect("/my-day");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
