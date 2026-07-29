"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canManagePeople, requireUserOrThrow } from "@/lib/auth/guards";
import { errorText, fail } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { hashPassword } from "@/lib/auth/password";
import { parseClock, toDateOnly } from "@/lib/time";
import { syncOnboarding } from "@/lib/people/onboarding-db";

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
    .min(2, "errors.usernameTooShort")
    .regex(/^[a-z0-9._-]+$/, "errors.usernameCharacters"),
  displayName: z.string().trim().min(1, "errors.giveTheirName"),
  departmentId: z.string().min(1, "errors.pickADepartment"),
  role: z.enum(["WORKER", "MANAGER", "HR", "ADMIN"]),
  password: z.string().min(8, "errors.atLeastEightCharacters"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.whenDoTheyStart"),
  // Blank means indefinite, which is most people.
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
});

async function assertPeopleAdmin() {
  const actor = await requireUserOrThrow();
  if (!canManagePeople(actor)) {
    fail("errors.onlyHrManagesAccounts");
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
      fail("errors.finishAfterStart");
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
    const { t } = await getT();
    await assertPeopleAdmin();

    const parsed = NewPerson.safeParse({
      username: formData.get("username"),
      displayName: formData.get("displayName"),
      departmentId: formData.get("departmentId"),
      role: formData.get("role"),
      password: formData.get("password"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const clash = await prisma.user.findUnique({
      where: { username: parsed.data.username },
    });
    if (clash) return { error: t("errors.usernameTaken") };

    const user = await prisma.user.create({
      data: {
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        departmentId: parsed.data.departmentId,
        role: parsed.data.role,
        passwordHash: await hashPassword(parsed.data.password),
        startDate: toDateOnly(new Date(`${parsed.data.startDate}T00:00:00Z`)),
        endDate: parsed.data.endDate
          ? toDateOnly(new Date(`${parsed.data.endDate}T00:00:00Z`))
          : null,
      },
    });

    const patterns = patternsFromForm(formData, user.id);
    if (patterns.length > 0) {
      await prisma.workingPattern.createMany({ data: patterns });
    }

    // Their induction interviews exist from the moment the account does.
    const induction = await syncOnboarding(user.id);

    revalidatePath("/hr/people");
    revalidatePath("/triage");
    return {
      ok: true,
      message:
        t("errors.canNowSignIn", user.displayName, user.username) +
        (induction.created > 0
          ? " " + t("errors.inductionsBooked", induction.created)
          : ""),
    };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotCreateThem"),
    };
  }
}

export async function updateWorkingPattern(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    const { t } = await getT();
    await assertPeopleAdmin();
    const userId = String(formData.get("userId") ?? "");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { error: t("errors.personGone") };

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
    return { ok: true, message: t("errors.updatedHours", user.displayName) };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotSaveHours"),
    };
  }
}

const Reassign = z.object({
  userId: z.string().min(1),
  departmentId: z.string().min(1, "errors.pickADepartment"),
  role: z.enum(["WORKER", "MANAGER", "HR", "ADMIN"]).optional(),
});

const Dates = z
  .object({
    userId: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.whenDidTheyStart"),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
  })
  .refine((v) => !v.endDate || v.startDate <= v.endDate, {
    message: "errors.leaveBeforeStart",
  });

/**
 * Change when somebody joined or leaves.
 *
 * The induction interviews are recomputed from the new dates, so moving a
 * start date moves them with it and setting a leaving date stops the
 * two-monthly review there. Interviews nobody has picked up yet are taken
 * back; anything already assigned stays put for a human to deal with.
 */
