"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

const DAYS = [
  { weekday: 1, label: "Monday", short: "Mon" },
  { weekday: 2, label: "Tuesday", short: "Tue" },
  { weekday: 3, label: "Wednesday", short: "Wed" },
  { weekday: 4, label: "Thursday", short: "Thu" },
  { weekday: 5, label: "Friday", short: "Fri" },
  { weekday: 6, label: "Saturday", short: "Sat" },
  { weekday: 7, label: "Sunday", short: "Sun" },
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
 *
 * Four native time inputs will not fit side by side in a narrow column, so
 * the row stacks into label-above-field pairs until there is room for the
 * table layout.
 */
export function WeekdayFields({ existing = [] }: { existing?: Existing[] }) {
  const { t } = useT();
  const byWeekday = new Map(existing.map((e) => [e.weekday, e]));

  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(
      DAYS.map((d) => [
        d.weekday,
        byWeekday.has(d.weekday) || (existing.length === 0 && d.weekday <= 5),
      ]),
    ),
  );

  const cell = "field num min-w-0 px-1.5 py-1 text-[12.5px]";

  return (
    <div className="flex flex-col gap-1.5">
      {/* Column headings only make sense once the rows line up. */}
      <div className="hidden gap-2 sm:grid sm:grid-cols-[92px_repeat(4,minmax(0,1fr))]">
        <span className="eyebrow">{t("common.day")}</span>
        <span className="eyebrow">{t("people.start")}</span>
        <span className="eyebrow">{t("people.finish")}</span>
        <span className="eyebrow">{t("people.breakLabel")}</span>
        <span className="eyebrow">{t("people.breakAt")}</span>
      </div>

      {DAYS.map((day) => {
        const row = byWeekday.get(day.weekday);
        const [start, end] = row ? row.hours.split("–") : ["09:00", "17:00"];
        const on = checked[day.weekday];

        return (
          <div
            key={day.weekday}
            className={`grid grid-cols-2 items-center gap-2 rounded-md sm:grid-cols-[92px_repeat(4,minmax(0,1fr))] ${
              on ? "" : "opacity-55"
            }`}
          >
            <label className="col-span-2 flex items-center gap-2 text-[13px] sm:col-span-1">
              <input
                type="checkbox"
                name={`works-${day.weekday}`}
                checked={on}
                onChange={(e) =>
                  setChecked((c) => ({ ...c, [day.weekday]: e.target.checked }))
                }
              />
              <span className="sm:hidden">{day.label}</span>
              <span className="hidden sm:inline">{day.short}</span>
            </label>

            <label className="min-w-0">
              <span className="eyebrow mb-0.5 block sm:hidden">{t("people.start")}</span>
              <input
                type="time"
                name={`start-${day.weekday}`}
                defaultValue={start}
                disabled={!on}
                className={cell}
              />
            </label>
            <label className="min-w-0">
              <span className="eyebrow mb-0.5 block sm:hidden">{t("people.finish")}</span>
              <input
                type="time"
                name={`end-${day.weekday}`}
                defaultValue={end}
                disabled={!on}
                className={cell}
              />
            </label>
            <label className="min-w-0">
              <span className="eyebrow mb-0.5 block sm:hidden">{t("people.breakLabel")}</span>
              <input
                type="number"
                name={`break-${day.weekday}`}
                defaultValue={row?.breakMinutes ?? 60}
                min={0}
                max={240}
                step={5}
                disabled={!on}
                className={cell}
              />
            </label>
            <label className="min-w-0">
              <span className="eyebrow mb-0.5 block sm:hidden">{t("people.breakAt")}</span>
              <input
                type="time"
                name={`breakstart-${day.weekday}`}
                defaultValue={row?.breakStart ?? "13:00"}
                disabled={!on}
                className={cell}
              />
            </label>
          </div>
        );
      })}

      <p className="mt-1 text-[12px] text-muted">
        {t("people.breakHint")}
      </p>
    </div>
  );
}
