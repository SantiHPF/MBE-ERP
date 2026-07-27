import { requireUser } from "@/lib/auth/guards";
import { getDayView } from "@/lib/tasks/day";
import { formatClock, formatDuration } from "@/lib/time";
import { DayViewClient } from "./day-view";

export const dynamic = "force-dynamic";

export default async function MyDayPage() {
  const user = await requireUser();
  const view = await getDayView(user.id);

  const date = new Date(`${view.date}T00:00:00Z`);
  const heading = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          {heading}
        </h1>
        {view.rostered && view.availableMinutes > 0 && (
          <p className="num mt-0.5 text-[13px] text-muted">
            {formatClock(view.windows[0].start)}–
            {formatClock(view.windows[view.windows.length - 1].end)} ·{" "}
            {formatDuration(view.availableMinutes)} after breaks
          </p>
        )}
      </div>

      <DayViewClient view={view} />
    </div>
  );
}
