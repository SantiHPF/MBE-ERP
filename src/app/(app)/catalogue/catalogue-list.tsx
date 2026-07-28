"use client";

import { useMemo, useState } from "react";
import { formatClock, formatDuration, weekdayName } from "@/lib/time";
import { CatalogueForm, type CatalogueEntry } from "./catalogue-form";
import type { CatalogueState } from "@/lib/catalogue/actions";
import { useT } from "@/lib/i18n/client";

/** Plain-English summary of a schedule, for the list. */
export function describeRule(
  rule: CatalogueEntry["rule"],
  everyWeekday = "every weekday",
  onDemand = "on demand",
  monthlyOnThe = "monthly on the",
  monthlyNth = "monthly,",
): string {
  if (!rule) return onDemand;

  const at =
    rule.fixedStartMinutes != null
      ? ` at ${formatClock(rule.fixedStartMinutes)}`
      : "";
  const times =
    rule.instancesPerOccurrence > 1 ? ` ×${rule.instancesPerOccurrence}` : "";

  if (rule.frequency === "MONTHLY") {
    if (rule.monthlyDay != null) {
      return `${monthlyOnThe} ${rule.monthlyDay}${at}${times}`;
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
    return `${monthlyNth} ${nth} ${day}${at}${times}`;
  }

  if (
    rule.weekdays.length === 5 &&
    !rule.weekdays.includes(6) &&
    !rule.weekdays.includes(7)
  ) {
    return `${everyWeekday}${at}${times}`;
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
  canEdit,
}: {
  departmentId: string;
  entries: CatalogueEntry[];
  canEdit: boolean;
}) {
  const { t } = useT();
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
          placeholder={t("plan.findTask")}
          className="field w-56"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
          />
          {t("catalogue.showRetired")}
        </label>
        <span className="num text-[12px] text-muted">{t("catalogue.tasksCount", rows.length)}</span>
        <span className="flex-1" />
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setCreating((v) => !v);
              setEditing(null);
            }}
            className="btn btn-primary btn-sm"
          >
            {creating ? t("common.close") : t("plan.newTask")}
          </button>
        )}
      </div>

      {(notice.error ?? notice.message) && (
        <p
          role="status"
          className={`notice mb-3 ${notice.error ? "notice-bad" : "notice-ok"}`}
        >
          {notice.error ?? notice.message}
        </p>
      )}

      {creating && canEdit && (
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
                  title={t("catalogue.mustTip")}
                  className="rounded border border-stall px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-stall uppercase"
                >
                  {t("catalogue.must")}
                </span>
              )}
              {entry.priority === "SPARE_TIME" && (
                <span
                  title={t("catalogue.spareTip")}
                  className="rounded border border-line-strong px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-faint uppercase"
                >
                  {t("catalogue.spare")}
                </span>
              )}
              {entry.repeatable && (
                <span
                  title={t("catalogue.perGoTip")}
                  className="badge cursor-help"
                >
                  {t("catalogue.perGo")}
                </span>
              )}
              {entry.isMeeting && (
                <span className="rounded border border-accent px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-accent uppercase">
                  {t("catalogue.meeting")}
                </span>
              )}
              {entry.notes && (
                <span
                  title={entry.notes}
                  className="cursor-help rounded border border-pause px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-pause uppercase"
                >
                  {t("catalogue.note")}
                </span>
              )}
              {!entry.active && (
                <span className="rounded border border-stall px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-stall uppercase">
                  {t("catalogue.retired")}
                </span>
              )}
              <span className="flex-1" />
              <span
                className={`text-xs ${
                  entry.rule ? "text-accent" : "text-muted"
                }`}
              >
                {describeRule(
                  entry.rule,
                  t("catalogue.everyWeekday").toLowerCase(),
                  t("catalogue.onDemand").toLowerCase(),
                  t("catalogue.monthly").toLowerCase() + " " + t("catalogue.dayOf").toLowerCase(),
                  t("catalogue.monthly").toLowerCase() + ",",
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(editing === entry.id ? null : entry.id);
                    setCreating(false);
                  }}
                  className="btn btn-sm"
                >
                  {editing === entry.id ? t("common.close") : t("common.edit")}
                </button>
              )}
            </div>

            {editing === entry.id && canEdit && (
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
            {t("common.nothingMatches")}
          </p>
        )}
      </div>
    </>
  );
}
