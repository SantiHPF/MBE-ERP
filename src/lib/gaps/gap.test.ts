import { describe, it, expect } from "vitest";
import type { DayTask } from "@/lib/tasks/day";
import { breaksBetween, freeSpans, openGap, MIN_OFFER_MINUTES } from "./gap";

/** 09:00-13:00, lunch, 14:00-17:00 -- the shape most of these use. */
const SPLIT_DAY = [
  { start: 540, end: 780 },
  { start: 840, end: 1020 },
];

let seq = 0;

function task(over: Partial<DayTask> = {}): DayTask {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    origin: "RECURRING",
    status: "ASSIGNED",
    estimatedMinutes: 30,
    scheduledStart: null,
    scheduledEnd: null,
    elapsedSeconds: 0,
    runningSince: null,
    pauseReason: null,
    pauseText: null,
    notes: null,
    instructions: null,
    isMeeting: false,
    repeatable: false,
    quantity: 1,
    doneCount: 0,
    unitMinutes: null,
    meetingId: null,
    session: null,
    ...over,
  };
}

/** A task occupying a real slot. */
function at(start: number, end: number, over: Partial<DayTask> = {}): DayTask {
  return task({ scheduledStart: start, scheduledEnd: end, ...over });
}

describe("breaksBetween", () => {
  it("finds the hole between two windows", () => {
    expect(breaksBetween(SPLIT_DAY)).toEqual([{ start: 780, end: 840 }]);
  });

  it("finds nothing in an unbroken day", () => {
    expect(breaksBetween([{ start: 540, end: 1020 }])).toEqual([]);
  });
});

describe("freeSpans", () => {
  it("carves booked work out of the working windows", () => {
    const spans = freeSpans(SPLIT_DAY, [at(600, 660)]);
    expect(spans).toEqual([
      { start: 540, end: 600 },
      { start: 660, end: 780 },
      { start: 840, end: 1020 },
    ]);
  });

  it("counts finished work as spent, not free", () => {
    const spans = freeSpans([{ start: 540, end: 600 }], [
      at(540, 600, { status: "DONE" }),
    ]);
    expect(spans).toEqual([]);
  });

  it("gives back the tail of work that finished early", () => {
    // Booked 09:00-10:00, done at 09:40. Twenty minutes are genuinely free.
    const spans = freeSpans(
      [{ start: 540, end: 600 }],
      [at(540, 600, { status: "DONE" })],
      580,
    );
    expect(spans).toEqual([{ start: 580, end: 600 }]);
  });

  it("does not hand back time that has not arrived yet", () => {
    // Same task, but it is only 09:20 and it is still running.
    const spans = freeSpans(
      [{ start: 540, end: 600 }],
      [at(540, 600, { status: "IN_PROGRESS" })],
      560,
    );
    expect(spans).toEqual([]);
  });

  it("ignores work with no slot, which is what makes it invisible", () => {
    const spans = freeSpans([{ start: 540, end: 600 }], [task()]);
    expect(spans).toEqual([{ start: 540, end: 600 }]);
  });
});

describe("openGap", () => {
  it("is null while a task is running -- you are working, not free", () => {
    const gap = openGap(SPLIT_DAY, [at(540, 600, { status: "IN_PROGRESS" })], 570);
    expect(gap).toBeNull();
  });

  it("is null while a task is paused, so pausing cannot ask for more work", () => {
    const gap = openGap(SPLIT_DAY, [at(540, 600, { status: "PAUSED" })], 570);
    expect(gap).toBeNull();
  });

  it("is null when you are behind: work you should already have started", () => {
    // 10:00 now, and a task was meant to start at 09:30.
    const gap = openGap(SPLIT_DAY, [at(570, 630)], 600);
    expect(gap).toBeNull();
  });

  it("stops at the next task, so filling a gap never makes you late for it", () => {
    // Free from 10:00, next task at 11:00.
    const gap = openGap(SPLIT_DAY, [at(660, 720)], 600);
    expect(gap).toMatchObject({ start: 600, end: 660, minutes: 60 });
    expect(gap!.segments).toEqual([{ start: 600, end: 660 }]);
  });

  it("runs to the end of the shift when everything is finished", () => {
    const gap = openGap(SPLIT_DAY, [at(540, 600, { status: "DONE" })], 600);
    expect(gap).toMatchObject({ start: 600, end: 1020, minutes: 360 });
  });

  it("opens the moment you finish early, not when the slot was due to end", () => {
    // Booked until 10:00, finished at 09:40, nothing else until 11:00.
    const gap = openGap(SPLIT_DAY, [at(540, 600, { status: "DONE" }), at(660, 720)], 580);
    expect(gap).toMatchObject({ start: 580, end: 660, minutes: 80 });
  });

  it("splits around the break rather than counting lunch as working time", () => {
    // Free from 12:30. Total to the end of the day is 30 + 180, not 30 + 60 + 180.
    const gap = openGap(SPLIT_DAY, [], 750);
    expect(gap!.segments).toEqual([
      { start: 750, end: 780 },
      { start: 840, end: 1020 },
    ]);
    expect(gap!.minutes).toBe(210);
  });

  it("offers unplaced work as a gap rather than treating it as lateness", () => {
    // Owed, but the engine never found it a slot, so it cannot be late.
    const gap = openGap(SPLIT_DAY, [task({ estimatedMinutes: 45 })], 600);
    expect(gap).not.toBeNull();
    expect(gap!.end).toBe(1020);
  });

  it("is null once the shift is over", () => {
    expect(openGap(SPLIT_DAY, [], 1020)).toBeNull();
    expect(openGap(SPLIT_DAY, [], 1100)).toBeNull();
  });

  it("is null for a gap too small to be worth interrupting anybody about", () => {
    const gap = openGap(SPLIT_DAY, [at(600 + MIN_OFFER_MINUTES - 1, 660)], 600);
    expect(gap).toBeNull();
  });

  it("is null when the person is not rostered at all", () => {
    expect(openGap([], [], 600)).toBeNull();
  });

  it("measures from now, not from the start of the free stretch", () => {
    // The morning is free but it is already 12:00: three hours left, not four.
    const gap = openGap([{ start: 540, end: 1020 }], [], 720);
    expect(gap!.minutes).toBe(300);
    expect(gap!.start).toBe(720);
  });
});
