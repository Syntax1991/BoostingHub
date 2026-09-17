import { headers } from "next/headers";
import { auth } from "@/auth/auth";
import { requireUser } from "@/auth/session";
import {
  summarizeUserAgent,
  toPublicSessionView,
  type BetterAuthSessionRecord,
  type PublicSessionView,
} from "@/auth/session-view";
import { DomainError } from "@/lib/errors";

function asSessionRecord(session: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
}): BetterAuthSessionRecord {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    token: session.token,
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
    userId: session.userId,
  };
}

/**
 * Self-service session management for the signed-in user only.
 * Uses Better Auth 1.7.3 APIs (listSessions / revokeSession / revokeOtherSessions /
 * revokeSessions / signOut). Never returns raw session tokens to callers.
 */
export const sessionManagementService = {
  async listOwnSessions(): Promise<PublicSessionView[]> {
    await requireUser();
    const requestHeaders = await headers();
    const current = await auth.api.getSession({ headers: requestHeaders });
    if (!current?.session?.id) {
      throw new DomainError("NOT_AUTHENTICATED", "Sign in is required.", 401);
    }

    const sessions = await auth.api.listSessions({ headers: requestHeaders });
    return sessions
      .map((session) => toPublicSessionView(asSessionRecord(session), current.session.id))
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) {
          return a.isCurrent ? -1 : 1;
        }
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
  },

  async revokeOwnSession(sessionId: string): Promise<void> {
    await requireUser();
    const requestHeaders = await headers();
    const current = await auth.api.getSession({ headers: requestHeaders });
    if (!current?.session?.id) {
      throw new DomainError("NOT_AUTHENTICATED", "Sign in is required.", 401);
    }

    if (sessionId === current.session.id) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Use Sign out to end the current session.",
        400,
      );
    }

    const sessions = await auth.api.listSessions({ headers: requestHeaders });
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) {
      throw new DomainError("NOT_FOUND", "Session was not found.", 404);
    }

    // listSessions is scoped to the caller; still refuse if the row somehow mismatches.
    if (target.userId !== current.user.id) {
      throw new DomainError("NOT_AUTHORIZED", "You can only manage your own sessions.", 403);
    }

    await auth.api.revokeSession({
      body: { token: target.token },
      headers: requestHeaders,
    });
  },

  async revokeOtherOwnSessions(): Promise<void> {
    await requireUser();
    const requestHeaders = await headers();
    await auth.api.revokeOtherSessions({ headers: requestHeaders });
  },

  async revokeAllOwnSessions(): Promise<void> {
    await requireUser();
    const requestHeaders = await headers();
    await auth.api.revokeSessions({ headers: requestHeaders });
  },

  async signOutCurrentSession(): Promise<void> {
    const requestHeaders = await headers();
    await auth.api.signOut({ headers: requestHeaders });
  },

  summarizeUserAgent,
};

// Re-export type for Profile consumers.
export type { PublicSessionView };
