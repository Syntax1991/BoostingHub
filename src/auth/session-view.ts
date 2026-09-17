export type BetterAuthSessionRecord = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
};

/** Safe session projection for Profile UI — never includes the session token. */
export type PublicSessionView = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
};

export function toPublicSessionView(
  session: BetterAuthSessionRecord,
  currentSessionId: string | null,
): PublicSessionView {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
    isCurrent: currentSessionId != null && session.id === currentSessionId,
  };
}

export function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent?.trim()) {
    return "Unknown device";
  }
  const trimmed = userAgent.trim();
  if (trimmed.length <= 120) {
    return trimmed;
  }
  return `${trimmed.slice(0, 117)}…`;
}
