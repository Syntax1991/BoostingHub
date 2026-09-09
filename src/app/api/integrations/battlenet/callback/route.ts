import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/auth/session";
import { isDomainError } from "@/lib/errors";
import {
  BATTLENET_OAUTH_STATE_COOKIE,
  battleNetOAuthCookieOptions,
  consumeBattleNetOAuthState,
} from "@/lib/blizzard/oauth-state";
import { battleNetService } from "@/services/battle-net.service";

function appOrigin(request: NextRequest): string {
  // Prefer configured public origin; fall back to request host with localhost preference.
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`.replace("127.0.0.1", "localhost");
  }
  return "http://localhost:3000";
}

function redirectCharacters(
  request: NextRequest,
  params: Record<string, string>,
) {
  const url = new URL("/characters", appOrigin(request));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(BATTLENET_OAUTH_STATE_COOKIE, "", {
    ...battleNetOAuthCookieOptions(0),
    maxAge: 0,
  });
}

/**
 * GET /api/integrations/battlenet/callback
 * Completes Battle.net OAuth, upserts the regional connection, and opens an import session.
 * User OAuth tokens are never persisted.
 */
export async function GET(request: NextRequest) {
  let response: NextResponse;

  try {
    const user = await requireUser();
    const code = request.nextUrl.searchParams.get("code") ?? undefined;
    const stateParam = request.nextUrl.searchParams.get("state") ?? undefined;
    const oauthError = request.nextUrl.searchParams.get("error");

    if (oauthError) {
      response = redirectCharacters(request, {
        battlenet: "error",
        code: "BATTLENET_AUTH_FAILED",
      });
      clearStateCookie(response);
      return response;
    }

    const state = consumeBattleNetOAuthState({
      cookieValue: request.cookies.get(BATTLENET_OAUTH_STATE_COOKIE)?.value,
      stateParam,
      userId: user.id,
    });

    if (!code) {
      response = redirectCharacters(request, {
        battlenet: "error",
        code: "BATTLENET_AUTH_FAILED",
      });
      clearStateCookie(response);
      return response;
    }

    const result = await battleNetService.handleCallback({
      user,
      code,
      region: state.region,
    });

    response = redirectCharacters(request, {
      battlenet: "connected",
      region: result.region,
      importSession: result.importSessionId,
    });
    clearStateCookie(response);
    return response;
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_AUTHENTICATED") {
      const login = new URL("/", appOrigin(request));
      login.searchParams.set("next", "/characters");
      response = NextResponse.redirect(login);
      clearStateCookie(response);
      return response;
    }
    const code = isDomainError(error) ? error.code : "BATTLENET_AUTH_FAILED";
    response = redirectCharacters(request, {
      battlenet: "error",
      code,
    });
    clearStateCookie(response);
    return response;
  }
}
