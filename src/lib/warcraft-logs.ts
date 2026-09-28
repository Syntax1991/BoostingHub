/**
 * Outbound Warcraft Logs character profile URL from the stored character id.
 * Never derives from region/realm/name — `Character.warcraftLogsId` is the source of truth.
 */
export function getWarcraftLogsCharacterUrl(
  warcraftLogsId: string | null | undefined,
): string | null {
  if (typeof warcraftLogsId !== "string") {
    return null;
  }
  const id = warcraftLogsId.trim();
  if (!id) {
    return null;
  }
  return `https://www.warcraftlogs.com/character/id/${encodeURIComponent(id)}`;
}

/** Warcraft Logs report codes are 16 alphanumeric characters. */
export const WARCRAFT_LOGS_REPORT_CODE = /^[A-Za-z0-9]{16}$/;

/** Classic-family WCL sites log other game versions — never retail raids. */
const NON_RETAIL_SUBDOMAINS = new Set(["classic", "vanilla", "sod", "fresh"]);

/**
 * Accepts a bare report code or a retail Warcraft Logs report URL
 * (`https://www.warcraftlogs.com/reports/<code>#fight=…`). Returns null for
 * anything else — never guesses.
 */
export function parseWarcraftLogsReportCode(input: string): string | null {
  const value = input.trim();
  if (WARCRAFT_LOGS_REPORT_CODE.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "warcraftlogs.com" && !host.endsWith(".warcraftlogs.com")) return null;
  const subdomain = host === "warcraftlogs.com" ? "" : host.slice(0, -".warcraftlogs.com".length);
  if (NON_RETAIL_SUBDOMAINS.has(subdomain)) return null;

  const match = url.pathname.match(/^\/reports\/([A-Za-z0-9]+)\/?$/);
  const code = match?.[1] ?? null;
  return code && WARCRAFT_LOGS_REPORT_CODE.test(code) ? code : null;
}

const REPORT_URL_IN_TEXT = /https?:\/\/(?:[a-z0-9-]+\.)?warcraftlogs\.com\/reports\/[A-Za-z0-9]+[^\s)>\]]*/gi;

/**
 * Every retail Warcraft Logs report code linked in free text (a Discord
 * message or embed), in order of appearance, without duplicates. Each URL
 * goes through parseWarcraftLogsReportCode, so classic sites and look-alike
 * hosts are never returned.
 */
export function extractWarcraftLogsReportCodes(text: string): string[] {
  const codes: string[] = [];
  for (const match of text.matchAll(REPORT_URL_IN_TEXT)) {
    const code = parseWarcraftLogsReportCode(match[0]);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}
