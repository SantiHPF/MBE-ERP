"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow, hasRole } from "@/lib/auth/guards";
import { errorText, fail } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { parseClock, today, toDateOnly } from "@/lib/time";

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
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "errors.pickAtLeastOneDay"),
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
  departmentId: z.string().min(1, "errors.pickADepartment"),
  name: z.string().trim().min(1, "errors.giveTaskAName"),
  category: z.string().trim().max(60).optional(),
  estimatedMinutes: z.coerce
    .number()
    .int()
    .min(1, "errors.howLongDoesItTake")
    .max(12 * 60, "errors.longerThanADay"),
  notes: z.string().trim().max(2000).optional(),
  instructions: z.string().trim().max(500).optional(),
  isMeeting: z.boolean().optional(),
  repeatable: z.boolean().optional(),
  priority: z.enum(["MUST", "NORMAL", "SPARE_TIME"]).default("NORMAL"),
  instancesPerOccurrence: z.coerce.number().int().min(1).max(20).optional(),
  fixedStart: z.string().optional(),
  /// Points in the shift, when the task is done several times a day. Kept
  /// separate from the recurrence union because it is orthogonal to it: a
  /// weekly or a monthly rule can both be anchored.
  anchors: z
    .array(z.enum(["ARRIVAL", "BEFORE_BREAK", "AFTER_BREAK", "BEFORE_LEAVING"]))
    .optional(),
});

async function assertCanEdit(departmentId: string) {
  const actor = await requireUserOrThrow("MANAGER");
  if (!hasRole(actor, "ADMIN") && actor.departmentId !== departmentId) {
    fail("errors.departmentNotYours");
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
    const { t } = await getT();
    const parsed = Entry.safeParse({
      templateId: formData.get("templateId") || undefined,
      departmentId: formData.get("departmentId"),
      name: formData.get("name"),
      category: formData.get("category") || undefined,
      estimatedMinutes: formData.get("estimatedMinutes"),
      notes: formData.get("notes") || undefined,
      instructions: formData.get("instructions") || undefined,
      isMeeting: formData.get("isMeeting") === "on",
      repeatable: formData.get("repeatable") === "on",
      priority: formData.get("priority") || "NORMAL",
      instancesPerOccurrence: formData.get("instancesPerOccurrence") || 1,
      fixedStart: formData.get("fixedStart") || undefined,
      anchors: formData.getAll("anchors").map(String),
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    let recurrence;
    try {
      recurrence = readRecurrence(formData);
    } catch (error) {
      const issue =
        error instanceof z.ZodError ? error.issues[0]?.message : undefined;
      return { error: t(issue ?? "errors.checkRepeatSettings") };
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
    if (clash) return { error: t("errors.alreadyInCatalogue", input.name) };

    const data = {
      departmentId: input.departmentId,
      name: input.name,
      category: input.category || null,
      estimatedMinutes: input.estimatedMinutes,
      notes: input.notes || null,
      instructions: input.instructions || null,
      isMeeting: input.isMeeting ?? false,
      repeatable: input.repeatable ?? false,
      priority: input.priority,
      active: true,
    };

    const template = input.templateId
      ? await prisma.taskTemplate.update({
          where: { id: input.templateId },
          data,
        })
      : await prisma.taskTemplate.create({ data });

    /**
     * The rule is updated in place, never replaced.
     *
     * Generated tasks are keyed on the rule's id, so deleting and recreating
     * it gives every future task a new key -- the old ones survive and the
     * week ends up with two of everything. Keeping the id means editing a
     * schedule re-places existing work instead of duplicating it.
     */
    const existingRule = await prisma.recurringRule.findFirst({
      where: { templateId: template.id },
    });

    if (recurrence.frequency === "NONE") {
      if (existingRule) {
        // Its future work has no rule behind it any more, so take back
        // anything nobody has started.
        await prisma.task.deleteMany({
          where: {
            templateId: template.id,
            origin: "RECURRING",
            status: { in: ["UNASSIGNED", "ASSIGNED"] },
            dueDate: { gte: today() },
          },
        });
        await prisma.recurringRule.delete({ where: { id: existingRule.id } });
      }
    } else {
      // Anchors and a fixed clock time are alternatives: the whole point of an
      // anchor is that the time is not fixed. Anchors win.
      const anchors = (input.anchors ?? []).filter(
        (a, i, all) => all.indexOf(a) === i,
      );
      const fixedStart =
        anchors.length === 0 && input.fixedStart
          ? parseClock(input.fixedStart)
          : null;

      const ruleData = {
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
          anchors,
          fixedStartMinutes: fixedStart,
          fixedEndMinutes:
            fixedStart != null ? fixedStart + input.estimatedMinutes : null,
          sourceNote: "Set in the app",
          active: true,
      };

      if (existingRule) {
        await prisma.recurringRule.update({
          where: { id: existingRule.id },
          data: ruleData,
        });
        // The days it fires on may have changed, so drop future work nobody
        // has picked up; the next run regenerates what the rule now says.
        await prisma.task.deleteMany({
          where: {
            templateId: template.id,
            origin: "RECURRING",
            status: "UNASSIGNED",
            dueDate: { gte: today() },
          },
        });
      } else {
        await prisma.recurringRule.create({
          data: { ...ruleData, templateId: template.id },
        });
      }
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
    return { error: await errorText(error, "errors.couldNotSaveIt") };
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
    const { t } = await getT();
    const templateId = String(formData.get("templateId") ?? "");
    const active = formData.get("active") === "true";

    const template = await prisma.taskTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) return { error: t("errors.taskGone") };
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
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}
