import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/auth/session";
import { isDomainError } from "@/lib/errors";
import { battleNetService } from "@/services/battle-net.service";
import { WOW_REGIONS } from "@/models/enums";

function appOrigin(request: NextRequest): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`.replace("127.0.0.1", "localhost");
  }
  return "http://localhost:3000";
}

function charactersErrorRedirect(request: NextRequest, code: string) {
  const url = new URL("/characters", appOrigin(request));
  url.searchParams.set("battlenet", "error");
  url.searchParams.set("code", code);
  return NextResponse.redirect(url);
}

/**
 * GET /api/integrations/battlenet/connect?region=EU|US
 * Starts Battle.net OAuth for an authenticated Discord user.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const region = request.nextUrl.searchParams.get("region") ?? "";
    if (!(WOW_REGIONS as readonly string[]).includes(region)) {
      return charactersErrorRedirect(request, "VALIDATION_FAILED");
    }

    const started = battleNetService.beginConnect(user, region);
    const response = NextResponse.redirect(started.authorizationUrl);
    response.cookies.set(started.cookie.name, started.cookie.value, started.cookie.options);
    return response;
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_AUTHENTICATED") {
      const login = new URL("/", appOrigin(request));
      const region = request.nextUrl.searchParams.get("region") ?? "";
      login.searchParams.set(
        "next",
        `/api/integrations/battlenet/connect?region=${encodeURIComponent(region)}`,
      );
      return NextResponse.redirect(login);
    }
    if (isDomainError(error)) {
      return charactersErrorRedirect(request, error.code);
    }
    return charactersErrorRedirect(request, "BATTLENET_AUTH_FAILED");
  }
}
