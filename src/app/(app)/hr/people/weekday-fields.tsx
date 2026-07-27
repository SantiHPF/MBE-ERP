"use client";

import { useState } from "react";

const DAYS = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 7, label: "Sunday" },
];

type Existing = {
  weekday: number;
  hours: string;
  breakMinutes: number;
  breakStart: string | null;
};

/**
 * One row per weekday. Unchecking a day is how "does not work Tuesdays" is
 * recorded -- there is no separate concept of a day off, just the absence of
 * a pattern.
 */
export function WeekdayFields({ existing = [] }: { existing?: Existing[] }) {
  const byWeekday = new Map(existing.map((e) => [e.weekday, e]));

  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(
      DAYS.map((d) => [
        d.weekday,
        byWeekday.has(d.weekday) || (existing.length === 0 && d.weekday <= 5),
      ]),
    ),
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[104px_1fr_1fr_64px_1fr] gap-2 text-[10px] font-semibold tracking-[0.07em] text-faint uppercase">
        <span>Day</span>
        <span>Start</span>
        <span>Finish</span>
        <span>Break</span>
        <span>Break at</span>
      </div>

      {DAYS.map((day) => {
        const row = byWeekday.get(day.weekday);
        const [start, end] = row ? row.hours.split("–") : ["09:00", "17:00"];
        const on = checked[day.weekday];

        return (
          <div
            key={day.weekday}
            className="grid grid-cols-[104px_1fr_1fr_64px_1fr] items-center gap-2"
          >
            <label className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                name={`works-${day.weekday}`}
                checked={on}
                onChange={(e) =>
                  setChecked((c) => ({ ...c, [day.weekday]: e.target.checked }))
                }
              />
              {day.label.slice(0, 3)}
            </label>

            <input
              type="time"
              name={`start-${day.weekday}`}
              defaultValue={start}
              disabled={!on}
              className="num rounded border border-line-strong bg-surface-2 px-1.5 py-1 text-[12.5px] disabled:opacity-40"
            />
            <input
              type="time"
              name={`end-${day.weekday}`}
              defaultValue={end}
              disabled={!on}
              className="num rounded border border-line-strong bg-surface-2 px-1.5 py-1 text-[12.5px] disabled:opacity-40"
            />
            <input
              type="number"
              name={`break-${day.weekday}`}
              defaultValue={row?.breakMinutes ?? 60}
              min={0}
              max={240}
              step={5}
              disabled={!on}
              className="num rounded border border-line-strong bg-surface-2 px-1.5 py-1 text-[12.5px] disabled:opacity-40"
            />
            <input
              type="time"
              name={`breakstart-${day.weekday}`}
              defaultValue={row?.breakStart ?? "13:00"}
              disabled={!on}
              className="num rounded border border-line-strong bg-surface-2 px-1.5 py-1 text-[12.5px] disabled:opacity-40"
            />
          </div>
        );
      })}

      <p className="mt-1 text-[11px] text-muted">
        Leave &ldquo;break at&rdquo; set and work is scheduled around it, splitting
        the day. Clear it and the break still costs time but work can go
        anywhere.
      </p>
    </div>
  );
}
