import type { TeamWeek, WeekBlock, WeekDay } from "@/lib/team/week";
import { formatClock, formatDuration, todayKey } from "@/lib/time";
import { getT } from "@/lib/i18n/server";
import { weekdayLabel, weekdayOfKey } from "@/lib/i18n/dates";

const BLOCK_STYLE: Record<string, string> = {
  DONE: "bg-surface-2 border-l-done text-muted",
  IN_PROGRESS: "bg-run-wash border-l-run",
  PAUSED: "bg-pause-wash border-l-pause",
  ORPHANED: "bg-stall-wash border-l-stall",
};

/**
 * The vertical scale of the grid.
 *
 * It used to be pinned at 08:00-20:00 for everyone. A department working
 * 09:00-17:00 therefore spent a third of every cell on hours nobody works,
 * squeezing the part that matters, and an early shift starting at 07:00 was
 * quietly clipped off the top. So the scale comes from the week itself,
 * rounded out to whole hours because the axis labels are hours.
 */
type Scale = { start: number; end: number };

const FALLBACK: Scale = { start: 8 * 60, end: 20 * 60 };

function scaleFor(week: TeamWeek): Scale {
  let min = Infinity;
  let max = -Infinity;

  for (const person of week.people) {
    for (const day of person.days) {
      for (const w of day.windows) {
        min = Math.min(min, w.start);
        max = Math.max(max, w.end);
      }
      // Work scheduled outside someone's hours still has to be visible --
      // that is exactly the case a manager needs to see.
      for (const b of day.blocks) {
        min = Math.min(min, b.start);
        max = Math.max(max, b.end);
      }
    }
  }

  if (min === Infinity || max <= min) return FALLBACK;

  const start = Math.floor(min / 60) * 60;
  const end = Math.ceil(max / 60) * 60;
  // Two hours of range is not enough to position anything against; give a
  // very short week enough room that the axis still means something.
  return end - start >= 180 ? { start, end } : { start, end: start + 180 };
}

/**
 * How much the cell can say, from how tall it is.
 *
 * This used to be one boolean flipping at 240px: below it, five-pixel slivers
 * with no text; above it, readable blocks. The team grid sat at 116px, on the
 * wrong side of that cliff, which is what made it unreadable. Three steps
 * means the middle case -- a whole department on one screen -- gets to be
 * legible instead of merely present.
 */
type Density = "dense" | "normal" | "roomy";

const DENSITY = {
  dense: { minPx: 5, gapPx: 1, text: "px-1 text-[9px] leading-none whitespace-nowrap" },
  // A block this short fits one line. Allowed to wrap it would show the first
  // line and slice the second in half, which reads worse than an ellipsis on
  // a narrow screen -- the full title is in the tooltip either way.
  normal: {
    minPx: 15,
    gapPx: 2,
    text: "px-1.5 py-0.5 text-[10.5px] leading-tight text-ellipsis whitespace-nowrap",
  },
  roomy: { minPx: 22, gapPx: 2, text: "px-2 py-1 text-[11px] leading-tight" },
} as const;

/**
 * Height has to be enough for the busiest day, not for the average one.
 *
 * Blocks that will not fit get pushed down and then clamped to the bottom of
 * the cell, which means they land on top of each other -- twelve tasks in a
 * 176px cell was a stack of unreadable overlaps. So the row grows to fit the
 * fullest day in the week, up to a ceiling past which a department view stops
 * being one screen and the honest answer is slivers.
 */
function busiestDay(week: TeamWeek): number {
  let most = 0;
  for (const person of week.people) {
    for (const day of person.days) most = Math.max(most, day.blocks.length);
  }
  return most;
}

const COMPACT_MIN = 176;
const COMPACT_MAX = 340;

/**
 * A reserved strip at the foot of every cell for the day's totals.
 *
 * They used to be absolutely positioned over the blocks with a translucent
 * background, which is fine until a day is full -- then the count sits on top
 * of the last task's name. Giving it its own band costs a few pixels and
 * makes the collision impossible.
 */
const FOOTER_PX = 14;

function compactHeight(busiest: number): number {
  const { minPx, gapPx } = DENSITY.normal;
  const wanted = busiest * (minPx + gapPx) + FOOTER_PX + 8;
  return Math.min(COMPACT_MAX, Math.max(COMPACT_MIN, wanted));
}

