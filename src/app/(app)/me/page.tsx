import { requireUser } from "@/lib/auth/guards";
import { getProfileStats } from "@/lib/profile/stats";
import { formatDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const stats = await getProfileStats(user.id);

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
          <span className="eyebrow">Your time here</span>
          {stats.tenure.startDate && (
            <span className="num text-[12px] text-muted">
              since {stats.tenure.startDate}
            </span>
          )}
        </header>

        {stats.tenure.daysHere === null ? (
          <p className="card-body text-[13px] text-muted">
            No start date on record. HR can add one on the People page.
          </p>
        ) : (
          <div className="grid gap-px bg-line sm:grid-cols-3">
            <Figure
              value={stats.tenure.daysHere.toLocaleString("en-GB")}
              unit="days here"
              note={stats.tenure.served ?? undefined}
            />
            {stats.tenure.daysLeft === null ? (
              <Figure value="—" unit="until you leave" note="indefinite" />
            ) : (
              <Figure
                value={stats.tenure.daysLeft.toLocaleString("en-GB")}
                unit="days left"
                note={`last day ${stats.tenure.endDate}`}
                tone={stats.tenure.daysLeft <= 30 ? "warn" : undefined}
              />
            )}
            <Figure
              value={formatDuration(stats.tracked.total)}
              unit="tracked in total"
              note={`${formatDuration(stats.tracked.month)} this month`}
            />
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------------ the work */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">Work finished</span>
          </header>
          <dl className="px-4 py-1.5">
            <Row label="This week">
              {stats.completed.week} tasks · {formatDuration(stats.tracked.week)}
            </Row>
            <Row label="This month">
              {stats.completed.month} tasks ·{" "}
              {formatDuration(stats.tracked.month)}
            </Row>
            <Row label="All time">{stats.completed.total} tasks</Row>
          </dl>
        </section>

        {/* ------------------------------------------------- how good the
             estimates are. Framed as the catalogue being wrong, because
             usually it is. */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">How close the estimates are</span>
            <span className="num text-[12px] text-muted">
              {stats.estimate.sample} tasks
            </span>
          </header>
          {stats.estimate.driftPercent === null ? (
            <p className="card-body text-[13px] text-muted">
              Nothing timed yet. Finish a few tasks and this fills in.
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
                  ? "Your work takes longer than the catalogue says."
                  : stats.estimate.driftPercent < 0
                    ? "Your work is quicker than the catalogue says."
                    : "The catalogue has it about right."}
              </p>
              <p className="num mt-2 text-[12px] text-faint">
                {formatDuration(stats.estimate.actualMinutes)} actual vs{" "}
                {formatDuration(stats.estimate.estimatedMinutes)} estimated
              </p>
            </div>
          )}
        </section>

        {/* ------------------------------------------------- what stops you */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">What holds your work up</span>
          </header>
          {stats.stalls.length === 0 ? (
            <p className="card-body text-[13px] text-muted">
              You have not paused anything yet.
            </p>
          ) : (
            <ul className="px-4 py-1.5">
              {stats.stalls.map((s) => (
                <li
                  key={s.reason}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="text-[13px]">{s.reason}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {s.count}× · {formatDuration(s.minutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------- what you do most */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">What you do most</span>
          </header>
          {stats.favourites.length === 0 ? (
            <p className="card-body text-[13px] text-muted">
              Nothing finished yet.
            </p>
          ) : (
            <ul className="px-4 py-1.5">
              {stats.favourites.map((f) => (
                <li
                  key={f.title}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="truncate text-[13px]">{f.title}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {f.count}×
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------------- time off */}
        <section className="card">
          <header className="card-head">
            <span className="eyebrow">Time off this year</span>
            {stats.pendingRequests > 0 && (
              <span className="badge badge-warn">
                {stats.pendingRequests} awaiting HR
              </span>
            )}
          </header>
          {stats.timeOff.length === 0 ? (
            <p className="card-body text-[13px] text-muted">
              None taken this year.
            </p>
          ) : (
            <ul className="px-4 py-1.5">
              {stats.timeOff.map((t) => (
                <li
                  key={t.category}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="text-[13px] capitalize">{t.category}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {t.days} {t.days === 1 ? "day" : "days"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* -------------------------------------------- induction still due */}
        {stats.upcoming.length > 0 && (
          <section className="card">
            <header className="card-head">
              <span className="eyebrow">Your interviews coming up</span>
            </header>
            <ul className="px-4 py-1.5">
              {stats.upcoming.map((u) => (
                <li
                  key={`${u.title}-${u.dueDate}`}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="truncate text-[13px]">{u.title}</span>
                  <span className="num shrink-0 text-[12px] text-muted">
                    {u.dueDate}
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
