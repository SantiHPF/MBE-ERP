import { requireUser, hasRole, canManagePeople, canDecideAbsences } from "@/lib/auth/guards";
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="font-semibold tracking-tight">task-erp</span>

          <nav className="flex flex-1 flex-wrap gap-1 text-sm">
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
                  <span className="num ml-1.5 rounded-full bg-pause px-1.5 py-px text-[10px] font-semibold text-white">
                    {waiting}
                  </span>
                )}
              </NavLink>
            )}
            {canManagePeople(user) && <NavLink href="/hr/people">People</NavLink>}
          </nav>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--color-muted)]">
              {user.displayName} · {user.departmentName}
            </span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs hover:bg-[var(--color-canvas)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
