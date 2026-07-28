"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow, hasRole } from "@/lib/auth/guards";
import { parseClock } from "@/lib/time";

/**
 * Editing the task catalogue and its schedule.
 *
 * A catalogue entry is what a task *is* -- name, how long, the warnings that
 * come with it. The recurring rule is when it happens. They are edited
 * together here because nobody thinks of them separately: "the stock count
 * takes 90 minutes and happens on Mondays" is one thought.
 *
 * Managers edit their own department. Admins edit any.
 */

export type CatalogueState = { error?: string; ok?: boolean; message?: string };

const Recurrence = z.discriminatedUnion("frequency", [
  z.object({ frequency: z.literal("NONE") }),
  z.object({
    frequency: z.literal("WEEKLY"),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one day"),
  }),
  z.object({
    frequency: z.literal("MONTHLY"),
    // Either "the last Monday" or "the 22nd".
    monthlyMode: z.enum(["NTH_WEEKDAY", "DAY_OF_MONTH"]),
    weekday: z.number().int().min(1).max(7).optional(),
    monthlyNth: z.number().int().min(-1).max(4).optional(),
    monthlyDay: z.number().int().min(1).max(31).optional(),
  }),
]);

const Entry = z.object({
  templateId: z.string().optional(),
  departmentId: z.string().min(1, "Pick a department"),
  name: z.string().trim().min(1, "Give the task a name"),
  category: z.string().trim().max(60).optional(),
  estimatedMinutes: z.coerce
    .number()
    .int()
    .min(1, "How long does it take?")
    .max(12 * 60, "Longer than a working day — split it up"),
  notes: z.string().trim().max(2000).optional(),
  instructions: z.string().trim().max(500).optional(),
  isMeeting: z.boolean().optional(),
  instancesPerOccurrence: z.coerce.number().int().min(1).max(20).optional(),
  fixedStart: z.string().optional(),
});

async function assertCanEdit(departmentId: string) {
  const actor = await requireUserOrThrow("MANAGER");
  if (!hasRole(actor, "ADMIN") && actor.departmentId !== departmentId) {
    throw new Error("That department is not yours to edit");
  }
  return actor;
}

/** Pulls the recurrence half out of the form. */
function readRecurrence(formData: FormData) {
  const frequency = String(formData.get("frequency") ?? "NONE");

  if (frequency === "WEEKLY") {
    return Recurrence.parse({
      frequency: "WEEKLY",
      weekdays: formData.getAll("weekdays").map((d) => Number(d)),
    });
  }

  if (frequency === "MONTHLY") {
    const mode = String(formData.get("monthlyMode") ?? "NTH_WEEKDAY");
    return Recurrence.parse({
      frequency: "MONTHLY",
      monthlyMode: mode,
      weekday:
        mode === "NTH_WEEKDAY" ? Number(formData.get("monthlyWeekday")) : undefined,
      monthlyNth:
        mode === "NTH_WEEKDAY" ? Number(formData.get("monthlyNth")) : undefined,
      monthlyDay:
        mode === "DAY_OF_MONTH" ? Number(formData.get("monthlyDay")) : undefined,
    });
  }

  return Recurrence.parse({ frequency: "NONE" });
}

export async function saveCatalogueEntry(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  try {
    const parsed = Entry.safeParse({
      templateId: formData.get("templateId") || undefined,
      departmentId: formData.get("departmentId"),
      name: formData.get("name"),
      category: formData.get("category") || undefined,
      estimatedMinutes: formData.get("estimatedMinutes"),
      notes: formData.get("notes") || undefined,
      instructions: formData.get("instructions") || undefined,
      isMeeting: formData.get("isMeeting") === "on",
      instancesPerOccurrence: formData.get("instancesPerOccurrence") || 1,
      fixedStart: formData.get("fixedStart") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    let recurrence;
    try {
      recurrence = readRecurrence(formData);
    } catch (error) {
      const issue =
        error instanceof z.ZodError ? error.issues[0]?.message : undefined;
      return { error: issue ?? "Check the repeat settings" };
    }

    await assertCanEdit(parsed.data.departmentId);
    const input = parsed.data;

    const clash = await prisma.taskTemplate.findFirst({
      where: {
        departmentId: input.departmentId,
        name: input.name,
        ...(input.templateId ? { id: { not: input.templateId } } : {}),
      },
    });
    if (clash) return { error: `${input.name} is already in this catalogue` };

    const data = {
      departmentId: input.departmentId,
      name: input.name,
      category: input.category || null,
      estimatedMinutes: input.estimatedMinutes,
      notes: input.notes || null,
      instructions: input.instructions || null,
      isMeeting: input.isMeeting ?? false,
      active: true,
    };

    const template = input.templateId
      ? await prisma.taskTemplate.update({
          where: { id: input.templateId },
          data,
        })
      : await prisma.taskTemplate.create({ data });

    // One schedule per task: replace rather than accumulate.
    await prisma.recurringRule.deleteMany({ where: { templateId: template.id } });

    if (recurrence.frequency !== "NONE") {
      const fixedStart = input.fixedStart ? parseClock(input.fixedStart) : null;

      await prisma.recurringRule.create({
        data: {
          templateId: template.id,
          departmentId: input.departmentId,
          frequency: recurrence.frequency,
          weekdays:
            recurrence.frequency === "WEEKLY"
              ? recurrence.weekdays
              : recurrence.monthlyMode === "NTH_WEEKDAY" && recurrence.weekday
                ? [recurrence.weekday]
                : [],
          monthlyNth:
            recurrence.frequency === "MONTHLY" &&
            recurrence.monthlyMode === "NTH_WEEKDAY"
              ? (recurrence.monthlyNth ?? null)
              : null,
          monthlyDay:
            recurrence.frequency === "MONTHLY" &&
            recurrence.monthlyMode === "DAY_OF_MONTH"
              ? (recurrence.monthlyDay ?? null)
              : null,
          instancesPerOccurrence: input.instancesPerOccurrence ?? 1,
          fixedStartMinutes: fixedStart,
          fixedEndMinutes:
            fixedStart != null ? fixedStart + input.estimatedMinutes : null,
          sourceNote: "Set in the app",
        },
      });
    }

    revalidatePath("/catalogue");
    revalidatePath("/plan");
    return {
      ok: true,
      message: input.templateId
        ? `Updated ${template.name}.`
        : `Added ${template.name}.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save it" };
  }
}

/**
 * Retire rather than delete. Scheduled work and rotation history still point
 * at the template, and a task nobody can name is worse than a retired one.
 */
export async function setCatalogueActive(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  try {
    const templateId = String(formData.get("templateId") ?? "");
    const active = formData.get("active") === "true";

    const template = await prisma.taskTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) return { error: "That task no longer exists" };
    await assertCanEdit(template.departmentId);

    await prisma.$transaction([
      prisma.taskTemplate.update({
        where: { id: templateId },
        data: { active },
      }),
      // A retired task should stop generating work immediately.
      prisma.recurringRule.updateMany({
        where: { templateId },
        data: { active },
      }),
    ]);

    revalidatePath("/catalogue");
    return {
      ok: true,
      message: active
        ? `${template.name} is back in the catalogue.`
        : `${template.name} retired — it will not be scheduled again.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save" };
  }
}
