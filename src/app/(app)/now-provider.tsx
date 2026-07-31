"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { DayTask } from "@/lib/tasks/day";
import type { NowState } from "@/lib/tasks/now";
import { openGap } from "@/lib/gaps/gap";
import { nowMinutesIn } from "@/lib/tasks/pace";
import { PauseDialog } from "./my-day/pause-dialog";
import { BlockedDialog } from "./my-day/blocked-dialog";
import { NextUpDialog } from "./my-day/next-up-dialog";
import { CloseDayDialog } from "./my-day/close-day-dialog";
import { FillerDialog } from "./my-day/filler-dialog";
import { NowBar } from "./now-bar";

/**
 * The one place that knows what you are doing, wherever you are.
 *
 * The dialogs live here rather than on My Day because the bar can now start,
 * pause and finish work from any page -- and two copies of the pause dialog,
 * one mounted by the bar and one by the page, would eventually both be open.
 * My Day's own card reaches for these through useNow() instead of mounting
 * its own.
 */

type NowContext = {
  state: NowState;
  /** Running or paused, if anything is. */
  active: DayTask | null;
  /** What to do next when nothing is running. */
  next: DayTask | null;
  pause: (taskId: string) => void;
  /** "I cannot do this one": opens the reason-and-choice dialog. */
  blocked: (taskId: string) => void;
  /** Call after a task is completed: offers the next one. */
  completed: (taskId: string) => void;
  closeDay: () => void;
  /** Ask for something to fill `minutes` of free time. */
  fillGap: (minutes: number, asked?: boolean) => void;
};

const Ctx = createContext<NowContext | null>(null);

export function useNow(): NowContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNow() outside NowProvider");
  return ctx;
}

