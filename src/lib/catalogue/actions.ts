"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow, hasRole } from "@/lib/auth/guards";
import { errorText, fail } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { parseClock, today, toDateOnly } from "@/lib/time";
import { depthOf, MAX_CHAIN, wouldCycle } from "@/lib/plan/follow";
import { SHIFT_SPLIT_MINUTES } from "@/lib/scheduling/half";
import { DEFAULT_SESSION_MINUTES, MAX_SESSIONS } from "@/lib/plan/sessions";

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
  /**
   * Longer than a day is allowed now: a catalogue entry is exactly where a
   * project-shaped job lives, and anything over sessionMinutes is cut into
   * sittings when somebody takes it. The ceiling is what the splitter will
   * lay out at its default chunk size.
   */
  estimatedMinutes: z.coerce
    .number()
    .int()
    .min(1, "errors.howLongDoesItTake")
    .max(MAX_SESSIONS * DEFAULT_SESSION_MINUTES, "errors.longerThanAJob"),
  /** How long one sitting of it should be. Null uses the default. */
  sessionMinutes: z.coerce
    .number()
    .int()
    .min(15, "errors.sittingTooShort")
    .max(12 * 60, "errors.longerThanADay")
    .optional(),
  notes: z.string().trim().max(2000).optional(),
  instructions: z.string().trim().max(500).optional(),
  isMeeting: z.boolean().optional(),
  repeatable: z.boolean().optional(),
  priority: z.enum(["MUST", "NORMAL", "SPARE_TIME"]).default("NORMAL"),
  instancesPerOccurrence: z.coerce.number().int().min(1).max(20).optional(),
  fixedStart: z.string().optional(),
  /// Keep it in one half of the day. Anchors override it, being more specific.
  shiftHalf: z.enum(["MORNING", "AFTERNOON"]).optional(),
  /// The entry this one comes straight after, when two jobs go hand in hand.
  followsId: z.string().optional(),
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
      sessionMinutes: formData.get("sessionMinutes") || undefined,
      notes: formData.get("notes") || undefined,
      instructions: formData.get("instructions") || undefined,
      isMeeting: formData.get("isMeeting") === "on",
      repeatable: formData.get("repeatable") === "on",
      priority: formData.get("priority") || "NORMAL",
      instancesPerOccurrence: formData.get("instancesPerOccurrence") || 1,
      fixedStart: formData.get("fixedStart") || undefined,
      shiftHalf: formData.get("shiftHalf") || undefined,
      followsId: formData.get("followsId") || undefined,
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

    /**
     * A clock time and a half of the day that disagree.
     *
     * "At 09:00, in the afternoon" describes nothing placeable, and the engine
     * would silently drop the task rather than explain itself. Caught here,
     * where somebody can still fix it.
     */
    if (input.shiftHalf && recurrence.frequency !== "NONE" && input.fixedStart) {
      const startMinutes = parseClock(input.fixedStart);
      const inMorning = startMinutes < SHIFT_SPLIT_MINUTES;
      if (
        (input.shiftHalf === "MORNING" && !inMorning) ||
        (input.shiftHalf === "AFTERNOON" && inMorning)
      ) {
        return { error: t("errors.shiftHalfContradictsTime") };
      }
    }

    /**
     * "Comes after" has to stay a tree.
     *
     * A cycle would make chainFrom() walk for ever if it were not guarded, and
     * would describe a day nobody could ever start. Checked here, at the only
     * point a link is created, rather than defended at every point one is read.
     */
    if (input.followsId) {
      const leader = await prisma.taskTemplate.findUnique({
        where: { id: input.followsId },
        select: { departmentId: true },
      });
      if (!leader) return { error: t("errors.notInCatalogue") };
      if (leader.departmentId !== input.departmentId) {
        // The pair is done by one person, so it cannot span two departments.
        return { error: t("errors.followLeaderOtherDepartment") };
      }

      const links = await prisma.taskTemplate.findMany({
        where: { departmentId: input.departmentId },
        select: { id: true, followsId: true },
      });

      // A new entry has no id yet, so it cannot be part of a cycle; only an
      // edit can close one.
      if (input.templateId) {
        if (input.templateId === input.followsId) {
          return { error: t("errors.followsItself") };
        }
        const proposed = links.map((l) =>
          l.id === input.templateId ? { ...l, followsId: input.followsId! } : l,
        );
        if (wouldCycle(input.templateId, input.followsId, links)) {
          return { error: t("errors.followWouldLoop") };
        }
        if (depthOf(input.templateId, proposed) > MAX_CHAIN) {
          return { error: t("errors.followChainTooLong", MAX_CHAIN) };
        }
      } else if (depthOf(input.followsId, links) >= MAX_CHAIN) {
        return { error: t("errors.followChainTooLong", MAX_CHAIN) };
      }
    }

    const data = {
      departmentId: input.departmentId,
      name: input.name,
      category: input.category || null,
      estimatedMinutes: input.estimatedMinutes,
      sessionMinutes: input.sessionMinutes ?? null,
      notes: input.notes || null,
      instructions: input.instructions || null,
      isMeeting: input.isMeeting ?? false,
      repeatable: input.repeatable ?? false,
      priority: input.priority,
      shiftHalf: input.shiftHalf ?? null,
      followsId: input.followsId || null,
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
