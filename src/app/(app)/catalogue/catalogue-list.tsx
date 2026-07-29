"use client";

import { useMemo, useState } from "react";
import { formatClock, formatDuration } from "@/lib/time";
import { CatalogueForm, type CatalogueEntry } from "./catalogue-form";
import type { CatalogueState } from "@/lib/catalogue/actions";
import { useT } from "@/lib/i18n/client";
import { weekdayLabel } from "@/lib/i18n/dates";
import type { Locale } from "@/lib/i18n/dictionary";

type Translate = (key: string, ...args: (string | number)[]) => string;

/**
 * One-line summary of a schedule, for the list.
 *
 * Takes `t` and the locale rather than four pre-translated fragments, which is
 * how it used to work and left half the sentence -- the "at", the ordinals,
 * the weekday names -- stubbornly in English.
 */
export function describeRule(
  rule: CatalogueEntry["rule"],
  t: Translate,
  locale: Locale,
): string {
  if (!rule) return t("catalogue.ruleOnDemand");

  const at =
    rule.fixedStartMinutes != null
      ? ` ${t("catalogue.ruleAt", formatClock(rule.fixedStartMinutes))}`
      : "";
  const times =
    rule.instancesPerOccurrence > 1 ? ` ×${rule.instancesPerOccurrence}` : "";

  if (rule.frequency === "MONTHLY") {
    if (rule.monthlyDay != null) {
      return `${t("catalogue.ruleMonthlyDay", rule.monthlyDay)}${at}${times}`;
    }
    const nth = t(
      rule.monthlyNth === -1 ? "catalogue.nthLast" : `catalogue.nth${rule.monthlyNth ?? 1}`,
    );
    const day = rule.weekdays[0]
      ? weekdayLabel(locale, rule.weekdays[0])
      : t("common.day").toLowerCase();
    return `${t("catalogue.ruleMonthlyNth", nth, day)}${at}${times}`;
  }

  if (
    rule.weekdays.length === 5 &&
    !rule.weekdays.includes(6) &&
    !rule.weekdays.includes(7)
  ) {
    return `${t("catalogue.ruleEveryWeekday")}${at}${times}`;
  }
  const days = [...rule.weekdays]
    .sort()
    .map((d) => weekdayLabel(locale, d, "short"))
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
  const { t, locale } = useT();
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
                {describeRule(entry.rule, t, locale)}
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
