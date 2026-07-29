"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText, message } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { toDateOnly } from "@/lib/time";
import { placeOnDay } from "./place";

/**
 * Planning is one gesture: tick a task on a day to take it, untick to let it
 * go. Everything else falls out of that.
 *
 * Claims are conditional updates rather than read-then-write, so two people
 * ticking the same cell at the same moment cannot both end up owning it.
 */

export type PlanState = { error?: string; ok?: boolean; message?: string };

const Toggle = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.pickADay"),
  templateId: z.string().optional(),
  taskId: z.string().optional(),
  wanted: z.enum(["true", "false"]),
});

const STARTED = ["IN_PROGRESS", "PAUSED", "DONE"];

/** Postgres unique-violation: one of the schema's claim guards fired. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

function revalidate() {
  revalidatePath("/plan");
  revalidatePath("/my-day");
  revalidatePath("/my-calendar");
  revalidatePath("/team");
}

export async function toggleTaskDay(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = Toggle.safeParse({
      date: formData.get("date"),
      templateId: formData.get("templateId") || undefined,
      taskId: formData.get("taskId") || undefined,
      wanted: formData.get("wanted"),
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const wanted = parsed.data.wanted === "true";
    const date = toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`));

    // ------------------------------------------------------- giving it up
    if (!wanted) {
      if (!parsed.data.taskId) return { error: t("errors.nothingToGiveBack") };

      const task = await prisma.task.findUnique({
        where: { id: parsed.data.taskId },
      });
      if (!task) return { error: t("errors.taskGone") };
      if (task.assigneeId !== user.id) return { error: t("errors.notYours") };
      if (STARTED.includes(task.status)) {
        return { error: t("errors.alreadyStartedThis") };
      }

      // Work you added yourself disappears; work the rules or a meeting
      // created still needs doing, so it goes back to the pool.
      if (task.origin === "CATALOGUE") {
        await prisma.task.delete({ where: { id: task.id } });
      } else {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            assigneeId: null,
            status: "UNASSIGNED",
            scheduledDate: null,
            scheduledStart: null,
            scheduledEnd: null,
          },
        });
      }

      revalidate();
      return { ok: true };
    }

    // ---------------------------------------------------------- taking it
    if (parsed.data.taskId) {
      // An instance already exists -- take it if it is still going spare.
      const { count } = await prisma.task.updateMany({
        where: { id: parsed.data.taskId, assigneeId: null },
        data: { assigneeId: user.id, status: "ASSIGNED" },
      });

      if (count === 0) {
        const now = await prisma.task.findUnique({
          where: { id: parsed.data.taskId },
          include: { assignee: { select: { displayName: true } } },
        });
        if (now?.assigneeId === user.id) return { ok: true };
        return {
          error: now?.assignee
            ? t("errors.tookItFirst", now.assignee.displayName)
            : t("errors.taskUnavailable"),
        };
      }

      await placeOnDay(parsed.data.taskId, user.id, date);
      revalidate();
      return { ok: true };
    }

    if (!parsed.data.templateId) return { error: t("errors.nothingToAdd") };

    const template = await prisma.taskTemplate.findUnique({
      where: { id: parsed.data.templateId },
    });
    if (!template) return { error: t("errors.notInCatalogue") };
    if (template.departmentId !== user.departmentId) {
      return { error: t("errors.taskOtherDepartment") };
    }

    // Somebody may have created the instance since the page loaded.
    const existing = await prisma.task.findFirst({
      where: {
        templateId: template.id,
        dueDate: date,
        status: { not: "CANCELLED" },
      },
      include: { assignee: { select: { id: true, displayName: true } } },
    });

    if (existing) {
      if (existing.assigneeId === user.id) return { ok: true };
      if (existing.assigneeId === null) {
        const { count } = await prisma.task.updateMany({
          where: { id: existing.id, assigneeId: null },
          data: { assigneeId: user.id, status: "ASSIGNED" },
        });
        if (count === 0) return { error: t("errors.somebodyTookIt") };
        await placeOnDay(existing.id, user.id, date);
        revalidate();
        return { ok: true };
      }
      return {
        error: t("errors.alreadyHasIt", existing.assignee?.displayName ?? "", template.name),
      };
    }

    // The findFirst above is not a guarantee: somebody can create the task in
    // the gap before this runs. A partial unique index on
    // (templateId, dueDate) for live CATALOGUE tasks makes that a collision
    // rather than a duplicate, and losing the collision means they got there
    // first.
    let created;
    try {
      created = await prisma.task.create({
        data: {
          title: template.name,
          estimatedMinutes: template.estimatedMinutes,
          dueDate: date,
          departmentId: user.departmentId,
          templateId: template.id,
          origin: "CATALOGUE",
          status: "ASSIGNED",
          assigneeId: user.id,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const winner = await prisma.task.findFirst({
        where: {
          templateId: template.id,
          dueDate: date,
          origin: "CATALOGUE",
          status: { not: "CANCELLED" },
        },
        include: { assignee: { select: { id: true, displayName: true } } },
      });

      if (winner?.assigneeId === user.id) return { ok: true };
      return {
        error: winner?.assignee
          ? t("errors.tookItFirst", winner.assignee.displayName)
          : t("errors.somebodyTookIt"),
      };
    }

    await placeOnDay(created.id, user.id, date);
    revalidate();
    return { ok: true };
  } catch (error) {
    return {
      error: await errorText(error, "errors.couldNotSaveThat"),
    };
  }
}

const NewTask = z.object({
  title: z.string().trim().min(1, "errors.whatNeedsDoing"),
  estimatedMinutes: z.coerce
    .number()
    .int()
    .min(1, "errors.howLong")
    .max(12 * 60, "errors.longerThanADay"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.pickADay"),
});

/**
 * Work that is not in the catalogue: a one-off that came up. It belongs to
 * whoever added it straight away -- you would not invent a task for somebody
 * else to discover.
 */
