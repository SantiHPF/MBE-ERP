"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm({
  strings,
}: {
  strings: {
    username: string;
    password: string;
    signIn: string;
    signingIn: string;
  };
}) {
  const [state, formAction, pending] = useActionState(login, initial);

  return (
    <form
      action={formAction}
      className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-sm"
    >
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium">{strings.username}</span>
        <input
          name="username"
          autoComplete="username"
          autoFocus
          className="w-full rounded-md border border-[var(--color-line)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium">{strings.password}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-md border border-[var(--color-line)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      {state.error && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-stop)]"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? strings.signingIn : strings.signIn}
      </button>
    </form>
  );
}
