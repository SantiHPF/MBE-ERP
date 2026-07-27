"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canManagePeople, requireUserOrThrow } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { parseClock } from "@/lib/time";

/**
 * Account administration, which only HR (and ADMIN) can do. A department
 * manager cannot create people -- that was the point of splitting HR out of
 * the role hierarchy.
 */

export type PeopleState = { error?: string; ok?: boolean; message?: string };

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

const NewPerson = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Username is too short")
    .regex(/^[a-z0-9._-]+$/, "Letters, numbers, dots, dashes and underscores only"),
  displayName: z.string().trim().min(1, "Give their full name"),
  departmentId: z.string().min(1, "Pick a department"),
  role: z.enum(["WORKER", "MANAGER", "HR", "ADMIN"]),
  password: z.string().min(8, "At least 8 characters"),
});

async function assertPeopleAdmin() {
  const actor = await requireUserOrThrow();
  if (!canManagePeople(actor)) {
    throw new Error("Only HR can manage accounts");
  }
  return actor;
}

/**
 * Working hours arrive as one row per weekday: a checkbox plus start, end and
 * break. Unchecked days simply produce no pattern row, which is how "does not
 * work Tuesdays" is represented.
 */
function patternsFromForm(formData: FormData, userId: string) {
  const rows: {
    userId: string;
    weekday: number;
    startMinutes: number;
    endMinutes: number;
    breakMinutes: number;
    breakStartMinutes: number | null;
  }[] = [];

  for (const weekday of WEEKDAYS) {
    if (!formData.get(`works-${weekday}`)) continue;

    const start = String(formData.get(`start-${weekday}`) ?? "");
    const end = String(formData.get(`end-${weekday}`) ?? "");
    if (!start || !end) continue;

    const startMinutes = parseClock(start);
    const endMinutes = parseClock(end);
    if (endMinutes <= startMinutes) {
      throw new Error(`Finishing time must be after the start on day ${weekday}`);
    }

    const breakMinutes = Number(formData.get(`break-${weekday}`) ?? 0) || 0;
    const breakStart = String(formData.get(`breakstart-${weekday}`) ?? "");

    rows.push({
      userId,
      weekday,
      startMinutes,
      endMinutes,
      breakMinutes,
      breakStartMinutes: breakStart ? parseClock(breakStart) : null,
    });
  }

  return rows;
}

export async function createPerson(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    await assertPeopleAdmin();

    const parsed = NewPerson.safeParse({
      username: formData.get("username"),
      displayName: formData.get("displayName"),
      departmentId: formData.get("departmentId"),
      role: formData.get("role"),
      password: formData.get("password"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const clash = await prisma.user.findUnique({
      where: { username: parsed.data.username },
    });
    if (clash) return { error: "That username is taken" };

    const user = await prisma.user.create({
      data: {
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        departmentId: parsed.data.departmentId,
        role: parsed.data.role,
        passwordHash: await hashPassword(parsed.data.password),
      },
    });

    const patterns = patternsFromForm(formData, user.id);
    if (patterns.length > 0) {
      await prisma.workingPattern.createMany({ data: patterns });
    }

    revalidatePath("/hr/people");
    return {
      ok: true,
      message: `${user.displayName} can now sign in as ${user.username}.`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not create them",
    };
  }
}

export async function updateWorkingPattern(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    await assertPeopleAdmin();
    const userId = String(formData.get("userId") ?? "");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { error: "That person no longer exists" };

    const patterns = patternsFromForm(formData, userId);

    // Replace wholesale: a removed weekday must actually disappear, not
    // linger because nothing overwrote it.
    await prisma.$transaction([
      prisma.workingPattern.deleteMany({ where: { userId } }),
      ...(patterns.length > 0
        ? [prisma.workingPattern.createMany({ data: patterns })]
        : []),
    ]);

    revalidatePath("/hr/people");
    revalidatePath("/team");
    return { ok: true, message: `Updated ${user.displayName}'s hours.` };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save the hours",
    };
  }
}

export async function setPersonActive(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    const actor = await assertPeopleAdmin();
    const userId = String(formData.get("userId") ?? "");
    const active = formData.get("active") === "true";

    if (userId === actor.id && !active) {
      return { error: "You cannot deactivate your own account" };
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { active },
    });

    // A leaver should not keep a live session.
    if (!active) {
      await prisma.session.deleteMany({ where: { userId } });
    }

    revalidatePath("/hr/people");
    return {
      ok: true,
      message: active
        ? `${user.displayName} is active again.`
        : `${user.displayName} has been deactivated and signed out.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save" };
  }
}

export async function resetPassword(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    await assertPeopleAdmin();
    const userId = String(formData.get("userId") ?? "");
    const password = String(formData.get("password") ?? "");

    if (password.length < 8) return { error: "At least 8 characters" };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    });

    // Force them to sign in again with the new password everywhere.
    await prisma.session.deleteMany({ where: { userId } });

    revalidatePath("/hr/people");
    return { ok: true, message: `Password reset for ${user.displayName}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reset" };
  }
}

export async function createDepartment(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    await assertPeopleAdmin();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Give the department a name" };

    const clash = await prisma.department.findUnique({ where: { name } });
    if (clash) return { error: "That department already exists" };

    await prisma.department.create({ data: { name } });
    revalidatePath("/hr/people");
    return { ok: true, message: `Created ${name}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create" };
  }
}