/** Legible if the busiest day actually fits at that size; slivers if not. */
function densityFor(height: number, busiest: number): Density {
  const usable = height - FOOTER_PX;
  const fits = (d: Density) =>
    busiest * (DENSITY[d].minPx + DENSITY[d].gapPx) <= usable;
  if (usable >= 260 && fits("roomy")) return "roomy";
  return fits("normal") ? "normal" : "dense";
}

/** Whole hours across the scale, for the axis and the gridlines. */
function hourMarks(scale: Scale): number[] {
  const marks: number[] = [];
  for (let m = scale.start; m <= scale.end; m += 60) marks.push(m);
  return marks;
}

export async function WeekGrid({
  week,
  size = "compact",
}: {
  week: TeamWeek;
  /**
   * "tall" is for one person's own week, where the page has room and the
   * point is reading what the day holds. "compact" packs a whole department
   * onto one screen, where the point is comparing days at a glance.
   */
  size?: "compact" | "tall";
}) {
  const { t, locale } = await getT();
  const today = todayKey();
  const busiest = busiestDay(week);
  // At least 176px rather than the old flat 116, and more when the week has a
  // day full enough to need it. With the page no longer capped at 1180px
  // there is width to match the extra height.
  const cellHeight = size === "tall" ? 420 : compactHeight(busiest);
  const density = densityFor(cellHeight, busiest);
  const scale = scaleFor(week);
  const marks = hourMarks(scale);

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[680px] table-fixed border-collapse">
          <thead>
            <tr>
              <th className="w-[150px] border border-line bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
                {t("common.person")}
              </th>
              {/* The axis column. Narrow, and it is the reason a block's
                  vertical position now means something you can read off. */}
              <th className="w-[46px] border border-line bg-surface-2" />
              {week.dates.map((date) => (
                <th
                  key={date}
                  className={`border border-line px-3 py-2 text-left text-[11px] font-semibold tracking-[0.07em] uppercase ${
                    date === today
                      ? "bg-accent-wash text-accent"
                      : "bg-surface-2 text-faint"
                  }`}
                >
                  {weekdayLabel(locale, weekdayOfKey(date), "short")}
                  {date === today && ` · ${t("common.today")}`}
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
                    {formatDuration(person.bookedMinutes)} {t("common.of")}{" "}
                    {formatDuration(person.weeklyMinutes)}
                  </span>
                </th>

                <td className="border border-line p-0 align-top">
                  <TimeAxis marks={marks} scale={scale} height={cellHeight} />
                </td>

                {person.days.map((day) => (
                  <td key={day.date} className="border border-line p-0 align-top">
                    <DayCell
                      day={day}
                      height={cellHeight}
                      scale={scale}
                      marks={marks}
                      density={density}
                      t={t}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-4 text-xs text-muted">
        <Key className="border-l-2 border-l-accent bg-accent-wash">{t("team.scheduled")}</Key>
        <Key className="border-l-2 border-l-run bg-run-wash">{t("team.running")}</Key>
        <Key className="border-l-2 border-l-pause bg-pause-wash">{t("team.paused")}</Key>
        <Key className="border-l-2 border-l-stall bg-stall-wash">
          {t("team.needsDecision")}
        </Key>
        <Key className="border border-line bg-canvas">{t("team.workingHours")}</Key>
      </div>
    </>
  );
}

/** Hour labels, aligned to the same scale every cell in the row is drawn on. */
function TimeAxis({
  marks,
  scale,
  height,
}: {
  marks: number[];
  scale: Scale;
  height: number;
}) {
  const span = scale.end - scale.start;
  // Enough room for one label per hour, or every other one when it is tight.
  const step = height / (span / 60) >= 26 ? 1 : 2;

  return (
    <div className="relative overflow-hidden bg-surface-2" style={{ height }}>
      {marks.map((minutes, i) => {
        if (i % step !== 0) return null;
        const at = (minutes - scale.start) / span;
        return (
          <span
            key={minutes}
            className="num absolute right-1.5 text-[9.5px] text-faint"
            style={{
              top: `${at * 100}%`,
              // Centred on its line, except at the ends, where half the label
              // would sit outside the cell and be clipped away.
              transform:
                at === 0
                  ? "none"
                  : at === 1
                    ? "translateY(-100%)"
                    : "translateY(-50%)",
            }}
          >
            {formatClock(minutes)}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A day at week scale. Task blocks are positioned by time but given a floor
 * height and pushed down when they would overlap -- otherwise a run of
 * five-minute tasks renders as an unreadable smear of one-pixel slivers.
 */
function layoutBlocks(
  blocks: WeekBlock[],
  cellHeight: number,
  scale: Scale,
  density: Density,
) {
  const { minPx, gapPx } = DENSITY[density];
  const span = scale.end - scale.start;
  const toPx = (minutes: number) => ((minutes - scale.start) / span) * cellHeight;

  let lastBottom = -Infinity;
  return [...blocks]
    .sort((a, b) => a.start - b.start)
    .map((block) => {
      const idealTop = toPx(block.start);
      const height = Math.max(
        ((block.end - block.start) / span) * cellHeight,
        minPx,
      );
      const top = Math.max(idealTop, lastBottom + gapPx);
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

function DayCell({
  day,
  height,
  scale,
  marks,
  density,
  t,
}: {
  day: WeekDay;
  height: number;
  scale: Scale;
  marks: number[];
  density: Density;
  t: (key: string, ...args: (string | number)[]) => string;
}) {
  const span = scale.end - scale.start;
  const pct = (minutes: number) => ((minutes - scale.start) / span) * 100;

  if (!day.rostered) {
    return (
      <div
        className="relative flex items-center justify-center bg-surface-2 text-[10.5px] text-faint"
        style={{ height }}
      >
        {t("common.notWorking")}
      </div>
    );
  }

  // The blocks get the cell minus the totals strip at the foot of it.
  const area = height - FOOTER_PX;
  const laid = layoutBlocks(day.blocks, area, scale, density);

  // overflow-hidden is a backstop: when a day holds more than the cell can
  // show, the layout clamps blocks to the bottom edge rather than letting
  // them run into the row underneath.
  return (
    <div className="relative overflow-hidden bg-surface" style={{ height }}>
      <div className="absolute inset-x-0 top-0" style={{ height: area }}>
      {/* Hour rules, matching the axis. Without them the working-hours
          backdrop is the only reference and half past nine looks like ten. */}
      {marks.slice(1, -1).map((minutes) => (
        <div
          key={minutes}
          className="absolute inset-x-0 border-t border-line/55"
          style={{ top: `${pct(minutes)}%` }}
        />
      ))}

      {/* Working hours as the backdrop, so an empty day still shows capacity. */}
      {day.windows.map((w) => (
        <div
          key={w.start}
          className="absolute right-1 left-1 rounded-sm border border-line bg-canvas"
          style={{ top: `${pct(w.start)}%`, height: `${((w.end - w.start) / span) * 100}%` }}
        />
      ))}

      {day.absent && (
        <div className="absolute inset-1 flex items-center justify-center rounded-sm border border-dashed border-line-strong bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,var(--color-line)_4px,var(--color-line)_5px)]">
          <span className="rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted uppercase">
            {day.absenceCategory
              ? t(`calendar.categories.${day.absenceCategory}`)
              : t("common.away")}
          </span>
        </div>
      )}

      {!day.absent &&
        laid.map(({ block, top, height }) => (
          <div
            key={block.id}
            title={`${block.title} · ${formatClock(block.start)}–${formatClock(block.end)} · ${formatDuration(block.estimatedMinutes)}`}
            className={`absolute right-1.5 left-1.5 overflow-hidden rounded-sm border-l-2 ${
              DENSITY[density].text
            } ${BLOCK_STYLE[block.status] ?? "bg-accent-wash border-l-accent"}`}
            style={{ top, height }}
          >
            {density === "dense" ? (
              height >= 9 ? (
                block.title
              ) : (
                ""
              )
            ) : (
              <>
                <span className="num mr-1.5 text-[10px] opacity-70">
                  {formatClock(block.start)}
                </span>
                {block.title}
              </>
            )}
          </div>
        ))}

      </div>

      {/* The totals band. Its own strip, so a full day cannot bury it. */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center justify-end border-t border-line/70 bg-surface-2 px-1"
        style={{ height: FOOTER_PX }}
      >
        {day.absent ? null : day.blocks.length > 0 ? (
          <span className="num text-[9px] text-muted">
            {day.blocks.length} · {formatDuration(day.bookedMinutes)}
          </span>
        ) : (
          <span className="w-full text-center text-[9px] text-faint">
            {t("team.nothingBooked")}
          </span>
        )}
      </div>
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
