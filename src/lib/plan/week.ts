import { prisma } from "@/lib/db";
import { addDays, dateKey, toDateOnly } from "@/lib/time";
import { computeAvailability } from "@/lib/scheduling/availability";

/**
 * The planning board: one row per task, one column per day.
 *
 * Task-first rather than day-first, because most work here repeats. Something
 * like Sucesos happens every day, and picking it out of a catalogue five times
 * is five chances to forget one. Here you find it once and tick the days.
 *
 * A task belongs to one person per day, first come first served -- which is
 * what several catalogue notes already demand ("OJO, max 1 integrante por
 * dia"). Anything nobody takes is handed out by the engine when the week
 * starts, so choosing not to plan never means work goes missing.
 */

export type CellState =
  | "empty" // nothing scheduled; clicking takes it
  | "mine" // yours
  | "theirs" // somebody else got there first
  | "free" // needed this day but unclaimed
  | "locked" // yours, but started or finished
  | "off"; // you do not work that day

export type PlanCell = {
  date: string;
  state: CellState;
  taskId: string | null;
  holder: string | null;
};

export type PlanRow = {
  key: string;
  templateId: string | null;
  name: string;
  category: string | null;
  estimatedMinutes: number;
  notes: string | null;
  /** True when a recurring rule already puts this in the week. */
  recurring: boolean;
  cells: PlanCell[];
  mineCount: number;
};

export type PlanDayHeader = {
  date: string;
  label: string;
  short: string;
  rostered: boolean;
  capacityMinutes: number;
  claimedMinutes: number;
  /** What is still going spare -- the number people actually plan against. */
  freeMinutes: number;
  overBy: number;
};

export type PlanWeek = {
  weekStart: string;
  isCurrentWeek: boolean;
  days: PlanDayHeader[];
  rows: PlanRow[];
  totalClaimed: number;
  totalCapacity: number;
};

const LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function mondayOf(date: Date): Date {
  const day = toDateOnly(date);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

/** The week people are normally planning: the one after this one. */
export function defaultPlanWeek(now: Date = new Date()): Date {
  return addDays(mondayOf(now), 7);
}

const STARTED = ["IN_PROGRESS", "PAUSED", "DONE"];

export async function getPlanWeek(
  userId: string,
  weekStart: Date,
): Promise<PlanWeek> {
  const monday = mondayOf(weekStart);
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
  const lastDay = allDays[6];

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { workingPatterns: true },
  });

  const [overrides, absences, tasks, catalogue, rules] = await Promise.all([
    prisma.dayOverride.findMany({
      where: { userId, date: { gte: monday, lte: lastDay } },
    }),
    prisma.absence.findMany({
      where: { userId, startDate: { lte: lastDay }, endDate: { gte: monday } },
    }),
    prisma.task.findMany({
      where: {
        departmentId: user.departmentId,
        dueDate: { gte: monday, lte: lastDay },
        status: { not: "CANCELLED" },
      },
      include: {
        assignee: { select: { id: true, displayName: true } },
        template: { select: { notes: true, category: true } },
      },
    }),
    prisma.taskTemplate.findMany({
      where: { departmentId: user.departmentId, active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.recurringRule.findMany({
      where: { departmentId: user.departmentId, active: true },
      select: { templateId: true },
    }),
  ]);

  const recurringTemplates = new Set(rules.map((r) => r.templateId));

  // --- day headers, with this person's real capacity
  const claimedByDate = new Map<string, number>();
  for (const t of tasks) {
    if (t.assigneeId !== userId) continue;
    const key = dateKey(t.dueDate);
    claimedByDate.set(key, (claimedByDate.get(key) ?? 0) + t.estimatedMinutes);
  }

  let totalClaimed = 0;
  let totalCapacity = 0;

  const headers: PlanDayHeader[] = allDays.map((date, i) => {
    const key = dateKey(date);
    const availability = computeAvailability({
      date,
      patterns: user.workingPatterns,
      overrides,
      absences,
    });
    const claimed = claimedByDate.get(key) ?? 0;
    const rostered = availability.rostered && availability.availableMinutes > 0;

    if (rostered) totalCapacity += availability.availableMinutes;
    totalClaimed += claimed;

    return {
      date: key,
      label: LABELS[i],
      short: LABELS[i].slice(0, 3),
      rostered,
      capacityMinutes: availability.availableMinutes,
      claimedMinutes: claimed,
      freeMinutes: Math.max(0, availability.availableMinutes - claimed),
      overBy: Math.max(0, claimed - availability.availableMinutes),
    };
  });

  // Drop days nobody works, unless something is already scheduled there.
  const scheduledDates = new Set(tasks.map((t) => dateKey(t.dueDate)));
  const days = headers.filter((d) => d.rostered || scheduledDates.has(d.date));

  // --- one row per catalogue task, plus rows for one-off work with no template
  const tasksByTemplateDate = new Map<string, (typeof tasks)[number]>();
  const untemplated: typeof tasks = [];

  for (const t of tasks) {
    if (t.templateId) {
      tasksByTemplateDate.set(`${t.templateId}:${dateKey(t.dueDate)}`, t);
    } else {
      untemplated.push(t);
    }
  }

  const cellFor = (
    task: (typeof tasks)[number] | undefined,
    day: PlanDayHeader,
  ): PlanCell => {
    if (!task) {
      return {
        date: day.date,
        state: day.rostered ? "empty" : "off",
        taskId: null,
        holder: null,
      };
    }
    if (task.assigneeId === userId) {
      return {
        date: day.date,
        state: STARTED.includes(task.status) ? "locked" : "mine",
        taskId: task.id,
        holder: null,
      };
    }
    if (task.assigneeId === null) {
      return { date: day.date, state: "free", taskId: task.id, holder: null };
    }
    return {
      date: day.date,
      state: "theirs",
      taskId: task.id,
      holder: task.assignee?.displayName ?? "someone",
    };
  };

  const rows: PlanRow[] = catalogue.map((template) => {
    const cells = days.map((day) =>
      cellFor(tasksByTemplateDate.get(`${template.id}:${day.date}`), day),
    );
    return {
      key: `t:${template.id}`,
      templateId: template.id,
      name: template.name,
      category: template.category,
      estimatedMinutes: template.estimatedMinutes,
      notes: template.notes,
      recurring: recurringTemplates.has(template.id),
      cells,
      mineCount: cells.filter((c) => c.state === "mine" || c.state === "locked")
        .length,
    };
  });

  // Meeting actions and ad-hoc work have no catalogue entry, so they get their
  // own rows rather than being invisible on the board.
  for (const task of untemplated) {
    const cells = days.map((day) =>
      cellFor(dateKey(task.dueDate) === day.date ? task : undefined, day),
    );
    rows.push({
      key: `x:${task.id}`,
      templateId: null,
      name: task.title,
      category: task.origin === "MEETING" ? "From a meeting" : "One-off",
      estimatedMinutes: task.estimatedMinutes,
      notes: null,
      recurring: false,
      cells,
      mineCount: cells.filter((c) => c.state === "mine" || c.state === "locked")
        .length,
    });
  }

  return {
    weekStart: dateKey(monday),
    isCurrentWeek: dateKey(monday) === dateKey(mondayOf(new Date())),
    days,
    rows,
    totalClaimed,
    totalCapacity,
  };
}
