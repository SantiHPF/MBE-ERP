import {
  requireUser,
  hasRole,
  canManagePeople,
  canDecideAbsences,
} from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { logout } from "@/app/login/actions";
import { NavLink } from "./nav-link";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const isManager = hasRole(user, "MANAGER");
  const isHr = canDecideAbsences(user);

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
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-6">
          <span className="py-3.5 text-[15px] font-semibold tracking-tight">
            task<span className="text-accent">·</span>erp
          </span>

          <nav className="flex flex-1 flex-wrap gap-0.5 py-3.5" aria-label="Main">
            <NavLink href="/my-day">My day</NavLink>
            <NavLink href="/plan">Plan week</NavLink>
            <NavLink href="/my-calendar">My calendar</NavLink>
            <NavLink href="/meetings">Meetings</NavLink>
            {isManager && <NavLink href="/team">Team</NavLink>}
            {isManager && <NavLink href="/triage">Triage</NavLink>}
            {isManager && <NavLink href="/catalogue">Catalogue</NavLink>}
            {isHr && (
              <NavLink href="/hr/absences">
                Requests
                {waiting > 0 && (
                  <span className="num ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pause px-1 text-[10px] font-semibold text-white">
                    {waiting}
                  </span>
                )}
              </NavLink>
            )}
            {canManagePeople(user) && <NavLink href="/hr/people">People</NavLink>}
          </nav>

          <div className="flex items-center gap-2.5 py-3.5">
            <div className="hidden text-right leading-tight sm:block">
              <span className="block text-[13px] font-medium">
                {user.displayName}
              </span>
              <span className="block text-[11px] text-faint">
                {user.departmentName.replace(/\s*\(.*\)$/, "")}
              </span>
            </div>
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-wash text-[12px] font-semibold text-accent"
            >
              {initials}
            </span>
            <form action={logout}>
              <button type="submit" className="btn btn-sm">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-7">{children}</main>
    </div>
  );
}
