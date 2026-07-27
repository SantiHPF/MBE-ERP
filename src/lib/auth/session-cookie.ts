/**
 * The cookie name lives on its own so middleware (edge runtime) can import it
 * without pulling in session.ts, which depends on Prisma and node:crypto.
 */
export const SESSION_COOKIE = "task_erp_session";
