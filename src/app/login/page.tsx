import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getLoginT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/my-day");

  // Nobody is signed in, so there is no language preference to read. getLoginT
  // defaults to Spanish and only yields to a browser that asks for English.
  const { t } = await getLoginT();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">MBE ERP</h1>
        <p className="mb-6 text-sm text-[var(--color-muted)]">
          {t("login.tagline")}
        </p>
        <LoginForm
          strings={{
            username: t("login.username"),
            password: t("login.password"),
            signIn: t("login.signIn"),
            signingIn: t("login.signingIn"),
          }}
        />
      </div>
    </main>
  );
}
