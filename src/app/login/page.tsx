import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/my-day");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">task-erp</h1>
        <p className="mb-6 text-sm text-[var(--color-muted)]">
          Sign in to see your day.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
