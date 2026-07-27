import { requireUser } from "@/lib/auth/guards";

// Placeholder. The timer, pause-with-reason flow and completion land in
// build step 7.
export default async function MyDayPage() {
  const user = await requireUser();

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">My day</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Signed in as {user.displayName} ({user.role.toLowerCase()}).
      </p>
      <p className="mt-6 rounded-lg border border-dashed border-[var(--color-line)] p-6 text-sm text-[var(--color-muted)]">
        Today&rsquo;s assigned tasks appear here once the scheduling engine is
        wired up.
      </p>
    </div>
  );
}
