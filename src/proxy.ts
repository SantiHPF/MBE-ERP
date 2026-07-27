import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

/**
 * Next 16's replacement for the middleware convention. It runs on the edge
 * runtime, where Prisma is unavailable, so this only checks that a session
 * cookie exists. Whether it is *valid* is decided by requireUser() in the
 * authenticated layout, which can reach the database. The cheap check here
 * just keeps signed-out traffic off the app routes.
 */
export function proxy(request: NextRequest) {
  const hasCookie = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasCookie && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
