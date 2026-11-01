import { describe, expect, it } from "vitest";
import {
  buildRosterSelectedDmMessage,
  buildRosterWithdrawnDmMessage,
  rosterWithdrawnWebNotification,
} from "@/services/notification-content";

const BASE = {
  run: {
    runId: "r1",
    contentTitle: "Venom & Tide & Kith'ix",
    scheduledStartAt: "2026-09-25T20:15:00.000Z",
    difficulty: "HEROIC" as const,
    lootType: "VIP" as const,
  },
};

describe("roster withdrawal notification (to the Raid Lead)", () => {
  it("DM names the player, their character and reason, and links the roster", () => {
    const dm = buildRosterWithdrawnDmMessage({
      ...BASE,
      playerName: "Delta",
      characterLabel: "Kirilight-Thrall",
      reason: "Sick, sorry",
      rosterUrl: "https://app.example.test/runs/r1?tab=roster",
    });
    expect(dm).toContain("**Roster Withdrawal**");
    expect(dm).toContain("**Delta** (Kirilight-Thrall) withdrew from the roster.");
    expect(dm).toContain("Reason: Sick, sorry");
    expect(dm).toContain("[Pick a replacement](<https://app.example.test/runs/r1?tab=roster>)");
  });

  it("player-controlled text cannot mention anyone or break the markdown", () => {
    const dm = buildRosterWithdrawnDmMessage({
      ...BASE,
      playerName: "**Delta**",
      characterLabel: null,
      reason: "@everyone <@123> bye",
      rosterUrl: null,
    });
    expect(dm).not.toContain("<@123>");
    expect(dm).not.toMatch(/@everyone/);
    expect(dm).not.toContain("Pick a replacement");
    expect(dm).toContain(String.raw`**\*\*Delta\*\*** withdrew`);
  });

  it("web notification carries the reason and links the Roster tab", () => {
    const copy = rosterWithdrawnWebNotification({
      runId: "r1",
      runTitle: "Fri HC",
      playerName: "Delta",
      characterLabel: "Kirilight-Thrall",
      reason: "Sick",
    });
    expect(copy.title).toBe("Player withdrew");
    expect(copy.message).toBe("Delta (Kirilight-Thrall) withdrew from the roster for Fri HC. Reason: Sick");
    expect(copy.href).toBe("/runs/r1");
  });
});

describe("roster pick DM", () => {
  const assignment = {
    participationType: "BOOSTER" as const,
    publishedRole: "HEALER" as const,
    characterName: "Testbloom",
    characterRealm: null,
    wowClass: "DRUID" as const,
  };

  it("first pick says Roster Selected", () => {
    const dm = buildRosterSelectedDmMessage({ ...BASE, assignment, runChannelId: null });
    expect(dm).toContain("**Roster Selected**");
    expect(dm).toContain("You are in the roster.");
  });

  it("a character swap says Roster Update with the new assignment", () => {
    const dm = buildRosterSelectedDmMessage({ ...BASE, assignment, runChannelId: null, update: true });
    expect(dm).toContain("**Roster Update**");
    expect(dm).not.toContain("Roster Selected");
    expect(dm).toContain("Testbloom");
    expect(dm).toContain("you are still in the roster");
  });
});
