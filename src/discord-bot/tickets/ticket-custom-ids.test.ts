import { describe, expect, it } from "vitest";
import { parseCustomId } from "@/discord-bot/custom-ids";
import {
  buildTicketActionCustomId,
  buildTicketModalCustomId,
  isTicketCustomId,
  parseTicketActionCustomId,
  parseTicketModalCustomId,
  TICKET_PANEL_SELECT_ID,
} from "@/discord-bot/tickets/ticket-custom-ids";
import { TICKET_ID } from "@/discord-bot/tickets/ticket-test-fixtures";

describe("ticket custom ids", () => {
  it("round-trips modal and action ids", () => {
    expect(parseTicketModalCustomId(buildTicketModalCustomId("REPORT_BOOSTER"))).toBe("REPORT_BOOSTER");
    expect(parseTicketActionCustomId(buildTicketActionCustomId("close-confirm", TICKET_ID))).toEqual({
      action: "close-confirm",
      ticketId: TICKET_ID,
    });
  });

  it("rejects forged or malformed ids", () => {
    for (const forged of [
      "bhticket:modal:ADMIN",
      "bhticket:modal:RAID_SUPPORT:extra",
      "bhticket:close:../../x",
      "bhticket:close:short",
      "bhticket:delete:aaaaaaaa-aaaa",
      `bhticket:close:${TICKET_ID}:200000000000000001`,
      `boostinghub:close:${TICKET_ID}`,
    ]) {
      expect(parseTicketActionCustomId(forged)).toBeNull();
      expect(parseTicketModalCustomId(forged)).toBeNull();
    }
    expect(() => buildTicketActionCustomId("close", "bad id")).toThrow();
  });

  it("uses its own namespace, disjoint from Run custom ids", () => {
    expect(isTicketCustomId(TICKET_PANEL_SELECT_ID)).toBe(true);
    expect(isTicketCustomId("boostinghub:signup:aaaaaaaa-1")).toBe(false);
    expect(parseCustomId(buildTicketActionCustomId("close", TICKET_ID))).toBeNull();
  });
});
