import type { TeamWeek, WeekBlock, WeekDay } from "@/lib/team/week";
import { formatClock, formatDuration } from "@/lib/time";

// Every cell is drawn on the same scale so a short day visibly reads as short
// next to a long one. The range covers a split shift finishing at 20:00.
const SCALE_START = 8 * 60;
const SCALE_END = 20 * 60;
const SPAN = SCALE_END - SCALE_START;

const pct = (minutes: number) => ((minutes - SCALE_START) / SPAN) * 100;
const heightPct = (minutes: number) => (minutes / SPAN) * 100;

const BLOCK_STYLE: Record<string, string> = {
  DONE: "bg-surface-2 border-l-done text-muted",
  IN_PROGRESS: "bg-run-wash border-l-run",
  PAUSED: "bg-pause-wash border-l-pause",
  ORPHANED: "bg-stall-wash border-l-stall",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The grid follows the dates it is given, which may include a weekend. */
function dayName(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return DAY_NAMES[(date.getUTCDay() + 6) % 7];
}

export function WeekGrid({ week }: { week: TeamWeek }) {
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
              {week.dates.map((date) => (
                <th
                  key={date}
                  className={`border border-line px-3 py-2 text-left text-[11px] font-semibold tracking-[0.07em] uppercase ${
                    date === today
                      ? "bg-accent-wash text-accent"
                      : "bg-surface-2 text-faint"
                  }`}
                >
                  {dayName(date)}
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

/**
 * A day at week scale. Task blocks are positioned by time but given a floor
 * height and pushed down when they would overlap -- otherwise a run of
 * five-minute tasks renders as an unreadable smear of one-pixel slivers.
 * Exact times live in the tooltip; the cell's job is "how full is this day".
 */
function layoutBlocks(blocks: WeekBlock[], cellHeight: number) {
  const MIN_PX = 5;
  const GAP_PX = 1;

  let lastBottom = -Infinity;
  return [...blocks]
    .sort((a, b) => a.start - b.start)
    .map((block) => {
      const idealTop = (pct(block.start) / 100) * cellHeight;
      const height = Math.max(
        (heightPct(block.end - block.start) / 100) * cellHeight,
        MIN_PX,
      );
      const top = Math.max(idealTop, lastBottom + GAP_PX);
      lastBottom = top + height;
      return { block, top, height };
    })
    .map(({ block, top, height }) => ({
      block,
      // Keep everything inside the cell even when a day is packed.
      top: Math.min(top, cellHeight - height),
      height,
    }));
}

function DayCell({ day }: { day: WeekDay }) {
  const CELL_H = 116;

  if (!day.rostered) {
    return (
      <div className="relative flex h-[116px] items-center justify-center bg-surface-2 text-[10.5px] text-faint">
        not working
      </div>
    );
  }

  const laid = layoutBlocks(day.blocks, CELL_H);

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
        laid.map(({ block, top, height }) => (
          <div
            key={block.id}
            title={`${block.title} · ${formatClock(block.start)}–${formatClock(block.end)} · ${formatDuration(block.estimatedMinutes)}`}
            className={`absolute right-1.5 left-1.5 overflow-hidden rounded-sm border-l-2 px-1 text-[9px] leading-none whitespace-nowrap ${
              BLOCK_STYLE[block.status] ?? "bg-accent-wash border-l-accent"
            }`}
            style={{ top, height }}
          >
            {height >= 9 ? block.title : ""}
          </div>
        ))}

      {!day.absent && day.blocks.length > 0 && (
        <span className="num absolute right-1 bottom-0.5 rounded bg-surface/85 px-1 text-[9px] text-muted">
          {day.blocks.length} · {formatDuration(day.bookedMinutes)}
        </span>
      )}

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
