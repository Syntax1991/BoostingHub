import { describe, expect, it } from "vitest";
import { getWarcraftLogsCharacterUrl, extractWarcraftLogsReportCodes } from "@/lib/warcraft-logs";
import { trustedWarcraftLogsReportAuthorIds } from "@/lib/warcraft-logs/config";

describe("getWarcraftLogsCharacterUrl", () => {
  it("builds a deterministic URL for a valid id", () => {
    expect(getWarcraftLogsCharacterUrl("12345678")).toBe(
      "https://www.warcraftlogs.com/character/id/12345678",
    );
  });

  it("returns null for null or undefined", () => {
    expect(getWarcraftLogsCharacterUrl(null)).toBeNull();
    expect(getWarcraftLogsCharacterUrl(undefined)).toBeNull();
  });

  it("returns null for empty or whitespace-only values", () => {
    expect(getWarcraftLogsCharacterUrl("")).toBeNull();
    expect(getWarcraftLogsCharacterUrl("   ")).toBeNull();
  });

  it("URL-encodes the id defensively", () => {
    expect(getWarcraftLogsCharacterUrl("12/34?x=1")).toBe(
      "https://www.warcraftlogs.com/character/id/12%2F34%3Fx%3D1",
    );
  });

  it("trims surrounding whitespace before encoding", () => {
    expect(getWarcraftLogsCharacterUrl("  98765  ")).toBe(
      "https://www.warcraftlogs.com/character/id/98765",
    );
  });
});

describe("extractWarcraftLogsReportCodes", () => {
  it("finds retail report links in free text, deduplicated and in order", () => {
    expect(
      extractWarcraftLogsReportCodes(
        "Syntax_gg started a new report https://www.warcraftlogs.com/reports/FtwhWRvqjTbAx4NQ " +
          "(<https://de.warcraftlogs.com/reports/AbCdEfGhIjKlMnOp#fight=3>) and again " +
          "https://www.warcraftlogs.com/reports/FtwhWRvqjTbAx4NQ",
      ),
    ).toEqual(["FtwhWRvqjTbAx4NQ", "AbCdEfGhIjKlMnOp"]);
  });

  it("ignores classic sites, look-alike hosts and malformed codes", () => {
    expect(
      extractWarcraftLogsReportCodes(
        "https://classic.warcraftlogs.com/reports/FtwhWRvqjTbAx4NQ https://warcraftlogs.com.evil.example/reports/FtwhWRvqjTbAx4NQ https://www.warcraftlogs.com/reports/short",
      ),
    ).toEqual([]);
  });
});

describe("trustedWarcraftLogsReportAuthorIds", () => {
  it("parses comma/space separated snowflakes and drops anything else", () => {
    expect(
      trustedWarcraftLogsReportAuthorIds({ DISCORD_WCL_REPORT_AUTHOR_IDS: "111111111111111111, 222222222222222222 junk 111111111111111111" }),
    ).toEqual(["111111111111111111", "222222222222222222"]);
    expect(trustedWarcraftLogsReportAuthorIds({})).toEqual([]);
  });
});
