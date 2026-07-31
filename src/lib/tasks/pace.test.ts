import { describe, expect, it } from "vitest";
import {
  minutesLeftInDay,
  nowMinutesIn,
  pace,
  remainingWorkMinutes,
  type PaceTask,
} from "./pace";

const at = (h: number, m = 0) => h * 60 + m;
/** 09:00-14:00 and 15:00-18:00: a normal day with an hour for lunch. */
const SHIFT = [
  { start: at(9), end: at(14) },
  { start: at(15), end: at(18) },
];

function task(over: Partial<PaceTask> = {}): PaceTask {
  return { status: "ASSIGNED", estimatedMinutes: 30, elapsedSeconds: 0, ...over };
}

describe("minutesLeftInDay", () => {
  it("counts both stretches at the start of the day", () => {
    expect(minutesLeftInDay(SHIFT, at(9))).toBe(8 * 60);
  });

  /** The point of using windows rather than end-minus-now. */
  it("does not count the lunch hour as time you could work in", () => {
    // 13:00 to 18:00 is five hours on the clock but only four of work.
    expect(minutesLeftInDay(SHIFT, at(13))).toBe(4 * 60);
  });

  it("ignores a stretch already behind you", () => {
    expect(minutesLeftInDay(SHIFT, at(15, 30))).toBe(150);
  });

  it("is zero after the day ends", () => {
    expect(minutesLeftInDay(SHIFT, at(19))).toBe(0);
  });

  it("is zero before a day you do not work", () => {
    expect(minutesLeftInDay([], at(10))).toBe(0);
  });

  it("counts the whole day when asked before it starts", () => {
    expect(minutesLeftInDay(SHIFT, at(7))).toBe(8 * 60);
  });
});

describe("remainingWorkMinutes", () => {
  it("adds up what has not been done", () => {
    expect(
      remainingWorkMinutes([task({ estimatedMinutes: 30 }), task({ estimatedMinutes: 45 })]),
    ).toBe(75);
  });

  it("ignores finished and cancelled work", () => {
    expect(
      remainingWorkMinutes([
        task({ status: "DONE", estimatedMinutes: 60 }),
        task({ status: "CANCELLED", estimatedMinutes: 60 }),
        task({ estimatedMinutes: 20 }),
      ]),
    ).toBe(20);
  });

  /**
   * The regression lock on the worst of the split-job double-counts.
   *
   * pace() is fed the day's tasks, which come from a scheduledDate filter. A
   * parent (status SPLIT) never has one, so it can never reach here -- and if
   * it ever did, a ten-hour job would read as ten hours of work owed today
   * instead of the one sitting actually planned.
   */
  it("counts one sitting's minutes, not the whole job's", () => {
    expect(remainingWorkMinutes([task({ estimatedMinutes: 150 })])).toBe(150);
  });

  it("does not ask twice for time already spent on the running task", () => {
    expect(
      remainingWorkMinutes([
        task({ status: "IN_PROGRESS", estimatedMinutes: 30, elapsedSeconds: 20 * 60 }),
      ]),
    ).toBe(10);
  });

  it("floors an overrun at zero rather than crediting it", () => {
    // Two hours into a thirty-minute job. That is not ninety minutes of slack.
    expect(
      remainingWorkMinutes([
        task({ status: "IN_PROGRESS", estimatedMinutes: 30, elapsedSeconds: 2 * 3600 }),
      ]),
    ).toBe(0);
  });
});

describe("pace", () => {
  it("is ahead with room to spare", () => {
    const result = pace(SHIFT, [task({ estimatedMinutes: 60 })], at(9));
    expect(result.slackMinutes).toBe(7 * 60);
    expect(result.band).toBe("ahead");
  });

  it("is behind when the work no longer fits", () => {
    const result = pace(
      SHIFT,
      [task({ estimatedMinutes: 120 }), task({ estimatedMinutes: 120 })],
      at(16, 30),
    );
    // Ninety minutes left, four hours of work owed.
    expect(result.minutesLeft).toBe(90);
    expect(result.remainingMinutes).toBe(240);
    expect(result.slackMinutes).toBe(-150);
    expect(result.band).toBe("behind");
  });

  it("sits on 'on time' in the narrow band just above fitting", () => {
    const result = pace(SHIFT, [task({ estimatedMinutes: 170 })], at(15));
    expect(result.slackMinutes).toBe(10);
    expect(result.band).toBe("onTime");
  });

  /**
   * The reason this is measured against the day rather than the task: a job
   * finished early has to buy back the slip from the one before it.
   */
  it("recovers when something is finished early", () => {
    const behind = pace(
      SHIFT,
      [task({ estimatedMinutes: 120 }), task({ estimatedMinutes: 90 })],
      at(16),
    );
    expect(behind.band).toBe("behind");

    const recovered = pace(
      SHIFT,
      [task({ status: "DONE", estimatedMinutes: 120 }), task({ estimatedMinutes: 90 })],
      at(16),
    );
    expect(recovered.band).toBe("ahead");
  });

  it("is never behind with nothing left to do", () => {
    // Five minutes of the day left and no work owed is not a problem.
    const result = pace(SHIFT, [task({ status: "DONE" })], at(17, 55));
    expect(result.band).toBe("ahead");
  });

  it("is behind after the day ends with work still owed", () => {
    const result = pace(SHIFT, [task({ estimatedMinutes: 30 })], at(19));
    expect(result.minutesLeft).toBe(0);
    expect(result.band).toBe("behind");
  });

  it("handles a day off with nothing scheduled", () => {
    const result = pace([], [], at(10));
    expect(result.slackMinutes).toBe(0);
    expect(result.band).toBe("ahead");
  });
});

describe("nowMinutesIn", () => {
  it("reads the wall clock in the schedule's zone, not the server's", () => {
    // 12:00 UTC is 14:00 in Madrid in July.
    const noonUtc = new Date("2026-07-28T12:00:00Z");
    expect(nowMinutesIn("Europe/Madrid", noonUtc)).toBe(at(14));
    expect(nowMinutesIn("UTC", noonUtc)).toBe(at(12));
  });

  it("reports midnight as zero, not 1440", () => {
    expect(nowMinutesIn("UTC", new Date("2026-07-28T00:00:00Z"))).toBe(0);
  });
});