export async function createAdHocTask(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  try {
    const user = await requireUserOrThrow();
    const { t } = await getT();
    const parsed = NewTask.safeParse({
      title: formData.get("title"),
      estimatedMinutes: formData.get("estimatedMinutes"),
      date: formData.get("date"),
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const day = toDateOnly(new Date(`${parsed.data.date}T00:00:00Z`));
    const task = await prisma.task.create({
      data: {
        title: parsed.data.title,
        estimatedMinutes: parsed.data.estimatedMinutes,
        dueDate: day,
        departmentId: user.departmentId,
        origin: "MANUAL",
        status: "ASSIGNED",
        assigneeId: user.id,
      },
    });

    await placeOnDay(task.id, user.id, day);
    revalidate();
    return { ok: true, message: t("errors.added", parsed.data.title) };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotAddIt") };
  }
}

/**
 * Take (or drop) a task across several days at once -- the whole point of a
 * row. Partial failures are reported rather than silently swallowed, since
 * somebody else may hold one of the days.
 */
export async function toggleTaskRow(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const dates = formData.getAll("dates").map(String);
  const wanted = formData.get("wanted") === "true";
  const templateId = formData.get("templateId");
  const taskIds = new Map(
    formData
      .getAll("cell")
      .map(String)
      .map((entry) => {
        const [date, taskId] = entry.split("|");
        return [date, taskId || undefined] as const;
      }),
  );

  let changed = 0;
  const problems: string[] = [];

  for (const date of dates) {
    const one = new FormData();
    one.set("date", date);
    one.set("wanted", wanted ? "true" : "false");
    if (templateId) one.set("templateId", String(templateId));
    const taskId = taskIds.get(date);
    if (taskId) one.set("taskId", taskId);

    const result = await toggleTaskDay({}, one);
    if (result.ok) changed += 1;
    else if (result.error) problems.push(result.error);
  }

  if (problems.length > 0) {
    return {
      ok: changed > 0,
      error: problems[0],
      message: changed > 0 ? await message("errors.daysUpdated", changed) : undefined,
    };
  }

  return { ok: true, message: await message("errors.daysUpdated", changed) };
}
