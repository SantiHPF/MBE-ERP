"use client";

import { useState } from "react";
import {
  activeCount,
  EMPTY_FILTERS,
  type Field,
  type FilterState,
} from "@/lib/filters/filters";
import { useT } from "@/lib/i18n/client";

/**
 * Controls built from the field list rather than written by hand.
 *
 * The point of declaring the fields is that this component never has to know
 * what it is filtering: a property added to the row is a line in the
 * declaration, not a new control in here.
 */
export function FilterBar<T>({
  fields,
  state,
  onChange,
  shown,
  total,
}: {
  fields: Field<T>[];
  state: FilterState;
  onChange: (next: FilterState) => void;
  shown: number;
  total: number;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const count = activeCount(state);

  const enums = fields.filter((f) => f.kind === "enum");
  const bools = fields.filter((f) => f.kind === "bool");
  const dates = fields.filter((f) => f.kind === "date");
  const hasMore = enums.length + bools.length + dates.length > 0;

  function setEnum(key: string, value: string) {
    const current = state.enums[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...state, enums: { ...state.enums, [key]: next } });
  }

  /** Off → yes → no → off, so one control covers all three answers. */
  function cycleBool(key: string) {
    const current = state.bools[key];
    const next = { ...state.bools };
    if (current === undefined) next[key] = true;
    else if (current === true) next[key] = false;
    else delete next[key];
    onChange({ ...state, bools: next });
  }

  function setDate(key: string, side: "from" | "to", value: string) {
    const bounds = { ...(state.dates[key] ?? {}) };
    if (value) bounds[side] = value;
    else delete bounds[side];
    onChange({ ...state, dates: { ...state.dates, [key]: bounds } });
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={state.query}
          onChange={(e) => onChange({ ...state, query: e.target.value })}
          placeholder={t("filters.search")}
          aria-label={t("filters.search")}
          className="field w-64"
        />

        {hasMore && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={count > 0 ? "btn btn-sm border-accent text-accent" : "btn btn-sm"}
          >
            {t("filters.more")}
            {count > 0 && ` (${count})`}
          </button>
        )}

        {count > 0 && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="btn btn-sm btn-danger"
          >
            {t("filters.clear")}
          </button>
        )}

        <span className="flex-1" />

        {/* Says how much is being hidden, so a filter left on is never a
            mystery about where everything went. */}
        <span className="num text-[12px] text-muted">
          {shown === total
            ? t("filters.showingAll", total)
            : t("filters.showingSome", shown, total)}
        </span>
      </div>

      {open && hasMore && (
        <div className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3">
          {enums.map((field) =>
            field.kind !== "enum" ? null : (
              <div key={field.key}>
                <p className="field-label">{field.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {field.options.map((option) => {
                    const on = (state.enums[field.key] ?? []).includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setEnum(field.key, option.value)}
                        className={
                          on
                            ? "rounded-md border border-accent bg-accent px-2.5 py-1 text-[12.5px] font-medium text-accent-ink"
                            : "rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ),
          )}

          {bools.length > 0 && (
            <div>
              <p className="field-label">{t("filters.alsoBy")}</p>
              <div className="flex flex-wrap gap-1.5">
                {bools.map((field) =>
                  field.kind !== "bool" ? null : (
                    <button
                      key={field.key}
                      type="button"
                      onClick={() => cycleBool(field.key)}
                      className={
                        state.bools[field.key] === undefined
                          ? "rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-ink"
                          : "rounded-md border border-accent bg-accent px-2.5 py-1 text-[12.5px] font-medium text-accent-ink"
                      }
                    >
                      {state.bools[field.key] === undefined
                        ? field.label
                        : state.bools[field.key]
                          ? field.yes
                          : field.no}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}

          {dates.map((field) =>
            field.kind !== "date" ? null : (
              <div key={field.key}>
                <p className="field-label">{field.label}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                  <label className="flex items-center gap-1.5">
                    {t("common.from")}
                    <input
                      type="date"
                      value={state.dates[field.key]?.from ?? ""}
                      onChange={(e) => setDate(field.key, "from", e.target.value)}
                      className="field num w-36 py-1"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    {t("common.to")}
                    <input
                      type="date"
                      value={state.dates[field.key]?.to ?? ""}
                      onChange={(e) => setDate(field.key, "to", e.target.value)}
                      className="field num w-36 py-1"
                    />
                  </label>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
