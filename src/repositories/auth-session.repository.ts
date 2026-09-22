import { orm } from "@/lib/prisma";
import { asString, asStringOrNull } from "@/lib/persistence";
import type { BetterAuthSessionRecord } from "@/auth/session-view";

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  return new Date(NaN);
}

function mapSession(row: Record<string, unknown>): BetterAuthSessionRecord {
  return {
    id: asString(row.id),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    expiresAt: asDate(row.expiresAt),
    token: asString(row.token),
    ipAddress: asStringOrNull(row.ipAddress),
    userAgent: asStringOrNull(row.userAgent),
    userId: asString(row.userId),
  };
}

/**
 * Read path for Better Auth `session` rows owned by the signed-in user.
 * Listing via Prisma avoids Better Auth `/list-sessions`, which requires a
 * fresh session (default freshAge = 1 day) and would otherwise crash Profile.
 */
export const authSessionRepository = {
  async listActiveByUserId(userId: string): Promise<BetterAuthSessionRecord[]> {
    const now = Date.now();
    const rows = await orm.Session.where({ userId }).all();
    return rows
      .map((row) => mapSession(row as Record<string, unknown>))
      .filter((session) => session.expiresAt.getTime() > now);
  },

  async findOwnedActiveById(
    userId: string,
    sessionId: string,
  ): Promise<BetterAuthSessionRecord | null> {
    const row = await orm.Session.where({ id: sessionId, userId }).first();
    if (!row) {
      return null;
    }
    const session = mapSession(row as Record<string, unknown>);
    if (session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return session;
  },
};
