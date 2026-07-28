import {
  requireUser,
  hasRole,
  canManagePeople,
  canDecideAbsences,
} from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { logout } from "@/app/login/actions";
import { NavLink } from "./nav-link";
import { LocaleProvider } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const isManager = hasRole(user, "MANAGER");
  const isHr = canDecideAbsences(user);
  const { t, locale } = await getT();

  // Badge the queue so HR does not have to go looking for new requests.
  const waiting = isHr
    ? await prisma.absence.count({ where: { status: "PENDING" } })
    : 0;

  const initials = user.displayName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return (
    <LocaleProvider locale={locale}>
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-6">
          <span className="py-3.5 text-[15px] font-semibold tracking-tight">
            task<span className="text-accent">·</span>erp
          </span>

          <nav className="flex flex-1 flex-wrap gap-0.5 py-3.5" aria-label="Main">
            <NavLink href="/my-day">{t("nav.myDay")}</NavLink>
            <NavLink href="/plan">{t("nav.planWeek")}</NavLink>
            <NavLink href="/my-calendar">{t("nav.myCalendar")}</NavLink>
            <NavLink href="/meetings">{t("nav.meetings")}</NavLink>
            {isManager && <NavLink href="/team">{t("nav.team")}</NavLink>}
            {isManager && <NavLink href="/triage">{t("nav.triage")}</NavLink>}
            {isManager && <NavLink href="/catalogue">{t("nav.catalogue")}</NavLink>}
            {isHr && (
              <NavLink href="/hr/absences">
                {t("nav.requests")}
                {waiting > 0 && (
                  <span className="num ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pause px-1 text-[10px] font-semibold text-white">
                    {waiting}
                  </span>
                )}
              </NavLink>
            )}
            {canManagePeople(user) && <NavLink href="/hr/people">{t("nav.people")}</NavLink>}
          </nav>

          <div className="flex items-center gap-2.5 py-3.5">
            <div className="hidden text-right leading-tight sm:block">
              <a href="/me" className="block text-[13px] font-medium hover:text-accent">
                {user.displayName}
              </a>
              <span className="block text-[11px] text-faint">
                {user.departmentName.replace(/\s*\(.*\)$/, "")}
              </span>
            </div>
            <a
              href="/me"
              title={t("common.yourRecord")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-wash text-[12px] font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-ink"
            >
              {initials}
            </a>
            <form action={logout}>
              <button type="submit" className="btn btn-sm">
                {t("common.signOut")}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-7">{children}</main>
    </div>
    </LocaleProvider>
  );
}
