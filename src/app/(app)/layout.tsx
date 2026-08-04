import {
  requireUser,
  hasRole,
  canManagePeople,
  canDecideAbsences,
} from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { logout } from "@/app/login/actions";
import { NavLink } from "./nav-link";
import { MessageBadge } from "./message-badge";
import { unreadFor } from "@/lib/messages/db";
import { LocaleProvider } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";
import { readTheme } from "@/lib/theme/read";
import { ThemeToggle } from "./theme-toggle";
import { getNowState } from "@/lib/tasks/now-db";
import { scheduleZone } from "@/lib/time";
import { NowProvider } from "./now-provider";
import { TopBar } from "./top-bar";
import { getNotifications } from "@/lib/notifications/read";
import { Bell } from "./notifications/bell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const isManager = hasRole(user, "MANAGER");
  const isHr = canDecideAbsences(user);
  const isPeopleAdmin = canManagePeople(user);
  const { t, locale } = await getT();
  const theme = await readTheme();
  // The running-task bar is part of the shell, not of My Day -- see now.ts
  // for why this is a slimmer query than getDayView().
  const now = await getNowState(user.id);

  // Badge the queue so HR does not have to go looking for new requests.
  const waiting = isHr
    ? await prisma.absence.count({ where: { status: "PENDING" } })
    : 0;

  // The first count on this page that everybody has. Server-rendered like the
  // one above, and kept fresh between navigations by the poll in NowProvider.
  const unread = await unreadFor(user.id);

  // Role-gated inside getNotifications: a WORKER gets three empty arrays
  // rather than a special case here.
  const feed = await getNotifications(user);

  const initials = user.displayName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  /**
   * Grouped rather than one flat list: there are ten destinations now, and a
   * run of ten is something you search rather than read.
   *
   * A group with nothing in it does not render, so a WORKER sees only "Work"
   * without any special-casing here.
   */
  const groups: { label: string; links: React.ReactNode[] }[] = [
    {
      label: t("nav.groupWork"),
      links: [
        <NavLink key="my-day" href="/my-day" icon="day">{t("nav.myDay")}</NavLink>,
        <NavLink key="plan" href="/plan" icon="plan">{t("nav.planWeek")}</NavLink>,
        <NavLink key="cal" href="/my-calendar" icon="calendar">{t("nav.myCalendar")}</NavLink>,
        <NavLink key="meet" href="/meetings" icon="meetings">{t("nav.meetings")}</NavLink>,
        <NavLink key="msg" href="/messages" icon="messages">
          {t("nav.messages")}
          <MessageBadge initial={unread} />
        </NavLink>,
        <NavLink key="p1n" href="/p1n" icon="p1n">{t("nav.p1n")}</NavLink>,
      ],
    },
    {
      label: t("nav.groupTeam"),
      links: isManager
        ? [
            <NavLink key="team" href="/team" icon="team">{t("nav.team")}</NavLink>,
            <NavLink key="triage" href="/triage" icon="triage">{t("nav.triage")}</NavLink>,
            <NavLink key="cat" href="/catalogue" icon="catalogue">{t("nav.catalogue")}</NavLink>,
          ]
        : [],
    },
    {
      label: t("nav.groupHr"),
      links: [
        ...(isHr
          ? [
              <NavLink key="req" href="/hr/absences" icon="requests">
                {t("nav.requests")}
                {waiting > 0 && (
                  <span className="num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pause px-1 text-[10px] font-semibold text-white">
                    {waiting}
                  </span>
                )}
              </NavLink>,
            ]
          : []),
        ...(isPeopleAdmin
          ? [
              <NavLink key="people" href="/hr/people" icon="people">{t("nav.people")}</NavLink>,
              <NavLink key="crm" href="/crm/sources" icon="sources">{t("nav.crm")}</NavLink>,
            ]
          : []),
      ],
    },
  ].filter((group) => group.links.length > 0);

  return (
    <LocaleProvider locale={locale}>
      <NowProvider state={now} zone={scheduleZone()}>
      <div className="lg:flex lg:min-h-screen">
        {/*
          A sidebar from `lg` up. Below that it stays the horizontal bar it has
          always been -- a fixed 238px column on a phone leaves nothing for the
          page, and the mobile pass that turns this into a drawer is separate
          work.
        */}
        <aside
          className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur
                     lg:top-0 lg:h-screen lg:w-[238px] lg:shrink-0 lg:overflow-y-auto
                     lg:border-r lg:border-b-0"
        >
          <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-6 lg:mx-0 lg:h-full lg:max-w-none lg:flex-col lg:items-stretch lg:gap-0 lg:px-3 lg:py-4">
            {/*
              The stamp lockup from the brand book: a mark, the name, and a
              tracked descriptor under it. The square *is* the mark -- an
              approximation of the shield and owl would be a worse
              counterfeit than a wordmark.
            */}
            <a
              href="/my-day"
              className="flex shrink-0 items-center gap-2.5 py-3.5 lg:px-1.5 lg:pt-0 lg:pb-5"
            >
              <span
                aria-hidden="true"
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent text-[12.5px] font-bold text-accent-ink"
              >
                MB
              </span>
              <span className="leading-tight">
                <span className="block text-body font-semibold tracking-[-0.01em]">
                  MBE ERP
                </span>
                <span className="nav-group block">{t("nav.brandSub")}</span>
              </span>
            </a>

            <nav
              /* The spacing between groups is on the groups themselves now,
                 so that the dividing rule sits inside it rather than beside
                 a gap the flex container also contributes to. */
              className="flex flex-1 flex-wrap gap-0.5 py-3.5 lg:flex-none lg:flex-col lg:flex-nowrap lg:gap-0 lg:py-0"
              aria-label="Main"
            >
              {groups.map((group, i) => (
                <div
                  key={group.label}
                  /*
                    A rule and real space above each group after the first.
                    Uppercase alone was doing all the work of separating a
                    heading from a link, and at a glance it lost -- thirteen
                    things that all looked like destinations.

                    With the sections visibly apart, the heading can stop
                    competing: it gets smaller and fainter while the links get
                    bigger and darker, so the two now differ in size, weight,
                    colour, tracking and position rather than in case alone.
                  */
                  className={`flex flex-wrap gap-0.5 lg:flex-col lg:gap-0.5 ${
                    i > 0 ? "lg:mt-5 lg:border-t lg:border-line lg:pt-4" : ""
                  }`}
                >
                  {/* The headings are what makes ten links readable, but they
                      would double the height of the bar on a narrow screen. */}
                  <p className="nav-group hidden px-2.5 pb-1.5 lg:block">
                    {group.label}
                  </p>
                  {group.links}
                </div>
              ))}
            </nav>

            {/* Pinned to the bottom of the column, where it stops competing
                with the navigation for the top corner.

                The name and the sign-out button stack rather than share a
                row -- when the column was narrower it truncated "Santiago
                Hernandez" to "Sa…" -- and sign-out stays a quiet full-width
                action rather than a button squeezed against the edge. */}
            <div className="flex items-center gap-2.5 py-3.5 lg:mt-auto lg:flex-col lg:items-stretch lg:gap-2 lg:border-t lg:border-line lg:px-1 lg:pt-3 lg:pb-0">
              <a
                href="/me"
                title={t("common.yourRecord")}
                className="flex items-center gap-2.5 rounded-md lg:px-1.5 lg:py-1.5 lg:transition-colors lg:hover:bg-surface-2"
              >
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-accent-wash text-[12px] font-semibold text-accent">
                  {initials}
                </span>
                <span className="hidden min-w-0 leading-tight sm:block">
                  <span className="block truncate text-[13px] font-[550]">
                    {user.displayName}
                  </span>
                  <span className="block truncate text-micro text-faint">
                    {user.departmentName.replace(/\s*\(.*\)$/, "")}
                  </span>
                </span>
              </a>
              {/* Sign-out and the theme toggle share the bottom row: one is
                  the thing you almost never press, the other the thing you
                  want within reach, and neither deserves a line of its own. */}
              <div className="flex items-center gap-1 lg:w-full">
                <form action={logout} className="lg:min-w-0 lg:flex-1">
                  <button
                    type="submit"
                    className="btn btn-sm lg:w-full lg:justify-start lg:border-transparent lg:bg-transparent lg:px-2.5 lg:text-muted lg:hover:bg-surface-2 lg:hover:text-ink"
                  >
                    {t("common.signOut")}
                  </button>
                </form>
                <ThemeToggle current={theme} />
              </div>
            </div>
          </div>
        </aside>

        {/*
          The bar and the column it caps.

          1180px is what the design draws every screen at, and it is right for
          all of them except the two matrix screens -- /plan and /team put five
          day-columns side by side and were widened on purpose after they came
          out cramped. So the cap is the design's, and those two opt out by
          marking their own root `data-wide`.

          Done with :has() rather than a prop so no server component has to
          thread a width down to a layout that has no business knowing routes.
        */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar>
            <Bell feed={feed} zone={scheduleZone()} />
          </TopBar>
          <main className="w-full px-6 py-[22px] pb-[92px] lg:px-8">
            <div className="mx-auto w-full max-w-[1180px] [&:has([data-wide])]:max-w-[1600px]">
              {children}
            </div>
          </main>
        </div>
      </div>
      </NowProvider>
    </LocaleProvider>
  );
}
