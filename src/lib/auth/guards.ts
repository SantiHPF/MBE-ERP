import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSessionUser, type SessionUser } from "./session";

/**
 * Role hierarchy. An ADMIN can do anything a MANAGER can, and a MANAGER
 * anything a WORKER can, so checks compare rank rather than equality.
 */
const RANK: Record<Role, number> = {
  WORKER: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export function hasRole(user: { role: Role }, minimum: Role): boolean {
  return RANK[user.role] >= RANK[minimum];
}

/** For pages: redirects to login rather than throwing. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(minimum: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, minimum)) redirect("/my-day");
  return user;
}

/**
 * For server actions and route handlers, where a redirect would be the wrong
 * response. Throws instead, so the caller can turn it into an error.
 */
export async function requireUserOrThrow(minimum: Role = "WORKER"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  if (!hasRole(user, minimum)) throw new Error("Not allowed");
  return user;
}
