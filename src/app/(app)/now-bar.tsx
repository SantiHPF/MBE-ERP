"use client";

import { useActionState, useEffect, useState } from "react";
import type { DayTask } from "@/lib/tasks/day";
import { nowMinutesIn, pace, type PaceBand } from "@/lib/tasks/pace";
import { formatDuration } from "@/lib/time";
import { useT } from "@/lib/i18n/client";
import { reopenDay } from "@/lib/attendance/actions";
import { TaskButton } from "./my-day/task-button";
import { startTaskFor } from "./my-day/start-task";
import { useNow } from "./now-provider";

/**
 * What you are doing, pinned to the bottom of every page.
 *
 * It used to be rendered by My Day, so the moment you opened Team or the CRM
 * the one thing telling you what to work on vanished, along with pause and
 * complete. It lives in the app layout now, which is the only place that is
 * genuinely always on screen.
 */

const BAND_STYLE: Record<PaceBand, string> = {
  ahead: "text-run",
  onTime: "text-muted",
  behind: "text-pause",
};

export function NowBar({ zone }: { zone: string }) {
  const { t } = useT();
  const { state, active, next, pause, completed, closeDay } = useNow();

  /**
   * The clock ticks locally.
   *
   * The layout does not re-render as you move between pages, so anything
   * computed on the server would freeze at whatever it was when you last
   * caused a revalidation. Everything time-dependent here is derived from
   * instants instead, which keeps it honest with no refetching.
   */
  const [minutes, setMinutes] = useState(() => nowMinutesIn(zone));
  useEffect(() => {
    const id = setInterval(() => setMinutes(nowMinutesIn(zone)), 15_000);
    return () => clearInterval(id);
  }, [zone]);

  const live = pace(state.windows, liveTasks(state.tasks), minutes);

  return (
    <div
      /* Stops short of the sidebar from `lg` up, whose own footer is pinned
         to the bottom of the screen -- a full-width bar sat on top of the
         name and the sign-out button. */
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/97 backdrop-blur lg:left-[208px]"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 lg:px-8">
        {active ? (
          <>
            <span
              className={`h-7 w-[3px] shrink-0 rounded-full ${
                active.status === "IN_PROGRESS" ? "bg-run" : "bg-pause"
              }`}
            />
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                className={`eyebrow ${
                  active.status === "IN_PROGRESS" ? "text-run" : "text-pause"
                }`}
              >
                {active.status === "IN_PROGRESS"
                  ? t("myDay.runningNow")
                  : t("myDay.paused")}
              </span>
              <span className="truncate text-[13.5px] font-semibold">
                {active.title}
              </span>
            </span>
          </>
        ) : (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="eyebrow">{t("myDay.today")}</span>
            <span className="truncate text-[13.5px] font-medium text-muted">
              {state.closed
                ? t("attendance.dayClosed")
                : next
                  ? t("now.upNext", next.title)
                  : t("myDay.nothingRunning")}
            </span>
          </span>
        )}

        <span className="flex-1" />

        {!state.closed && state.rostered && <PaceReading state={live} />}

        <div className="flex shrink-0 items-center gap-1.5">
          {active ? (
            <TaskButton.Controls
              task={active}
              onPause={() => pause(active.id)}
              onCompleted={completed}
            />
          ) : state.closed ? (
            <ReopenButton />
          ) : (
            <>
              {/* Starting the day from wherever you happen to be, rather than
                  navigating back to My Day to press one button. */}
              {next && <StartNext task={next} />}
              <button type="button" onClick={closeDay} className="btn btn-sm">
                {t("attendance.closeDay")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Tasks with their elapsed time brought up to date.
 *
 * pace() reads elapsedSeconds, which was true when the server rendered it. For
 * a task that has been running while you read three other pages, that is an
 * undercount -- and the pace would drift further behind the longer you stayed
 * away. Recomputing from runningSince fixes it without a round trip.
 */
function liveTasks(tasks: DayTask[]): DayTask[] {
  const now = Date.now();
  return tasks.map((task) => {
    if (!task.runningSince) return task;
    const since = Date.parse(task.runningSince);
    return {
      ...task,
      elapsedSeconds: Math.max(task.elapsedSeconds, Math.round((now - since) / 1000)),
    };
  });
}

function StartNext({ task }: { task: DayTask }) {
  const { t } = useT();
  const [state, start, starting] = useActionState(
    async (prev: { error?: string }) => startTaskFor(task, prev),
    {},
  );

  return (
    <form action={start}>
      <button
        type="submit"
        disabled={starting}
        title={task.title}
        className="btn btn-sm btn-primary"
      >
        {starting ? t("myDay.starting") : t("myDay.start")}
      </button>
      {state.error && <span className="sr-only">{state.error}</span>}
    </form>
  );
}

function ReopenButton() {
  const { t } = useT();
  const [, reopen] = useActionState(reopenDay, {});
  return (
    <form action={reopen}>
      <button type="submit" className="btn btn-sm">
        {t("attendance.reopenDay")}
      </button>
    </form>
  );
}

/**
 * The day's slack, in words.
 *
 * Deliberately one number rather than two. "This task is 5 minutes over and
 * the day is 20 behind" is two things competing for the same glance, and the
 * one that matters is whether you get through the day.
 */
function PaceReading({ state }: { state: ReturnType<typeof pace> }) {
  const { t } = useT();
  const slack = Math.abs(state.slackMinutes);

  return (
    <span className="flex shrink-0 flex-col text-right leading-tight">
      <span className="eyebrow">{t("pace.label")}</span>
      <span className={`num text-[13px] font-semibold ${BAND_STYLE[state.band]}`}>
        {state.band === "behind"
          ? t("pace.behind", formatDuration(slack))
          : state.remainingMinutes === 0
            ? t("pace.allDone")
            : t("pace.spare", formatDuration(slack))}
      </span>
    </span>
  );
}