export function NowProvider({
  state,
  zone,
  children,
}: {
  state: NowState;
  zone: string;
  children: React.ReactNode;
}) {
  const [pausing, setPausing] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);

  /**
   * Tomorrow, derived from the day the server rendered rather than from the
   * browser's clock -- a laptop in another timezone would otherwise offer a
   * date the scheduling zone does not agree with.
   */
  const tomorrow = useMemo(() => {
    const d = new Date(`${state.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [state.date]);
  const [finished, setFinished] = useState<string | null>(null);
  const [closingDay, setClosingDay] = useState(false);
  const [filling, setFilling] = useState<{
    minutes: number;
    asked: boolean;
  } | null>(null);
  /**
   * Offers turned down, so "something else" does not come back round to the
   * same task. Kept in memory on purpose: "not now" is a comment on this
   * moment, not a decision about the work, and it should not outlive the page.
   */
  const [skipped, setSkipped] = useState<string[]>([]);

  const active = useMemo(
    () => state.tasks.find((t) => t.id === state.activeTaskId) ?? null,
    [state.tasks, state.activeTaskId],
  );
  const next = useMemo(
    () => state.tasks.find((t) => t.id === state.nextTaskId) ?? null,
    [state.tasks, state.nextTaskId],
  );

  /**
   * What to offer after finishing something.
   *
   * Excluded by id rather than by status: the callback fires before the page
   * revalidates, so the task just completed can still read as IN_PROGRESS.
   */
  const nextUp = useMemo(() => {
    if (!finished) return null;
    const owed = state.tasks
      .filter(
        (t) =>
          t.id !== finished &&
          ["ASSIGNED", "IN_PROGRESS", "PAUSED", "ORPHANED"].includes(t.status),
      )
      .sort(
        (a, b) =>
          (a.scheduledStart ?? Number.MAX_SAFE_INTEGER) -
          (b.scheduledStart ?? Number.MAX_SAFE_INTEGER),
      );
    return owed[0] ?? null;
  }, [finished, state.tasks]);

  const finishedTask = finished
    ? (state.tasks.find((t) => t.id === finished) ?? null)
    : null;

  // A break sitting between the two is worth saying, rather than implying the
  // next task should start this second.
  const breakBefore = useMemo(() => {
    if (!nextUp?.scheduledStart) return null;
    for (let i = 1; i < state.windows.length; i++) {
      const gap = {
        start: state.windows[i - 1].end,
        end: state.windows[i].start,
      };
      if (
        gap.end <= nextUp.scheduledStart &&
        (finishedTask?.scheduledEnd == null || gap.start >= finishedTask.scheduledEnd)
      ) {
        return gap;
      }
    }
    return null;
  }, [nextUp, state.windows, finishedTask]);

  /**
   * Finishing the last thing on the list.
   *
   * NextUpDialog has nothing to offer here, so this used to be the moment the
   * app went quiet. It is also the only moment interrupting somebody is
   * clearly right -- they have just put something down and are looking for
   * what is next -- so the filler opens by itself, and only here. Every other
   * gap is an unobtrusive button in the bar.
   *
   * The completed task is masked to DONE for the same reason nextUp excludes
   * it: this runs before the page revalidates.
   */
  const finishedEarly = useMemo(() => {
    if (!finished || nextUp || state.closed) return null;
    const tasks = state.tasks.map((task) =>
      task.id === finished ? { ...task, status: "DONE" } : task,
    );
    return openGap(state.windows, tasks, nowMinutesIn(zone));
  }, [finished, nextUp, state.tasks, state.windows, state.closed, zone]);

  useEffect(() => {
    if (finishedEarly) setFilling({ minutes: finishedEarly.minutes, asked: false });
  }, [finishedEarly]);

  const value = useMemo<NowContext>(
    () => ({
      state,
      active,
      next,
      pause: setPausing,
      blocked: setBlocking,
      completed: setFinished,
      closeDay: () => setClosingDay(true),
      fillGap: (minutes, asked = false) => setFilling({ minutes, asked }),
    }),
    [state, active, next],
  );

  const leftovers = useCallback(
    () =>
      state.tasks
        .filter((t) =>
          ["ASSIGNED", "IN_PROGRESS", "PAUSED", "ORPHANED"].includes(t.status),
        )
        .sort(
          (a, b) =>
            (a.scheduledStart ?? Number.MAX_SAFE_INTEGER) -
            (b.scheduledStart ?? Number.MAX_SAFE_INTEGER),
        ),
    [state.tasks],
  );

  return (
    <Ctx.Provider value={value}>
      {children}

      <NowBar zone={zone} />
      {/* Keeps the fixed bar from covering the last row of any page. */}
      <div aria-hidden className="h-16" />

      {pausing && (
        <PauseDialog
          taskId={pausing}
          title={state.tasks.find((t) => t.id === pausing)?.title ?? ""}
          onClose={() => setPausing(null)}
        />
      )}

      {blocking && (
        <BlockedDialog
          taskId={blocking}
          title={state.tasks.find((t) => t.id === blocking)?.title ?? ""}
          tomorrow={tomorrow}
          onClose={() => setBlocking(null)}
        />
      )}

      {nextUp && (
        <NextUpDialog
          task={nextUp}
          finishedTitle={finishedTask?.title ?? null}
          breakBefore={breakBefore}
          onClose={() => setFinished(null)}
          onStarted={() => setFinished(null)}
        />
      )}

      {filling && (
        <FillerDialog
          gapMinutes={filling.minutes}
          asked={filling.asked}
          skipped={skipped}
          onSkip={(id) => setSkipped((ids) => [...ids, id])}
          onClose={() => {
            setFilling(null);
            setFinished(null);
          }}
          onStarted={() => {
            setFilling(null);
            setFinished(null);
          }}
        />
      )}

      {closingDay && (
        <CloseDayDialog
          leftovers={leftovers()}
          today={state.date}
          onClose={() => setClosingDay(false)}
          onClosed={() => setClosingDay(false)}
        />
      )}
    </Ctx.Provider>
  );
}
