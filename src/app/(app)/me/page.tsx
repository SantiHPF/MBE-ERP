import { requireUser } from "@/lib/auth/guards";
import { getProfileStats } from "@/lib/profile/stats";
import { formatDuration } from "@/lib/time";
import { getT } from "@/lib/i18n/server";
import { LanguagePicker } from "./language-picker";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const stats = await getProfileStats(user.id);
  const { t, locale } = await getT();

  return (
    <div>
      <div className="mb-5">
        <h1 className="page-title">{user.displayName}</h1>
        <p className="page-sub">
          {user.role.toLowerCase()} · {user.departmentName}
        </p>
      </div>

      {/* ------------------------------------------------------- how long */}
      <section className="card mb-5">
        <header className="card-head">
          <span className="eyebrow">{t("profile.yourTimeHere")}</span>
          {stats.tenure.startDate && (
            <span className="num text-[12px] text-muted">
              {t("profile.since", stats.tenure.startDate)}
            </span>
          )}
        </header>

        {stats.tenure.daysHere === null ? (
          <p className="card-body text-[13px] text-muted">
            {t("profile.noStartDate")}
          </p>
        ) : (
          <div className="grid gap-px bg-line sm:grid-cols-3">
            <Figure
              value={stats.tenure.daysHere.toLocaleString("en-GB")}
              unit={t("profile.daysHere")}
              note={stats.tenure.served ?? undefined}
            />
            {stats.tenure.daysLeft === null ? (
              <Figure value="—" unit={t("profile.untilYouLeave")} note={t("profile.indefinite")} />
            ) : (
              <Figure
                value={stats.tenure.daysLeft.toLocaleString("en-GB")}
                unit={t("profile.daysLeft")}
                note={t("profile.lastDay", stats.tenure.endDate ?? "")}
                tone={stats.tenure.daysLeft <= 30 ? "warn" : undefined}
              />
            )}
            <Figure
              value={formatDuration(stats.tracked.total)}
              unit={t("profile.trackedTotal")}
              note={t("profile.thisMonth", formatDuration(stats.tracked.month))}
            />
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------------ the work */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">{t("profile.workFinished")}</span>
          </header>
          <dl className="px-4 py-1.5">
            <Row label={t("common.thisWeek")}>
              {t("profile.tasksCount", stats.completed.week)} ·{" "}
              {formatDuration(stats.tracked.week)}
            </Row>
            <Row label={t("profile.monthLabel")}>
              {t("profile.tasksCount", stats.completed.month)} ·{" "}
              {formatDuration(stats.tracked.month)}
            </Row>
            <Row label={t("profile.allTime")}>
              {t("profile.tasksCount", stats.completed.total)}
            </Row>
          </dl>
        </section>

        {/* ------------------------------------------------- how good the
             estimates are. Framed as the catalogue being wrong, because
             usually it is. */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">{t("profile.estimates")}</span>
            <span className="num text-[12px] text-muted">
              {t("profile.tasksCount", stats.estimate.sample)}
            </span>
          </header>
          {stats.estimate.driftPercent === null ? (
            <p className="card-body text-[13px] text-muted">
              {t("profile.nothingTimed")}
            </p>
          ) : (
            <div className="card-body">
              <p
                className={`num text-[28px] leading-none font-medium tracking-tight ${
                  Math.abs(stats.estimate.driftPercent) <= 10
                    ? "text-run"
                    : "text-pause"
                }`}
              >
                {stats.estimate.driftPercent > 0 ? "+" : ""}
                {stats.estimate.driftPercent}%
              </p>
              <p className="mt-1.5 text-[13px] text-muted">
                {stats.estimate.driftPercent > 0
                  ? t("profile.takesLonger")
                  : stats.estimate.driftPercent < 0
                    ? t("profile.isQuicker")
                    : t("profile.aboutRight")}
              </p>
              <p className="num mt-2 text-[12px] text-faint">
                {t(
                  "profile.actualVs",
                  formatDuration(stats.estimate.actualMinutes),
                  formatDuration(stats.estimate.estimatedMinutes),
                )}
              </p>
            </div>
          )}
        </section>

        {/* ------------------------------------------------- what stops you */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">{t("profile.whatHoldsUp")}</span>
          </header>
          {stats.stalls.length === 0 ? (
            <p className="card-body text-[13px] text-muted">
              {t("profile.noPauses")}
            </p>
          ) : (
            <ul className="px-4 py-1.5">
              {stats.stalls.map((stall) => (
                <li
                  key={stall.reason}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="text-[13px]">{stall.reason}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {stall.count}× · {formatDuration(stall.minutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------- what you do most */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">{t("profile.whatYouDoMost")}</span>
          </header>
          {stats.favourites.length === 0 ? (
            <p className="card-body text-[13px] text-muted">
              {t("profile.nothingFinished")}
            </p>
          ) : (
            <ul className="px-4 py-1.5">
              {stats.favourites.map((fav) => (
                <li
                  key={fav.title}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="truncate text-[13px]">{fav.title}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {fav.count}×
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------------- time off */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">{t("profile.timeOffYear")}</span>
            {stats.pendingRequests > 0 && (
              <span className="badge badge-warn">
                {t("profile.awaitingHr", stats.pendingRequests)}
              </span>
            )}
          </header>
          {stats.timeOff.length === 0 ? (
            <p className="card-body text-[13px] text-muted">
              {t("profile.noneTaken")}
            </p>
          ) : (
            <ul className="px-4 py-1.5">
              {stats.timeOff.map((entry) => (
                <li
                  key={entry.category}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="text-[13px] capitalize">{entry.category}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {entry.days} {t("common.days")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <LanguagePicker current={locale} />

        {/* -------------------------------------------- induction still due */}
        {stats.upcoming.length > 0 && (
          <section className="card">
            <header className="card-head">
              <span className="eyebrow">{t("profile.interviewsComing")}</span>
            </header>
            <ul className="px-4 py-1.5">
              {stats.upcoming.map((item) => (
                <li
                  key={`${item.title}-${item.dueDate}`}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="truncate text-[13px]">{item.title}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {item.dueDate}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Figure({
  value,
  unit,
  note,
  tone,
}: {
  value: string;
  unit: string;
  note?: string;
  tone?: "warn";
}) {
  return (
    <div className="bg-surface px-4 py-4">
      <p
        className={`num text-[30px] leading-none font-medium tracking-[-0.03em] ${
          tone === "warn" ? "text-pause" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[13px] font-medium">{unit}</p>
      {note && <p className="mt-0.5 text-[12px] text-muted">{note}</p>}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="num text-[13px] font-semibold">{children}</dd>
    </div>
  );
}
