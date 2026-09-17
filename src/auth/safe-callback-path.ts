const DEFAULT_CALLBACK = "/dashboard";

/**
 * Resolve a post-login return path that is safe for open-redirect resistance.
 *
 * Only same-origin relative paths are accepted. Absolute URLs, protocol-relative
 * URLs, backslash tricks, and credential-bearing forms are rejected.
 */
export function resolveSafeCallbackPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_CALLBACK,
): string {
  const safeFallback = isSafeInternalPath(fallback) ? fallback : DEFAULT_CALLBACK;
  if (candidate == null) {
    return safeFallback;
  }

  const trimmed = candidate.trim();
  if (!isSafeInternalPath(trimmed)) {
    return safeFallback;
  }

  try {
    const parsed = new URL(trimmed, "http://boostinghub.invalid");
    if (parsed.origin !== "http://boostinghub.invalid") {
      return safeFallback;
    }
    if (parsed.username || parsed.password) {
      return safeFallback;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return safeFallback;
  }
}

export function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith("/")) {
    return false;
  }
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return false;
  }
  if (value.includes("://") || value.includes("\\")) {
    return false;
  }
  if (value.includes("@")) {
    return false;
  }
  // Control characters and encoded nulls
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  return true;
}
