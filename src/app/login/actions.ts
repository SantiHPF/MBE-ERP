"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

const LoginInput = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const user = await prisma.user.findUnique({
    where: { username: parsed.data.username.toLowerCase() },
  });

  // Same message whether the username is unknown or the password is wrong --
  // no point telling an attacker which usernames exist.
  const invalid = { error: "Wrong username or password" };
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
