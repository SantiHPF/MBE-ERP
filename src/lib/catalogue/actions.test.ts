import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the real save action with only the session and cache mocked, so
 * the zod parsing, the recurrence reading and the Prisma writes are the ones
 * that actually run in the app.
 */

const actor = {
  id: "u1",
  username: "ana",
  displayName: "Ana",
  role: "MANAGER" as const,
  locale: "EN" as const,
  departmentId: "dept-1",
  departmentName: "Ops",
};

vi.mock("@/lib/auth/guards", () => ({
  requireUserOrThrow: vi.fn(async () => actor),
  hasRole: (u: { role: string }, min: string) =>
    min === "MANAGER" ? u.role !== "WORKER" : true,
}));

vi.mock("@/lib/i18n/server", () => ({
  // Return the key, so a failure names the message rather than hiding it.
  getT: vi.fn(async () => ({ t: (k: string) => k, locale: "EN", dict: {} })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const db = {
  taskTemplate: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  recurringRule: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  task: { deleteMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: db }));

const { saveCatalogueEntry } = await import("./actions");

/** What the catalogue form posts when "at points in the shift" is chosen. */
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.taskTemplate.findFirst.mockResolvedValue(null);
  db.taskTemplate.create.mockResolvedValue({ id: "tpl-1" });
  db.taskTemplate.update.mockResolvedValue({ id: "tpl-1" });
  db.recurringRule.findFirst.mockResolvedValue(null);
  db.recurringRule.create.mockResolvedValue({ id: "rule-1" });
  db.recurringRule.update.mockResolvedValue({ id: "rule-1" });
  db.task.deleteMany.mockResolvedValue({ count: 0 });
});

describe("saving an anchored catalogue entry", () => {
  const anchored = {
    departmentId: "dept-1",
    name: "Till check",
    estimatedMinutes: "10",
    priority: "NORMAL",
    frequency: "WEEKLY",
    weekdays: ["1", "2", "3", "4", "5"],
    anchors: ["ARRIVAL", "BEFORE_BREAK", "AFTER_BREAK", "BEFORE_LEAVING"],
  };

  it("saves without error", async () => {
    const result = await saveCatalogueEntry({}, form(anchored));
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("stores the anchors on the rule", async () => {
    await saveCatalogueEntry({}, form(anchored));

    expect(db.recurringRule.create).toHaveBeenCalledOnce();
    const data = db.recurringRule.create.mock.calls[0][0].data;
    expect(data.anchors).toEqual([
      "ARRIVAL",
      "BEFORE_BREAK",
      "AFTER_BREAK",
      "BEFORE_LEAVING",
    ]);
    // Anchors and a clock time are alternatives.
    expect(data.fixedStartMinutes).toBeNull();
  });

  it("saves a single anchor", async () => {
    const result = await saveCatalogueEntry(
      {},
      form({ ...anchored, anchors: ["BEFORE_BREAK"] }),
    );
    expect(result.error).toBeUndefined();
  });

  it("still saves a plain fixed-time entry", async () => {
    const result = await saveCatalogueEntry(
      {},
      form({
        departmentId: "dept-1",
        name: "Stock count",
        estimatedMinutes: "30",
        priority: "NORMAL",
        frequency: "WEEKLY",
        weekdays: ["1"],
        fixedStart: "09:00",
        instancesPerOccurrence: "2",
      }),
    );

    expect(result.error).toBeUndefined();
    const data = db.recurringRule.create.mock.calls[0][0].data;
    expect(data.fixedStartMinutes).toBe(540);
    expect(data.anchors).toEqual([]);
  });

  it("updates an existing rule's anchors in place", async () => {
    db.recurringRule.findFirst.mockResolvedValue({ id: "rule-1" });

    const result = await saveCatalogueEntry(
      {},
      form({ ...anchored, templateId: "tpl-1" }),
    );

    expect(result.error).toBeUndefined();
    expect(db.recurringRule.update).toHaveBeenCalledOnce();
    expect(db.recurringRule.create).not.toHaveBeenCalled();
  });
});
