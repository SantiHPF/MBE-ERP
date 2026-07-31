"use client";

import { useActionState, useMemo, useState } from "react";
import { formatClock } from "@/lib/time";
import {
  saveCatalogueEntry,
  setCatalogueActive,
  type CatalogueState,
} from "@/lib/catalogue/actions";
import { useT } from "@/lib/i18n/client";

const initial: CatalogueState = {};

export type CatalogueEntry = {
  id: string;
  name: string;
  category: string | null;
  estimatedMinutes: number;
  /** How long one sitting should be, for a job too long to do in one. */
  sessionMinutes: number | null;
  notes: string | null;
  instructions: string | null;
  isMeeting: boolean;
  repeatable: boolean;
  priority: "MUST" | "NORMAL" | "SPARE_TIME";
  /** Keep it in one half of the day. Null means anywhere. */
  shiftHalf: "MORNING" | "AFTERNOON" | null;
  /** The entry this one comes straight after, when two jobs go hand in hand. */
  followsId: string | null;
  active: boolean;
  rule: {
    frequency: "WEEKLY" | "MONTHLY";
    weekdays: number[];
    monthlyNth: number | null;
    monthlyDay: number | null;
    instancesPerOccurrence: number;
    fixedStartMinutes: number | null;
    anchors: DayAnchor[];
  } | null;
};

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

type Freq = "NONE" | "WEEKLY" | "MONTHLY";

export type DayAnchor =
  | "ARRIVAL"
  | "BEFORE_BREAK"
  | "AFTER_BREAK"
  | "BEFORE_LEAVING";

/** In the order they happen, which is the order they are stored and shown. */
const ANCHORS = [
  ["ARRIVAL", "catalogue.onArrival"],
  ["BEFORE_BREAK", "catalogue.beforeBreak"],
  ["AFTER_BREAK", "catalogue.afterBreak"],
  ["BEFORE_LEAVING", "catalogue.beforeLeaving"],
] as const satisfies readonly (readonly [DayAnchor, string])[];

/** Where in the day the work sits: nowhere in particular, a clock time, or
 *  points in whoever's shift it is. */
type WhenInDay = "ANYWHERE" | "FIXED" | "ANCHORS";

