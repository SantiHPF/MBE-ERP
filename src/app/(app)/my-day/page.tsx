import { requireUser } from "@/lib/auth/guards";
import { getDayView } from "@/lib/tasks/day";
import { formatClock, formatDuration } from "@/lib/time";
import { recentTasksForP1n } from "@/lib/p1n/recent-tasks";
import { FileP1nButton } from "../p1n/p1n-form";
import { DayViewClient } from "./day-view";

export const dynamic = "force-dynamic";

export default async function MyDayPage() {
  const user = await requireUser();
  const view = await getDayView(user.id);
  const p1nTasks = await recentTasksForP1n(user.id);

  const date = new Date(`${view.date}T00:00:00Z`);
  const heading = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{heading}</h1>
          {view.rostered && view.availableMinutes > 0 && (
            <p className="page-sub num">
              {formatClock(view.windows[0].start)}–
              {formatClock(view.windows[view.windows.length - 1].end)} ·{" "}
              {formatDuration(view.availableMinutes)} after breaks
            </p>
          )}
        </div>

        {/* Mistakes get noticed while working, not while reading the P1N list. */}
        <FileP1nButton
          tasks={p1nTasks}
          defaultTaskId={view.activeTaskId ?? undefined}
        />
      </div>

      <DayViewClient view={view} />
    </div>
  );
}
