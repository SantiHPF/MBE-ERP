import { getT } from "@/lib/i18n/server";
import { formatDuration } from "@/lib/time";
import { formatDayMonth, fromDateKey } from "@/lib/i18n/dates";
import { presentMinutes, warmUpMinutes } from "@/lib/attendance/attendance";
import { recentAttendance } from "@/lib/attendance/attendance-db";
import { scheduleZone } from "@/lib/time";

/**
 * Somebody's own attendance, and only their own.
 *
 * The four signals are kept apart in the database, so a day where they signed
 * in at 08:00 and started work at 09:40 can say so. Folding that into one
 * in/out pair here would throw away the only interesting thing in the record.
 */
export async function AttendanceCard({ userId }: { userId: string }) {
  const { t, locale } = await getT();
  const days = await recentAttendance(userId);
  const zone = scheduleZone();

  const clock = (at: Date | null) =>
    at
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(at)
      : "—";

  return (
    <section className="card">
      <header className="card-head">
        <span className="eyebrow">{t("attendance.title")}</span>
        {days.length > 0 && (
          <span className="num text-[12px] text-muted">
            {days.length} {t("common.days")}
          </span>
        )}
      </header>

      {days.length === 0 ? (
        <p className="card-body text-[13px] text-muted">{t("attendance.noneYet")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className="eyebrow px-4 py-2 text-left">{t("common.day")}</th>
                <th className="eyebrow px-2 py-2 text-right">
                  {t("attendance.arrived")}
                </th>
                <th className="eyebrow px-2 py-2 text-right">{t("attendance.left")}</th>
                <th className="eyebrow px-4 py-2 text-right">
                  {t("attendance.present")}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const total = presentMinutes(day.startedAt, day.endedAt);
                const warmUp = warmUpMinutes({
                  firstLoginAt: day.firstLoginAt,
                  firstTaskStartAt: day.firstTaskStartAt,
                  lastTaskEndAt: day.lastTaskEndAt,
                  logoutAt: day.logoutAt,
                  lastActivityAt: day.lastActivityAt,
                });

                return (
                  <tr key={day.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      {formatDayMonth(fromDateKey(day.date.toISOString().slice(0, 10)), locale)}
                      {day.status === "NEEDS_REVIEW" && (
                        <span className="badge badge-warn ml-2">
                          {t("attendance.needsReview")}
                        </span>
                      )}
                      {/* The gap between arriving and starting work is the
                          one thing a single in/out pair would hide. */}
                      {warmUp != null && warmUp >= 10 && (
                        <span className="mt-0.5 block text-[11px] text-faint">
                          {t("attendance.beforeWork", formatDuration(warmUp))}
                        </span>
                      )}
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {clock(day.startedAt)}
                      <span className="ml-1.5 text-[10px] text-faint">
                        {day.startSource ? t(`attendance.source${day.startSource}`) : ""}
                      </span>
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {day.endedAt ? clock(day.endedAt) : (
                        <span className="text-pause">{t("attendance.stillOpen")}</span>
                      )}
                      {day.endSource && (
                        <span className="ml-1.5 text-[10px] text-faint">
                          {t(`attendance.source${day.endSource}`)}
                        </span>
                      )}
                    </td>
                    <td className="num px-4 py-2 text-right font-semibold">
                      {total != null ? formatDuration(total) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