export function CatalogueForm({
  departmentId,
  siblings,
  entry,
  onDone,
  onCancel,
}: {
  departmentId: string;
  /** The rest of this department's catalogue, for the "comes after" picker. */
  siblings: CatalogueEntry[];
  entry?: CatalogueEntry;
  onDone: (s: CatalogueState) => void;
  onCancel: () => void;
}) {
  const { t } = useT();

  /**
   * What this entry could sensibly come after.
   *
   * Itself is excluded, and so is anything already downstream of it -- picking
   * one of those would close a loop, and offering a choice the server is bound
   * to reject is worse than not offering it. The server checks again anyway:
   * this list was built when the form opened.
   */
  const leaderOptions = useMemo(() => {
    const downstream = new Set<string>();
    if (entry) {
      downstream.add(entry.id);
      for (let depth = 0; depth < 6; depth++) {
        for (const s of siblings) {
          if (s.followsId && downstream.has(s.followsId)) downstream.add(s.id);
        }
      }
    }
    return siblings
      .filter((s) => s.active && !downstream.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [siblings, entry]);
  const [state, submit, pending] = useActionState(
    async (p: CatalogueState, f: FormData) => {
      const r = await saveCatalogueEntry(p, f);
      onDone(r);
      return r;
    },
    initial,
  );
  const [, retire] = useActionState(
    async (p: CatalogueState, f: FormData) => {
      const r = await setCatalogueActive(p, f);
      onDone(r);
      return r;
    },
    initial,
  );

  // "Daily" is weekly on all five weekdays -- one concept fewer to model.
  const initialFreq: Freq = entry?.rule?.frequency ?? "NONE";
  const [freq, setFreq] = useState<Freq>(initialFreq);
  const [monthlyMode, setMonthlyMode] = useState<"NTH_WEEKDAY" | "DAY_OF_MONTH">(
    entry?.rule?.monthlyDay != null ? "DAY_OF_MONTH" : "NTH_WEEKDAY",
  );
  const [days, setDays] = useState<number[]>(
    entry?.rule?.frequency === "WEEKLY" ? entry.rule.weekdays : [],
  );
  const [priority, setPriority] = useState<"MUST" | "NORMAL" | "SPARE_TIME">(
    entry?.priority ?? "NORMAL",
  );
  const [half, setHalf] = useState<"" | "MORNING" | "AFTERNOON">(
    entry?.shiftHalf ?? "",
  );

  // Three ways a task can sit in the day, and only one applies at a time.
  const [when, setWhen] = useState<WhenInDay>(
    (entry?.rule?.anchors?.length ?? 0) > 0
      ? "ANCHORS"
      : entry?.rule?.fixedStartMinutes != null
        ? "FIXED"
        : "ANYWHERE",
  );
  const [anchors, setAnchors] = useState<DayAnchor[]>(
    entry?.rule?.anchors ?? [],
  );

  /** Kept in the fixed order of the day, whatever order they were ticked in. */
  const toggleAnchor = (anchor: DayAnchor) =>
    setAnchors((current) =>
      current.includes(anchor)
        ? current.filter((a) => a !== anchor)
        : ANCHORS.map(([id]) => id).filter(
            (id) => id === anchor || current.includes(id),
          ),
    );

  const label = "mb-1 block text-[11px] font-semibold tracking-[0.07em] text-faint uppercase";
  const field = "w-full rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13px]";

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="departmentId" value={departmentId} />
      {entry && <input type="hidden" name="templateId" value={entry.id} />}

      {/* ------------------------------------------------- what the task is */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_100px_minmax(0,1fr)]">
        <label className="text-[11px]">
          <span className={label}>{t("catalogue.taskName")}</span>
          <input
            name="name"
            defaultValue={entry?.name}
            required
            autoFocus={!entry}
            className={field}
          />
        </label>
        <label className="text-[11px]">
          <span className={label}>{t("common.minutes")}</span>
          <input
            type="number"
            name="estimatedMinutes"
            defaultValue={entry?.estimatedMinutes ?? 30}
            min={1}
            max={1440}
            step={1}
            required
            className={`num ${field}`}
          />
        </label>
        {/* Only worth asking about once the job is long enough to be cut up;
            below that it is a field with no effect. */}
        <label className="text-[11px]">
          <span className={label} title={t("sessions.sessionMinutesHint")}>
            {t("sessions.sessionMinutes")}
          </span>
          <input
            type="number"
            name="sessionMinutes"
            defaultValue={entry?.sessionMinutes ?? ""}
            min={15}
            max={720}
            step={15}
            placeholder="180"
            className={`num ${field}`}
          />
        </label>
        <label className="text-[11px]">
          <span className={label}>{t("catalogue.category")}</span>
          <input
            name="category"
            defaultValue={entry?.category ?? ""}
            placeholder={t("catalogue.categoryEg")}
            className={field}
          />
        </label>
      </div>

      {/* ------------------------------------------------------ how it works */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px]">
          <span className={label}>{t("catalogue.warnings")}</span>
          <input
            name="notes"
            defaultValue={entry?.notes ?? ""}
            placeholder={t("catalogue.warningsEg")}
            className={field}
          />
        </label>
        <label className="text-[11px]">
          <span className={label}>{t("catalogue.procedure")}</span>
          <input
            name="instructions"
            defaultValue={entry?.instructions ?? ""}
            placeholder={t("catalogue.procedureEg")}
            className={field}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          name="isMeeting"
          defaultChecked={entry?.isMeeting}
        />
        {t("catalogue.isMeeting")}
      </label>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          name="repeatable"
          defaultChecked={entry?.repeatable}
        />
        {t("catalogue.isRepeatable")}{" "}
        <span className="text-muted">{t("catalogue.repeatableEg")}</span>
      </label>

      {/* --------------------------------------------------- how hard it pushes */}
      <fieldset className="rounded border border-line bg-surface-2 p-3">
        <legend className="px-1 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
          {t("catalogue.importance")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["MUST", t("catalogue.must"), t("catalogue.mustHint")],
              ["NORMAL", t("catalogue.normal"), t("catalogue.normalHint")],
              ["SPARE_TIME", t("catalogue.spare"), t("catalogue.spareHint")],
            ] as const
          ).map(([id, text, why]) => (
            <button
              key={id}
              type="button"
              title={why}
              aria-pressed={priority === id}
              onClick={() => setPriority(id)}
              className={
                priority === id
                  ? id === "MUST"
                    ? "rounded border border-stall bg-stall px-2.5 py-1 text-xs font-medium text-white"
                    : "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                  : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
              }
            >
              {text}
            </button>
          ))}
        </div>
        <input type="hidden" name="priority" value={priority} />
        <p className="mt-1.5 text-[11.5px] text-muted">
          {priority === "MUST"
            ? t("catalogue.mustHint")
            : priority === "SPARE_TIME"
              ? t("catalogue.spareHint")
              : t("catalogue.normalHint")}
        </p>
      </fieldset>

      {/* --------------------------------------------- which half of the day */}
      <fieldset className="rounded border border-line bg-surface-2 p-3">
        <legend className="px-1 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
          {t("catalogue.whichHalf")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["", t("catalogue.halfAny")],
              ["MORNING", t("catalogue.halfMorning")],
              ["AFTERNOON", t("catalogue.halfAfternoon")],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id || "any"}
              type="button"
              aria-pressed={half === id}
              onClick={() => setHalf(id)}
              className={
                half === id
                  ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                  : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
              }
            >
              {text}
            </button>
          ))}
        </div>
        <input type="hidden" name="shiftHalf" value={half} />
        <p className="mt-1.5 text-[11.5px] text-muted">
          {t("catalogue.whichHalfHint")}
        </p>
      </fieldset>

      {/* ------------------------------------------------- work that pairs up */}
      <fieldset className="rounded border border-line bg-surface-2 p-3">
        <legend className="px-1 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
          {t("catalogue.goesWith")}
        </legend>
        <label className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-muted">{t("catalogue.comesAfter")}</span>
          <select
            name="followsId"
            defaultValue={entry?.followsId ?? ""}
            className="field min-w-[200px] py-1 text-[12.5px]"
          >
            <option value="">{t("catalogue.comesAfterNothing")}</option>
            {leaderOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1.5 text-[11.5px] text-muted">
          {t("catalogue.comesAfterHint")}
        </p>
      </fieldset>

      {/* --------------------------------------------------------- when */}
      <fieldset className="rounded border border-line bg-surface-2 p-3">
        <legend className="px-1 text-[11px] font-semibold tracking-[0.07em] text-faint uppercase">
          {t("catalogue.whenHappens")}
        </legend>

        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {(
            [
              ["NONE", t("catalogue.onDemand")],
              ["WEEKLY", t("catalogue.certainWeekdays")],
              ["MONTHLY", t("catalogue.monthly")],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={freq === id}
              onClick={() => setFreq(id)}
              className={
                freq === id
                  ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                  : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
              }
            >
              {text}
            </button>
          ))}
        </div>
        <input type="hidden" name="frequency" value={freq} />

        {freq === "NONE" && (
          <p className="text-[12px] text-muted">
            {t("catalogue.onDemandHint")}
          </p>
        )}

        {freq === "WEEKLY" && (
          <>
            <div className="flex flex-wrap gap-1">
              {DAYS.map(([n, text]) => {
                const on = days.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDays((d) =>
                        on ? d.filter((x) => x !== n) : [...d, n],
                      )
                    }
                    className={
                      on
                        ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                        : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                    }
                  >
                    {text}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setDays([1, 2, 3, 4, 5])}
                className="ml-1 rounded border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
              >
                {t("catalogue.everyWeekday")}
              </button>
            </div>
            {days.map((d) => (
              <input key={d} type="hidden" name="weekdays" value={d} />
            ))}
            {days.length === 0 && (
              <p className="mt-1.5 text-[11.5px] text-pause">
                {t("catalogue.pickOneDay")}
              </p>
            )}
          </>
        )}

        {freq === "MONTHLY" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["NTH_WEEKDAY", t("catalogue.particularWeekday")],
                  ["DAY_OF_MONTH", t("catalogue.dateEachMonth")],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={monthlyMode === id}
                  onClick={() => setMonthlyMode(id)}
                  className={
                    monthlyMode === id
                      ? "rounded border border-accent bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent"
                      : "rounded border border-line-strong bg-surface px-2.5 py-1 text-xs text-muted"
                  }
                >
                  {text}
                </button>
              ))}
            </div>
            <input type="hidden" name="monthlyMode" value={monthlyMode} />

            {monthlyMode === "NTH_WEEKDAY" ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="text-muted">{t("catalogue.theNth")}</span>
                <select
                  name="monthlyNth"
                  defaultValue={String(entry?.rule?.monthlyNth ?? -1)}
                  className="rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                >
                  <option value="1">first</option>
                  <option value="2">second</option>
                  <option value="3">third</option>
                  <option value="4">fourth</option>
                  <option value="-1">last</option>
                </select>
                <select
                  name="monthlyWeekday"
                  defaultValue={String(entry?.rule?.weekdays?.[0] ?? 1)}
                  className="rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                >
                  {DAYS.map(([n, text]) => (
                    <option key={n} value={n}>
                      {text}
                    </option>
                  ))}
                </select>
                <span className="text-muted">{t("catalogue.ofEachMonth")}</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="text-muted">{t("catalogue.dayOf")}</span>
                <input
                  type="number"
                  name="monthlyDay"
                  defaultValue={entry?.rule?.monthlyDay ?? 1}
                  min={1}
                  max={31}
                  className="num w-20 rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                />
                <span className="text-muted">
                  {t("catalogue.shortMonthsSkip")}
                </span>
              </div>
            )}
          </div>
        )}

        {freq !== "NONE" && (
          <div className="mt-3 border-t border-line pt-2.5">
            <p className={label}>{t("catalogue.whenInDay")}</p>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["ANYWHERE", t("catalogue.anywhereInDay")],
                  ["FIXED", t("catalogue.atFixedTime")],
                  ["ANCHORS", t("catalogue.atPointsInShift")],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={when === id}
                  onClick={() => setWhen(id)}
                  className={
                    when === id
                      ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                      : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                  }
                >
                  {text}
                </button>
              ))}
            </div>

            {when === "ANYWHERE" && (
              <p className="mt-2 text-[11.5px] text-muted">
                {t("catalogue.otherwiseFitted")}
              </p>
            )}

            {when === "FIXED" && (
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <input
                  type="time"
                  name="fixedStart"
                  defaultValue={
                    entry?.rule?.fixedStartMinutes != null
                      ? formatClock(entry.rule.fixedStartMinutes)
                      : "09:00"
                  }
                  className="num rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                />
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <span className="text-muted">{t("catalogue.timesPerDay")}</span>
                  <input
                    type="number"
                    name="instancesPerOccurrence"
                    defaultValue={entry?.rule?.instancesPerOccurrence ?? 1}
                    min={1}
                    max={20}
                    className="num w-16 rounded border border-line-strong bg-surface px-2 py-1 text-[13px]"
                  />
                </label>
              </div>
            )}

            {when === "ANCHORS" && (
              <div className="mt-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {ANCHORS.map(([id, key]) => {
                    const on = anchors.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleAnchor(id)}
                        className={
                          on
                            ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-accent-ink"
                            : "rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                        }
                      >
                        {t(key)}
                      </button>
                    );
                  })}
                </div>
                {anchors.map((a) => (
                  <input key={a} type="hidden" name="anchors" value={a} />
                ))}
                <p
                  className={`mt-1.5 text-[11.5px] ${
                    anchors.length === 0 ? "text-pause" : "text-muted"
                  }`}
                >
                  {anchors.length === 0
                    ? t("catalogue.pickOnePoint")
                    : t("catalogue.anchorsHint", anchors.length)}
                </p>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {state.error && (
        <p role="alert" className="text-xs text-stall">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={
            pending ||
            (freq === "WEEKLY" && days.length === 0) ||
            (freq !== "NONE" && when === "ANCHORS" && anchors.length === 0)
          }
          className="btn btn-primary"
        >
          {pending
            ? t("common.saving")
            : entry
              ? t("catalogue.saveChanges")
              : t("catalogue.addToCatalogue")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn"
        >
          {t("common.cancel")}
        </button>

        {entry && (
          <>
            <span className="flex-1" />
            <input type="hidden" name="active" value={entry.active ? "false" : "true"} />
            <button
              type="submit"
              formAction={retire}
              className={`rounded border px-2.5 py-1.5 text-[13px] ${
                entry.active
                  ? "border-line-strong hover:border-stall hover:text-stall"
                  : "border-accent text-accent"
              }`}
            >
              {entry.active ? t("catalogue.retire") : t("catalogue.bringBack")}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
