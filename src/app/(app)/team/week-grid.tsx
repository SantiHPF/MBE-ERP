import type { TeamWeek, WeekDay } from "@/lib/team/week";
import { formatClock, formatDuration } from "@/lib/time";

// Every cell is drawn on the same 07:00-19:00 scale so a short day visibly
// reads as short next to a long one.
const SCALE_START = 7 * 60;
const SCALE_END = 19 * 60;
const SPAN = SCALE_END - SCALE_START;

const pct = (minutes: number) => ((minutes - SCALE_START) / SPAN) * 100;
const heightPct = (minutes: number) => (minutes / SPAN) * 100;

const BLOCK_STYLE: Record<string, string> = {
  DONE: "bg-surface-2 border-l-done text-muted",
  IN_PROGRESS: "bg-run-wash border-l-run",
  PAUSED: "bg-pause-wash border-l-pause",
  ORPHANED: "bg-stall-wash border-l-stall",
};

export function WeekGrid({ week }: { week: TeamWeek }) {
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="overflow-x-auto rounded border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              <th className="w-[190px] border border-line bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
                Person
              </th>
              {week.dates.map((date, i) => (
                <th
                  key={date}
                  className={`border border-line px-3 py-2 text-left text-[11px] font-semibold tracking-[0.07em] uppercase ${
                    date === today
                      ? "bg-accent-wash text-accent"
                      : "bg-surface-2 text-faint"
                  }`}
                >
                  {dayNames[i]}
                  {date === today && " · today"}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {week.people.map((person) => (
              <tr key={person.id}>
                <th className="border border-line bg-surface px-3 py-2 text-left align-top">
                  <span className="text-[13.5px] font-medium">
                    {person.displayName}
                  </span>
                  <span className="num mt-0.5 block text-[11px] font-normal text-muted">
                    {formatDuration(person.bookedMinutes)} of{" "}
                    {formatDuration(person.weeklyMinutes)}
                  </span>
                </th>

                {person.days.map((day) => (
                  <td key={day.date} className="border border-line p-0 align-top">
                    <DayCell day={day} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-4 text-xs text-muted">
        <Key className="border-l-2 border-l-accent bg-accent-wash">Scheduled</Key>
        <Key className="border-l-2 border-l-run bg-run-wash">Running</Key>
        <Key className="border-l-2 border-l-pause bg-pause-wash">Paused</Key>
        <Key className="border-l-2 border-l-stall bg-stall-wash">
          Needs a decision
        </Key>
        <Key className="border border-line bg-canvas">Working hours</Key>
      </div>
    </>
  );
}

function DayCell({ day }: { day: WeekDay }) {
  if (!day.rostered) {
    return (
      <div className="relative flex h-[116px] items-center justify-center bg-surface-2 text-[10.5px] text-faint">
        not working
      </div>
    );
  }

  return (
    <div className="relative h-[116px] bg-surface">
      {/* Working hours as the backdrop, so an empty day still shows capacity. */}
      {day.windows.map((w) => (
        <div
          key={w.start}
          className="absolute right-1 left-1 rounded-sm border border-line bg-canvas"
          style={{ top: `${pct(w.start)}%`, height: `${heightPct(w.end - w.start)}%` }}
        />
      ))}

      {day.absent && (
        <div className="absolute inset-1 flex items-center justify-center rounded-sm border border-dashed border-line-strong bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,var(--color-line)_4px,var(--color-line)_5px)]">
          <span className="rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted uppercase">
            {day.absenceCategory?.toLowerCase() ?? "away"}
          </span>
        </div>
      )}

      {!day.absent &&
        day.blocks.map((block) => (
          <div
            key={block.id}
            title={`${block.title} · ${formatClock(block.start)}–${formatClock(block.end)}`}
            className={`absolute right-1.5 left-1.5 overflow-hidden rounded-sm border-l-2 px-1 text-[9.5px] leading-tight whitespace-nowrap ${
              BLOCK_STYLE[block.status] ?? "bg-accent-wash border-l-accent"
            }`}
            style={{
              top: `${pct(block.start)}%`,
              height: `${heightPct(block.end - block.start)}%`,
            }}
          >
            {block.title}
          </div>
        ))}

      {day.rostered && !day.absent && day.blocks.length === 0 && (
        <span className="absolute inset-x-0 bottom-1 text-center text-[9.5px] text-faint">
          nothing booked
        </span>
      )}
    </div>
  );
}

function Key({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-sm ${className}`} />
      {children}
    </span>
  );
}