export async function setEmploymentDates(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    const { t } = await getT();
    await assertPeopleAdmin();
    const parsed = Dates.safeParse({
      userId: formData.get("userId"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const endDate = parsed.data.endDate
      ? toDateOnly(new Date(`${parsed.data.endDate}T00:00:00Z`))
      : null;

    const user = await prisma.user.update({
      where: { id: parsed.data.userId },
      data: {
        startDate: toDateOnly(new Date(`${parsed.data.startDate}T00:00:00Z`)),
        endDate,
      },
    });

    // Nothing should sit on their calendar after they have gone.
    let dropped = 0;
    if (endDate) {
      const { count } = await prisma.task.deleteMany({
        where: {
          assigneeId: user.id,
          dueDate: { gt: endDate },
          status: { in: ["UNASSIGNED", "ASSIGNED"] },
        },
      });
      dropped = count;
    }

    const induction = await syncOnboarding(user.id);

    revalidatePath("/hr/people");
    revalidatePath("/team");
    revalidatePath("/triage");

    return {
      ok: true,
      message:
        t("errors.updatedPerson", user.displayName) +
        (induction.created > 0
          ? " " + t("errors.interviewsBooked", induction.created)
          : "") +
        (dropped > 0 ? " " + t("errors.tasksRemoved", dropped) : ""),
    };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

/**
 * Move somebody to another department, and change their role while we are
 * here -- the two usually change together.
 *
 * Their scheduled work does not follow them: a task belongs to the department
 * that needs it done, so anything still outstanding goes back to the old
 * department's pool rather than travelling to a team that has no idea what it
 * is. Work already started or finished stays put, since it has tracked time
 * against it.
 */
export async function changeDepartment(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    const { t } = await getT();
    const actor = await assertPeopleAdmin();
    const parsed = Reassign.safeParse({
      userId: formData.get("userId"),
      departmentId: formData.get("departmentId"),
      role: formData.get("role") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const user = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      include: { department: true },
    });
    if (!user) return { error: t("errors.personGone") };

    const department = await prisma.department.findUnique({
      where: { id: parsed.data.departmentId },
    });
    if (!department) return { error: t("errors.departmentGone") };

    const moving = user.departmentId !== department.id;

    if (
      parsed.data.userId === actor.id &&
      parsed.data.role &&
      parsed.data.role !== "HR" &&
      parsed.data.role !== "ADMIN"
    ) {
      return { error: t("errors.wouldLockYourselfOut") };
    }

    const released = moving
      ? await prisma.task.count({
          where: { assigneeId: user.id, status: { in: ["ASSIGNED", "ORPHANED"] } },
        })
      : 0;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          departmentId: department.id,
          ...(parsed.data.role ? { role: parsed.data.role } : {}),
        },
      }),
      ...(moving
        ? [
            prisma.task.updateMany({
              where: {
                assigneeId: user.id,
                status: { in: ["ASSIGNED", "ORPHANED"] },
              },
              data: {
                assigneeId: null,
                status: "UNASSIGNED",
                scheduledDate: null,
                scheduledStart: null,
                scheduledEnd: null,
                orphanedAt: null,
                orphanReason: null,
              },
            }),
          ]
        : []),
    ]);

    revalidatePath("/hr/people");
    revalidatePath("/team");
    revalidatePath("/plan");

    return {
      ok: true,
      message: moving
        ? t("errors.movedTo", user.displayName, department.name) +
          (released > 0
            ? " " + t("errors.wentBackTo", released, user.department.name)
            : "")
        : t("errors.updatedPerson", user.displayName),
    };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotMoveThem") };
  }
}

export async function setPersonActive(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    const { t } = await getT();
    const actor = await assertPeopleAdmin();
    const userId = String(formData.get("userId") ?? "");
    const active = formData.get("active") === "true";

    if (userId === actor.id && !active) {
      return { error: t("errors.cannotDeactivateSelf") };
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
        ? t("errors.activeAgain", user.displayName)
        : t("errors.deactivated", user.displayName),
    };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

export async function resetPassword(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    const { t } = await getT();
    await assertPeopleAdmin();
    const userId = String(formData.get("userId") ?? "");
    const password = String(formData.get("password") ?? "");

    if (password.length < 8) return { error: t("errors.atLeastEightCharacters") };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    });

    // Force them to sign in again with the new password everywhere.
    await prisma.session.deleteMany({ where: { userId } });

    revalidatePath("/hr/people");
    return { ok: true, message: t("errors.passwordReset", user.displayName) };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotReset") };
  }
}

export async function createDepartment(
  _prev: PeopleState,
  formData: FormData,
): Promise<PeopleState> {
  try {
    const { t } = await getT();
    await assertPeopleAdmin();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: t("errors.giveDepartmentAName") };

    const clash = await prisma.department.findUnique({ where: { name } });
    if (clash) return { error: t("errors.departmentExists") };

    await prisma.department.create({ data: { name } });
    revalidatePath("/hr/people");
    return { ok: true, message: t("errors.createdDepartment", name) };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotCreate") };
  }
}
