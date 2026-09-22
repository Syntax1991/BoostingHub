import { headers } from "next/headers";
import { auth } from "@/auth/auth";
import { requireUser } from "@/auth/session";
import {
  summarizeUserAgent,
  toPublicSessionView,
  type PublicSessionView,
} from "@/auth/session-view";
import { DomainError } from "@/lib/errors";
import { authSessionRepository } from "@/repositories/auth-session.repository";

/**
 * Self-service session management for the signed-in user only.
 * Lists via Prisma (no Better Auth freshAge gate). Revokes via Better Auth
 * 1.7.3 APIs (revokeSession / revokeOtherSessions / revokeSessions / signOut).
 * Never returns raw session tokens to callers.
 */
export const sessionManagementService = {
  async listOwnSessions(): Promise<PublicSessionView[]> {
    await requireUser();
    const requestHeaders = await headers();
    const current = await auth.api.getSession({ headers: requestHeaders });
    if (!current?.session?.id) {
      throw new DomainError("NOT_AUTHENTICATED", "Sign in is required.", 401);
    }

    const sessions = await authSessionRepository.listActiveByUserId(current.user.id);
    return sessions
      .map((session) => toPublicSessionView(session, current.session.id))
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

    const target = await authSessionRepository.findOwnedActiveById(current.user.id, sessionId);
    if (!target) {
      throw new DomainError("NOT_FOUND", "Session was not found.", 404);
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
