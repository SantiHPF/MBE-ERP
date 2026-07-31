"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { offerFillers, takeFiller, type FillerState } from "@/lib/gaps/actions";
import type { Offer } from "@/lib/gaps/offer-db";
import { formatDuration } from "@/lib/time";
import { useT } from "@/lib/i18n/client";

/**
 * "You have twenty-five minutes. Here is something worth doing with them."
 *
 * The offer is fetched when the dialog opens rather than carried in the page,
 * because the four pools behind it are four more queries and the bar this
 * hangs off renders on every page in the app. It is also the only honest
 * moment to ask: an offer computed at page load would be stale by the time
 * anybody had a gap.
 *
 * Nothing is written until Start is pressed, and the server re-checks the gap
 * then -- see takeFiller().
 */

const initial: FillerState = {};

export function FillerDialog({
  /** Minutes the schedule thinks are free, used as the starting suggestion. */
  gapMinutes,
  /** True when the person asked, rather than the day noticing. */
  asked,
  skipped,
  onSkip,
  onClose,
  onStarted,
}: {
  gapMinutes: number;
  asked: boolean;
  skipped: string[];
  onSkip: (id: string) => void;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { t } = useT();
  const startButton = useRef<HTMLButtonElement>(null);

  // Never zero: "I have time" is worth asking even when the schedule thinks
  // the day is full, and the server would reject a request for no minutes.
  const opening = Math.max(1, gapMinutes);
  const [minutes, setMinutes] = useState(opening);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, load] = useTransition();

  // The minutes the offers were fetched for, so editing the field refetches.
  const [askedFor, setAskedFor] = useState(opening);

  useEffect(() => {
    load(async () => {
      const result = await offerFillers({
        minutes: askedFor,
        excludeIds: skipped,
      });
      setOffers(result.offers);
      setIndex(0);
    });
    // Deliberately keyed on askedFor alone. `skipped` is read at fetch time to
    // seed the round, but changing it must not refetch: "something else" walks
    // the alternatives already in hand, and refetching would throw them away.
  }, [askedFor]);

  const offer = offers?.[index] ?? null;

  const [state, take, taking] = useActionState(
    async (prev: FillerState, formData: FormData): Promise<FillerState> => {
      const result = await takeFiller(prev, formData);
      if (result.ok) onStarted();
      return result;
    },
    initial,
  );

  useEffect(() => {
    if (offer) startButton.current?.focus();
  }, [offer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function skip() {
    if (!offer) return;
    onSkip(offer.taskId ?? offer.templateId!);
    // Another one already in hand, or nothing more to show.
    setIndex((i) => i + 1);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filler-title"
        className="w-full max-w-[420px] rounded-[10px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)]"
      >
        <p className="eyebrow text-run">{t("gaps.eyebrow")}</p>

        <h2
          id="filler-title"
          className="mt-1 text-[16px] font-semibold tracking-[-0.012em]"
        >
          {asked ? t("gaps.howLong") : t("gaps.youHave", formatDuration(askedFor))}
        </h2>

        {/* Their number beats the schedule's, because they know why the hole
            is there and it does not. */}
        {asked && (
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input
              type="number"
              min={1}
              max={720}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              onBlur={() => setAskedFor(Math.max(1, minutes || 1))}
              className="field num w-[72px] py-1 text-[13px]"
            />
            <span className="text-muted">{t("gaps.minutes")}</span>
          </label>
        )}

        {loading || offers === null ? (
          <p className="mt-4 text-[13px] text-muted">{t("gaps.looking")}</p>
        ) : offer ? (
          <>
            <h3
              id={asked ? "filler-title" : undefined}
              className="mt-3 text-[15px] font-semibold text-balance"
            >
              {offer.title}
            </h3>
            <p className="num mt-1 text-[12.5px] text-muted">
              {formatDuration(offer.estimatedMinutes)}
            </p>
            {/* Why this one, so the pick is arguable rather than magic. The
                counter gives "something else" a visible end. */}
            <p className="mt-1 flex items-baseline gap-2 text-[12px] text-faint">
              <span>{t(offer.reason)}</span>
              {offers.length > 1 && (
                <span className="num shrink-0">
                  {t("gaps.position", index + 1, offers.length)}
                </span>
              )}
            </p>

            {offer.notes && (
              <p className="mt-3.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
                {offer.notes}
              </p>
            )}

            {offer.instructions && (
              <p className="mt-2 text-[12px] text-muted">
                {t("myDay.howTo")} {offer.instructions}
              </p>
            )}

            {state.error && (
              <p role="alert" className="mt-3 text-[12px] text-stall">
                {state.error}
              </p>
            )}

            <form action={take} className="mt-4 flex items-center gap-2">
              <input type="hidden" name="source" value={offer.source} />
              {offer.taskId && (
                <input type="hidden" name="taskId" value={offer.taskId} />
              )}
              {offer.templateId && !offer.taskId && (
                <input type="hidden" name="templateId" value={offer.templateId} />
              )}
              <input type="hidden" name="minutes" value={askedFor} />

              <button
                type="button"
                onClick={skip}
                disabled={taking || index + 1 >= (offers?.length ?? 0)}
                className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-40"
              >
                {t("gaps.another")}
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2"
              >
                {t("gaps.notNow")}
              </button>
              <button
                ref={startButton}
                type="submit"
                disabled={taking}
                className="rounded border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-45"
              >
                {taking
                  ? t("gaps.taking")
                  : offer.isMeeting
                    ? t("myDay.startWithNotes")
                    : t("gaps.take")}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-muted">
              {t("gaps.nothingFits", formatDuration(askedFor))}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2"
              >
                {t("gaps.notNow")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
