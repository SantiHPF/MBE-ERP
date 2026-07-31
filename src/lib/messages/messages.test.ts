import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The inbox is a fold over one query rather than a threads table, so the
 * folding is the part worth testing: who the other person is depends on which
 * end of the message you are, and getting that backwards would show everybody
 * their own name down the left-hand side.
 */

const db = {
  message: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  user: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth/guards", () => ({
  hasRole: () => false,
}));

const ME = "me";
const THEM = "them";

const NAMES: Record<string, string> = { [ME]: "Me", [THEM]: "Them" };
const person = (id: string) => ({ id, displayName: NAMES[id] });

let seq = 0;
function message(over: Record<string, unknown> = {}) {
  seq += 1;
  const base = {
    id: `m${seq}`,
    senderId: ME,
    recipientId: THEM,
    body: `Message ${seq}`,
    readAt: null,
    // Each one a minute after the last, so ordering is unambiguous.
    createdAt: new Date(Date.UTC(2026, 6, 30, 12, seq)),
    taskId: null,
    task: null,
    ...over,
  };
  // The joined rows are derived, so overriding an id cannot leave the names
  // pointing at the wrong people the way hand-written fixtures would.
  return { ...base, sender: person(base.senderId), recipient: person(base.recipientId) };
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
});

describe("inbox", () => {
  it("lists the other person, whichever end of the message you are", async () => {
    const { inbox } = await import("./db");
    db.message.findMany.mockResolvedValue([
      message({ senderId: THEM, recipientId: ME }),
    ]);

    const out = await inbox(ME);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe(THEM);
    expect(out[0].displayName).toBe("Them");
  });

  it("keeps one row per person, not one per message", async () => {
    const { inbox } = await import("./db");
    db.message.findMany.mockResolvedValue([message(), message(), message()]);

    expect(await inbox(ME)).toHaveLength(1);
  });

  it("shows the newest message as the preview", async () => {
    const { inbox } = await import("./db");
    // The query orders newest first, so the first row seen is the preview.
    db.message.findMany.mockResolvedValue([
      message({ body: "newest" }),
      message({ body: "older" }),
    ]);

    expect((await inbox(ME))[0].lastBody).toBe("newest");
  });

  it("counts only unread messages sent to you", async () => {
    const { inbox } = await import("./db");
    db.message.findMany.mockResolvedValue([
      // Theirs, unread: counts.
      message({ senderId: THEM, recipientId: ME }),
      message({ senderId: THEM, recipientId: ME }),
      // Theirs, already read: does not.
      message({ senderId: THEM, recipientId: ME, readAt: new Date() }),
      // Yours, unread by them: not your problem.
      message(),
    ]);

    expect((await inbox(ME))[0].unread).toBe(2);
  });

  it("says whether the last word was theirs", async () => {
    const { inbox } = await import("./db");
    db.message.findMany.mockResolvedValue([
      message({ senderId: THEM, recipientId: ME }),
    ]);
    expect((await inbox(ME))[0].fromThem).toBe(true);

    vi.clearAllMocks();
    db.message.findMany.mockResolvedValue([message()]);
    expect((await inbox(ME))[0].fromThem).toBe(false);
  });
});

describe("thread", () => {
  it("marks your own messages as yours", async () => {
    const { thread } = await import("./db");
    db.message.findMany.mockResolvedValue([
      message(),
      message({ senderId: THEM, recipientId: ME }),
    ]);

    const out = await thread(ME, THEM);
    expect(out.map((m) => m.mine)).toEqual([true, false]);
  });

  it("carries the task a message was sent about", async () => {
    const { thread } = await import("./db");
    db.message.findMany.mockResolvedValue([
      message({ taskId: "t1", task: { id: "t1", title: "Sucesos" } }),
    ]);

    expect((await thread(ME, THEM))[0].task).toEqual({
      id: "t1",
      title: "Sucesos",
    });
  });

  it("has no task for an ordinary message", async () => {
    const { thread } = await import("./db");
    db.message.findMany.mockResolvedValue([message()]);
    expect((await thread(ME, THEM))[0].task).toBeNull();
  });
});

describe("who anyone may write to", () => {
  it("offers everybody who still works here, whatever their department", async () => {
    /**
     * This was once scoped to your own department, with managers able to reach
     * further. It meant a worker sent a message from HR had no way to answer
     * it. Anybody may now write to anybody.
     */
    const { canWriteTo } = await import("./db");
    db.user.findMany.mockResolvedValue([]);

    await canWriteTo({ id: ME, departmentId: "atic", role: "WORKER" } as never);

    const where = db.user.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ active: true, id: { not: ME } });
  });

  it("does not offer you yourself", async () => {
    const { canWriteTo } = await import("./db");
    db.user.findMany.mockResolvedValue([]);

    await canWriteTo({ id: ME, departmentId: "atic", role: "ADMIN" } as never);

    expect(db.user.findMany.mock.calls[0][0].where.id).toEqual({ not: ME });
  });

  it("leaves out people who have left", async () => {
    const { canWriteTo } = await import("./db");
    db.user.findMany.mockResolvedValue([]);

    await canWriteTo({ id: ME, departmentId: "atic", role: "WORKER" } as never);

    expect(db.user.findMany.mock.calls[0][0].where.active).toBe(true);
  });
});
