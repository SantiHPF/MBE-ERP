import "server-only";
import { getT } from "./server";

/**
 * Server actions used to return English sentences, which the Spanish half of
 * the company never saw translated. Now they carry dictionary keys and the
 * wording is resolved here, at the edge, once the locale is known -- the same
 * shape login/actions.ts already used.
 */

/** An error whose message is a dictionary key rather than a sentence. */
export class MessageError extends Error {
  constructor(key: string) {
    super(key);
    this.name = "MessageError";
  }
}

/** Stop with a message the user is meant to read. */
export function fail(key: string): never {
  throw new MessageError(key);
}

/**
 * Turn a caught error into something worth showing.
 *
 * Ours carry a dictionary key. Anything else is a bug rather than a message
 * for the user, so it is logged and replaced -- an internal Prisma or runtime
 * message in the interface tells them nothing and leaks how the app is built.
 */
export async function errorText(
  error: unknown,
  fallbackKey: string,
): Promise<string> {
  const { t } = await getT();
  if (error instanceof MessageError) return t(error.message);
  console.error(error);
  return t(fallbackKey);
}

/** Translate a key inside an action, for the non-throwing return paths. */
export async function message(
  key: string,
  ...args: (string | number)[]
): Promise<string> {
  const { t } = await getT();
  return t(key, ...args);
}
