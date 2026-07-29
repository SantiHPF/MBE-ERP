import { requireUser } from "@/lib/auth/guards";
import { getT } from "@/lib/i18n/server";
import { formatLongDate, fromDateKey } from "@/lib/i18n/dates";
import { getDayView } from "@/lib/tasks/day";
import { formatClock, formatDuration, scheduleZone } from "@/lib/time";
import { recentTasksForP1n } from "@/lib/p1n/recent-tasks";
import { FileP1nButton } from "../p1n/p1n-form";
import { DayViewClient } from "./day-view";

export const dynamic = "force-dynamic";

export default async function MyDayPage() {
  const user = await requireUser();
  const { t, locale } = await getT();
  const view = await getDayView(user.id);
  const p1nTasks = await recentTasksForP1n(user.id);

  const heading = formatLongDate(fromDateKey(view.date), locale);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{heading}</h1>
          {view.rostered && view.availableMinutes > 0 && (
            <p className="page-sub num">
              {formatClock(view.windows[0].start)}–
              {formatClock(view.windows[view.windows.length - 1].end)} ·{" "}
              {formatDuration(view.availableMinutes)} {t("myDay.afterBreaks")}
            </p>
          )}
        </div>

        {/* Mistakes get noticed while working, not while reading the P1N list. */}
        <FileP1nButton
          tasks={p1nTasks}
          defaultTaskId={view.activeTaskId ?? undefined}
        />
      </div>

      {/* The bar works out whether the day is on track, which means reading
          the clock in the company's zone rather than the browser's. */}
      <DayViewClient view={view} zone={scheduleZone()} />
    </div>
  );
}
