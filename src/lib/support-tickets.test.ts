import { describe, expect, it } from "vitest";
import {
  buildSupportTicketChannelName,
  formatSupportTicketNumber,
  parseReportedBooster,
  SUPPORT_TICKET_TYPE_DEFINITIONS,
  supportTicketActiveKey,
} from "@/lib/support-tickets";
import { SUPPORT_TICKET_TYPES } from "@/models/enums";

describe("parseReportedBooster", () => {
  it("parses a Discord user mention", () => {
    expect(parseReportedBooster("<@123456789012345678>")).toEqual({
      reportedDiscordUserId: "123456789012345678",
      reportedBoosterLabel: "<@123456789012345678>",
    });
    expect(parseReportedBooster(" <@!123456789012345678> ").reportedDiscordUserId).toBe("123456789012345678");
  });

  it("parses a raw Discord user id", () => {
    expect(parseReportedBooster("123456789012345678").reportedDiscordUserId).toBe("123456789012345678");
  });

  it("never guesses an id from a name or partial text", () => {
    for (const raw of ["Titanpal-Blackhand", "syntax", "<@&123456789012345678>", "<#123456789012345678>", "12345", "user 123456789012345678"]) {
      const parsed = parseReportedBooster(raw);
      expect(parsed.reportedDiscordUserId).toBeNull();
      expect(parsed.reportedBoosterLabel).toBe(raw.trim());
    }
  });
});

describe("buildSupportTicketChannelName", () => {
  it("uses the ticket number and a sanitized creator label", () => {
    expect(buildSupportTicketChannelName(42, "Syntax")).toBe("ticket-0042-syntax");
    expect(buildSupportTicketChannelName(7, "Zoë Ünïté!!")).toBe("ticket-0007-zoe-unite");
    expect(buildSupportTicketChannelName(12345, "a")).toBe("ticket-12345-a");
  });

  it("falls back to the number when the label has no safe characters", () => {
    expect(buildSupportTicketChannelName(3, "🔥🔥")).toBe("ticket-0003");
  });

  it("stays within Discord's 100 character limit", () => {
    const name = buildSupportTicketChannelName(1, "x".repeat(300));
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toMatch(/^ticket-0001-x+$/);
  });
});

describe("support ticket definitions", () => {
  it("defines copy and a unicode emoji for every type", () => {
    for (const type of SUPPORT_TICKET_TYPES) {
      expect(SUPPORT_TICKET_TYPE_DEFINITIONS[type].label).toBeTruthy();
      expect(SUPPORT_TICKET_TYPE_DEFINITIONS[type].emoji).not.toMatch(/^<a?:/);
    }
    expect(SUPPORT_TICKET_TYPE_DEFINITIONS.MYTHIC_PLUS_SUPPORT.label).toBe("M+ Support");
  });

  it("formats numbers and active keys", () => {
    expect(formatSupportTicketNumber(42)).toBe("0042");
    expect(supportTicketActiveKey("1", "RAID_SUPPORT")).toBe("1:RAID_SUPPORT");
  });
});
