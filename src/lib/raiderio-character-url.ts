import type { WowRegion } from "@/models/enums";

const ACCEPTED_HOSTS = new Set(["raider.io", "www.raider.io"]);

const REGION_BY_PATH: Record<string, WowRegion> = {
  eu: "EU",
  us: "US",
};

export type ParsedRaiderIoCharacterUrl = {
  region: WowRegion;
  realmSlug: string;
  characterName: string;
};

export type ParseRaiderIoCharacterUrlFailure = {
  code:
    | "INVALID_URL"
    | "WRONG_HOST"
    | "WRONG_PATH"
    | "UNSUPPORTED_REGION"
    | "MALFORMED_ENCODING";
  message: string;
};

export type ParseRaiderIoCharacterUrlResult =
  | { ok: true; value: ParsedRaiderIoCharacterUrl }
  | { ok: false; error: ParseRaiderIoCharacterUrlFailure };

function fail(
  code: ParseRaiderIoCharacterUrlFailure["code"],
  message: string,
): ParseRaiderIoCharacterUrlResult {
  return { ok: false, error: { code, message } };
}

function decodePathSegment(raw: string): { ok: true; value: string } | { ok: false } {
  try {
    const decoded = decodeURIComponent(raw.replace(/\+/g, "%20")).normalize("NFKC").trim();
    if (!decoded) return { ok: false };
    return { ok: true, value: decoded };
  } catch {
    return { ok: false };
  }
}

/**
 * Pure Raider.IO Character profile URL parser.
 * Does not fetch, scrape, or call any Raider.IO API — identity coordinates only.
 */
export function parseRaiderIoCharacterUrl(value: string): ParseRaiderIoCharacterUrlResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return fail("INVALID_URL", "Enter a Raider.IO character profile link.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail("INVALID_URL", "Enter a Raider.IO character profile link.");
  }

  if (url.protocol !== "https:") {
    return fail("INVALID_URL", "Enter a Raider.IO character profile link.");
  }

  const host = url.hostname.toLowerCase();
  if (!ACCEPTED_HOSTS.has(host)) {
    return fail("WRONG_HOST", "Enter a raider.io character profile link.");
  }

  const segments = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  // Expected: characters / <region> / <realm-slug> / <character-name>
  if (segments.length !== 4 || segments[0]!.toLowerCase() !== "characters") {
    return fail("WRONG_PATH", "This is not a Raider.IO character profile link.");
  }

  const regionKey = segments[1]!.toLowerCase();
  const region = REGION_BY_PATH[regionKey];
  if (!region) {
    return fail(
      "UNSUPPORTED_REGION",
      "This Raider.IO character region is not supported by Manawyrm Hub.",
    );
  }

  const realmDecoded = decodePathSegment(segments[2]!);
  if (!realmDecoded.ok) {
    return fail("MALFORMED_ENCODING", "This Raider.IO character link could not be read.");
  }

  const nameDecoded = decodePathSegment(segments[3]!);
  if (!nameDecoded.ok) {
    return fail("MALFORMED_ENCODING", "This Raider.IO character link could not be read.");
  }

  // Blizzard Character Profile paths use lowercase realm slugs.
  const realmSlug = realmDecoded.value.toLocaleLowerCase("en-US");
  if (!realmSlug || realmSlug.includes("/")) {
    return fail("WRONG_PATH", "This is not a Raider.IO character profile link.");
  }

  return {
    ok: true,
    value: {
      region,
      realmSlug,
      characterName: nameDecoded.value,
    },
  };
}
