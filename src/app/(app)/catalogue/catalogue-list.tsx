"use client";

import { useMemo, useState } from "react";
import { formatClock, formatDuration, weekdayName } from "@/lib/time";
import { CatalogueForm, type CatalogueEntry } from "./catalogue-form";
import type { CatalogueState } from "@/lib/catalogue/actions";

/** Plain-English summary of a schedule, for the list. */
export function describeRule(rule: CatalogueEntry["rule"]): string {
  if (!rule) return "on demand";

  const at =
    rule.fixedStartMinutes != null
      ? ` at ${formatClock(rule.fixedStartMinutes)}`
      : "";
  const times =
    rule.instancesPerOccurrence > 1 ? ` ×${rule.instancesPerOccurrence}` : "";

  if (rule.frequency === "MONTHLY") {
    if (rule.monthlyDay != null) {
      return `monthly on the ${rule.monthlyDay}${at}${times}`;
    }
    const nth =
      rule.monthlyNth === -1
        ? "last"
        : rule.monthlyNth === 1
          ? "first"
          : rule.monthlyNth === 2
            ? "second"
            : rule.monthlyNth === 3
              ? "third"
              : "fourth";
    const day = rule.weekdays[0] ? weekdayName(rule.weekdays[0]) : "day";
    return `monthly, ${nth} ${day}${at}${times}`;
  }

  if (rule.weekdays.length === 5 && !rule.weekdays.includes(6) && !rule.weekdays.includes(7)) {
    return `every weekday${at}${times}`;
  }
  const days = [...rule.weekdays]
    .sort()
    .map((d) => weekdayName(d).slice(0, 3))
    .join(" ");
  return `${days}${at}${times}`;
}

export function CatalogueList({
  departmentId,
  entries,
}: {
  departmentId: string;
  entries: CatalogueEntry[];
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<CatalogueState>({});
  const [showRetired, setShowRetired] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!showRetired && !e.active) return false;
      return !q || e.name.toLowerCase().includes(q);
    });
  }, [entries, query, showRetired]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a task…"
          className="field w-56"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
          />
          Show retired
        </label>
        <span className="num text-[12px] text-muted">{rows.length} tasks</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            setCreating((v) => !v);
            setEditing(null);
          }}
          className="btn btn-primary btn-sm"
        >
          {creating ? "Close" : "+ New task"}
        </button>
      </div>

      {(notice.error ?? notice.message) && (
        <p
          role="status"
          className={`notice mb-3 ${notice.error ? "notice-bad" : "notice-ok"}`}
        >
          {notice.error ?? notice.message}
        </p>
      )}

      {creating && (
        <div className="mb-3">
          <CatalogueForm
            departmentId={departmentId}
            onDone={(s) => {
              setNotice(s);
              if (s.ok) setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {rows.map((entry) => (
          <article
            key={entry.id}
            className={`rounded border bg-surface ${
              entry.active ? "border-line" : "border-line opacity-60"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-2 px-3.5 py-2.5">
              <span className="text-[13.5px] font-medium">{entry.name}</span>
              <span className="num text-xs text-muted">
                {formatDuration(entry.estimatedMinutes)}
              </span>
              {entry.priority === "MUST" && (
                <span
                  title="Always assigned, even when the day is full"
                  className="rounded border border-stall px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-stall uppercase"
                >
                  must
                </span>
              )}
              {entry.priority === "SPARE_TIME" && (
                <span
                  title="Only scheduled when somebody has hours to spare"
                  className="rounded border border-line-strong px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-faint uppercase"
                >
                  spare time
                </span>
              )}
              {entry.isMeeting && (
                <span className="rounded border border-accent px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-accent uppercase">
                  meeting
                </span>
              )}
              {entry.notes && (
                <span
                  title={entry.notes}
                  className="cursor-help rounded border border-pause px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-pause uppercase"
                >
                  note
                </span>
              )}
              {!entry.active && (
                <span className="rounded border border-stall px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-stall uppercase">
                  retired
                </span>
              )}
              <span className="flex-1" />
              <span
                className={`text-xs ${
                  entry.rule ? "text-accent" : "text-muted"
                }`}
              >
                {describeRule(entry.rule)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditing(editing === entry.id ? null : entry.id);
                  setCreating(false);
                }}
                className="btn btn-sm"
              >
                {editing === entry.id ? "Close" : "Edit"}
              </button>
            </div>

            {editing === entry.id && (
              <div className="border-t border-line p-3.5">
                <CatalogueForm
                  departmentId={departmentId}
                  entry={entry}
                  onDone={(s) => {
                    setNotice(s);
                    if (s.ok) setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </div>
            )}
          </article>
        ))}

        {rows.length === 0 && (
          <p className="empty">
            Nothing matches.
          </p>
        )}
      </div>
    </>
  );
}
