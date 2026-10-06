import { describe, expect, it } from "vitest";
import {
  deriveProviderHealth,
  isDomainNeutralHealthEvent,
  type ProviderHealthEvent,
} from "@/lib/system-health";

function events(...rows: Array<Pick<ProviderHealthEvent, "status" | "operation"> & { errorCode?: string | null }>): ProviderHealthEvent[] {
  return rows.map((row) => ({
    status: row.status,
    operation: row.operation,
    errorCode: row.errorCode ?? null,
  }));
}

describe("deriveProviderHealth — recovery-aware", () => {
  it("returns NOT_CONFIGURED when provider is not configured", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: false,
        recentEvents: events({ status: "SUCCESS", operation: "SCHEDULED_SYNC_PASS" }),
      }),
    ).toBe("NOT_CONFIGURED");
  });

  it("returns UNKNOWN when configured but no recent events", () => {
    expect(
      deriveProviderHealth({
        provider: "DISCORD",
        configured: true,
        recentEvents: [],
      }),
    ).toBe("UNKNOWN");
  });

  it("ERROR then SUCCESS recovers to HEALTHY", () => {
    expect(
      deriveProviderHealth({
        provider: "SYSTEM",
        configured: true,
        recentEvents: events(
          { status: "SUCCESS", operation: "ADMIN_ACTION" },
          { status: "ERROR", operation: "ADMIN_ACTION" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("WARNING then SUCCESS recovers to HEALTHY", () => {
    expect(
      deriveProviderHealth({
        provider: "SYSTEM",
        configured: true,
        recentEvents: events(
          { status: "SUCCESS", operation: "ADMIN_ACTION" },
          { status: "WARNING", operation: "ADMIN_ACTION" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("SUCCESS then ERROR becomes DOWN", () => {
    expect(
      deriveProviderHealth({
        provider: "SYSTEM",
        configured: true,
        recentEvents: events(
          { status: "ERROR", operation: "ADMIN_ACTION" },
          { status: "SUCCESS", operation: "ADMIN_ACTION" },
        ),
      }),
    ).toBe("DOWN");
  });

  it("newest WARNING is DEGRADED when no newer recovery exists", () => {
    expect(
      deriveProviderHealth({
        provider: "SYSTEM",
        configured: true,
        recentEvents: events(
          { status: "WARNING", operation: "ADMIN_ACTION" },
          { status: "SUCCESS", operation: "ADMIN_ACTION" },
        ),
      }),
    ).toBe("DEGRADED");
  });

  it("Discord SYNC_ONCE SUCCESS recovers past message WARNINGs", () => {
    expect(
      deriveProviderHealth({
        provider: "DISCORD",
        configured: true,
        recentEvents: events(
          { status: "SUCCESS", operation: "SYNC_ONCE" },
          { status: "WARNING", operation: "SIGNUP_MESSAGE" },
          { status: "ERROR", operation: "ROSTER_MESSAGE" },
        ),
      }),
    ).toBe("HEALTHY");
  });
});

describe("deriveProviderHealth — Blizzard SCHEDULED_SYNC_PASS authority", () => {
  it("older Character ERROR + newer clean SCHEDULED_SYNC_PASS => HEALTHY", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentEvents: events(
          { status: "SUCCESS", operation: "SCHEDULED_SYNC_PASS" },
          { status: "ERROR", operation: "CHARACTER_SUMMARY", errorCode: "HTTP_500" },
          { status: "ERROR", operation: "CHARACTER_SUMMARY", errorCode: "HTTP_500" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("latest partial scheduled pass => DEGRADED", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentEvents: events(
          { status: "WARNING", operation: "SCHEDULED_SYNC_PASS" },
          { status: "SUCCESS", operation: "SCHEDULED_SYNC_PASS" },
        ),
      }),
    ).toBe("DEGRADED");
  });

  it("latest hard scheduled provider failure => DOWN", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentEvents: events(
          { status: "ERROR", operation: "SCHEDULED_SYNC_PASS", errorCode: "AUTH_OR_CONFIG" },
          { status: "SUCCESS", operation: "SCHEDULED_SYNC_PASS" },
        ),
      }),
    ).toBe("DOWN");
  });

  it("Character-level historical error does not override recovered aggregate state", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentEvents: events(
          { status: "SUCCESS", operation: "SCHEDULED_SYNC_PASS" },
          { status: "ERROR", operation: "RAID_ENCOUNTERS", errorCode: "HTTP_503" },
          { status: "WARNING", operation: "CHARACTER_STATUS", errorCode: "HTTP_429" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("SCHEDULED_SYNC_PASS SUCCESS wins even when a newer Character ERROR is in the window", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentEvents: events(
          { status: "ERROR", operation: "CHARACTER_SUMMARY", errorCode: "HTTP_500" },
          { status: "SUCCESS", operation: "SCHEDULED_SYNC_PASS" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("falls back to newest non-domain signal when no scheduled pass exists", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentEvents: events(
          { status: "ERROR", operation: "CLIENT_CREDENTIALS", errorCode: "HTTP_401" },
          { status: "SUCCESS", operation: "CHARACTER_SUMMARY" },
        ),
      }),
    ).toBe("DOWN");
  });
});

describe("deriveProviderHealth — Warcraft Logs", () => {
  it("recovered failure after AUTO_AUDIT_PASS SUCCESS => HEALTHY", () => {
    expect(
      deriveProviderHealth({
        provider: "WARCRAFT_LOGS",
        configured: true,
        recentEvents: events(
          { status: "SUCCESS", operation: "AUTO_AUDIT_PASS" },
          { status: "ERROR", operation: "FETCH_REPORT", errorCode: "WCL_UNAVAILABLE" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("current upstream failure remains DOWN", () => {
    expect(
      deriveProviderHealth({
        provider: "WARCRAFT_LOGS",
        configured: true,
        recentEvents: events(
          { status: "ERROR", operation: "FETCH_REPORT", errorCode: "WCL_UNAVAILABLE" },
          { status: "SUCCESS", operation: "AUTO_AUDIT_PASS" },
        ),
      }),
    ).toBe("DOWN");
  });

  it("normal domain NOT_FOUND does not become provider outage", () => {
    expect(
      deriveProviderHealth({
        provider: "WARCRAFT_LOGS",
        configured: true,
        recentEvents: events(
          { status: "WARNING", operation: "FIND_CHARACTER", errorCode: "NOT_FOUND" },
          { status: "WARNING", operation: "FETCH_REPORT", errorCode: "NOT_FOUND" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("treats NOT_FOUND as domain-neutral", () => {
    expect(
      isDomainNeutralHealthEvent("WARCRAFT_LOGS", {
        status: "WARNING",
        operation: "FIND_CHARACTER",
        errorCode: "NOT_FOUND",
      }),
    ).toBe(true);
  });
});

describe("deriveProviderHealth — Raider.IO", () => {
  it("PARSE_URL signals alone stay HEALTHY (user input / parser, not outage)", () => {
    expect(
      deriveProviderHealth({
        provider: "RAIDER_IO",
        configured: true,
        recentEvents: events(
          { status: "WARNING", operation: "PARSE_URL", errorCode: "INVALID_URL" },
          { status: "SUCCESS", operation: "PARSE_URL", errorCode: "PARSE_SUCCESS" },
        ),
      }),
    ).toBe("HEALTHY");
  });

  it("API TEMPORARY_FAILURE is DEGRADED", () => {
    expect(
      deriveProviderHealth({
        provider: "RAIDER_IO",
        configured: true,
        recentEvents: events(
          { status: "WARNING", operation: "CHARACTER_EQUIPPED_ILVL", errorCode: "RAIDER_IO_UNAVAILABLE" },
          { status: "SUCCESS", operation: "PARSE_URL" },
        ),
      }),
    ).toBe("DEGRADED");
  });

  it("API SUCCESS after TEMPORARY_FAILURE recovers to HEALTHY", () => {
    expect(
      deriveProviderHealth({
        provider: "RAIDER_IO",
        configured: true,
        recentEvents: events(
          { status: "SUCCESS", operation: "CHARACTER_EQUIPPED_ILVL" },
          { status: "WARNING", operation: "CHARACTER_EQUIPPED_ILVL", errorCode: "RAIDER_IO_UNAVAILABLE" },
        ),
      }),
    ).toBe("HEALTHY");
  });
});
