import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { resolveSafeCallbackPath } from "@/auth/safe-callback-path";

/**
 * Every top-level route in src/app/(app). Keep in sync with config.matcher
 * (which must stay a literal for Next.js static analysis); proxy.test.ts enforces both.
 */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/runs",
  "/my-runs",
  "/characters",
  "/profile",
  "/manage",
  "/settings",
  "/notifications",
];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Cookie existence check only. Real authorization happens in controllers via requireUser / requireRaidLead.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const login = new URL("/", request.url);
    const safeNext = resolveSafeCallbackPath(pathname);
    login.searchParams.set("next", safeNext);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/runs/:path*",
    "/my-runs/:path*",
    "/characters/:path*",
    "/profile/:path*",
    "/manage/:path*",
    "/settings/:path*",
    "/notifications/:path*",
  ],
};
