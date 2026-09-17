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

type BrowserLabel = "Chrome" | "Firefox" | "Edge" | "Safari" | null;
type PlatformLabel = "Windows" | "macOS" | "iPhone" | "iPad" | "Android" | null;

/**
 * Dependency-free UA → Profile label. Browser first, OS/device second.
 * Never claims a physical device model. Never returns the raw UA string.
 */
export function summarizeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent?.trim()) {
    return "Unknown device";
  }

  const ua = userAgent.trim();
  const browser = detectBrowser(ua);
  const platform = detectPlatform(ua);

  if (!browser || !platform) {
    return "Unknown device";
  }

  return `${browser} on ${platform}`;
}

function detectBrowser(ua: string): BrowserLabel {
  // Order matters: Edge embeds Chrome; Chrome on iOS uses CriOS; Safari also
  // appears in Chromium UAs.
  if (/Edg(?:e|A|iOS)?\//i.test(ua) || /EdgiOS\//i.test(ua)) {
    return "Edge";
  }
  if (/FxiOS\//i.test(ua) || /Firefox\//i.test(ua)) {
    return "Firefox";
  }
  if (/CriOS\//i.test(ua)) {
    return "Chrome";
  }
  if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua)) {
    return "Chrome";
  }
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) {
    return "Safari";
  }
  return null;
}

function detectPlatform(ua: string): PlatformLabel {
  if (/iPhone/i.test(ua)) {
    return "iPhone";
  }
  // iPadOS 13+ desktop mode reports Macintosh + Mobile.
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) {
    return "iPad";
  }
  if (/Android/i.test(ua)) {
    return "Android";
  }
  if (/Windows/i.test(ua)) {
    return "Windows";
  }
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return "macOS";
  }
  return null;
}
