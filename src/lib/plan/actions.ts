"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserOrThrow } from "@/lib/auth/guards";
import { errorText, message } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { toDateOnly } from "@/lib/time";
import { placeOnDay } from "./place";
import { claimTemplate } from "./claim";
import { createFollowers, followersOf } from "./follow-db";
import { ensureSessions } from "./sessions-db";
import { DEFAULT_SESSION_MINUTES, MAX_SESSIONS } from "./sessions";

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

      // A pair is given back as a pair -- keeping the second half of something
      // whose first half you just dropped would be work nobody can start.
      const followers = await followersOf([task.id]);
      if (followers.some((f) => STARTED.includes(f.status))) {
        return { error: t("errors.followerAlreadyStarted") };
      }

      /**
       * A long job is given back whole, and only while none of it has been
       * done. Half a job in the pool is not something anybody can pick up.
       */
      const sittings = await prisma.task.findMany({
        where: { parentTaskId: task.id },
        select: { id: true, status: true },
      });
      if (sittings.some((s) => STARTED.includes(s.status))) {
        return { error: t("errors.alreadyStartedThis") };
      }

      // Work you added yourself disappears; work the rules or a meeting
      // created still needs doing, so it goes back to the pool.
      if (task.origin === "CATALOGUE") {
        // Followers and sittings go with it: both foreign keys cascade.
        await prisma.task.delete({ where: { id: task.id } });
      } else {
        // The sittings are dropped rather than released: the job goes back at
        // its full estimate, and whoever takes it next has it cut against
        // their own calendar rather than inheriting somebody else's week.
        if (sittings.length > 0) {
          await prisma.task.deleteMany({ where: { parentTaskId: task.id } });
        }
        await prisma.task.updateMany({
          where: { id: { in: [task.id, ...followers.map((f) => f.id)] } },
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
      // A job too long for one sitting is cut up now that it has an owner and
      // a calendar to be cut against. A no-op for ordinary work.
      await ensureSessions(parsed.data.taskId);
      revalidate();
      return { ok: true };
    }

    if (!parsed.data.templateId) return { error: t("errors.nothingToAdd") };

    /**
     * The second half of a pair is not something you take on its own -- it
     * would arrive with nothing to follow and the ordering rule would never let
     * you start it. Take the first half and both appear.
     */
    const asFollower = await prisma.taskTemplate.findUnique({
      where: { id: parsed.data.templateId },
      select: { follows: { select: { name: true } } },
    });
    if (asFollower?.follows) {
      return { error: t("errors.waitingOnLeader", asFollower.follows.name) };
    }

    const claim = await claimTemplate(
      parsed.data.templateId,
      user.id,
      user.departmentId,
      date,
    );

    if (claim.outcome === "taken") {
      return {
        error: claim.by
          ? t("errors.alreadyHasIt", claim.by, claim.title)
          : t("errors.somebodyTookIt"),
      };
    }

    if (claim.outcome === "claimed") {
      await placeOnDay(claim.taskId, user.id, date);
      // Whatever goes hand in hand with it comes too, right after. Done before
      // the split, so the follower is placed against the leader's own slot
      // rather than against the first sitting of it.
      const leader = await prisma.task.findUniqueOrThrow({
        where: { id: claim.taskId },
      });
      await createFollowers(leader);
      await ensureSessions(claim.taskId);
    }
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
  /**
   * Twelve hours used to be the ceiling because a task had to fit one day.
   * Long work is now cut into sittings across several, so the ceiling is what
   * the splitter will lay out at its default chunk size -- past that the
   * estimate is a project plan rather than a task.
   */
  estimatedMinutes: z.coerce
    .number()
    .int()
    .min(1, "errors.howLong")
    .max(MAX_SESSIONS * DEFAULT_SESSION_MINUTES, "errors.longerThanAJob"),
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
    // A ten-hour job goes in as one thing and comes out as sittings across
    // the days up to its deadline.
    await ensureSessions(task.id);
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
