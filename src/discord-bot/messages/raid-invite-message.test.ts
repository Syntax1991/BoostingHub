import { describe, expect, it } from "vitest";
import {
  buildRaidInviteMessage,
  formatRaidInviteAssignment,
  formatRaidInviteSchedule,
} from "@/discord-bot/messages/raid-invite-message";

describe("formatRaidInviteSchedule", () => {
  it("formats Europe/Berlin as DD/MM/YYYY HH:mm like Apex", () => {
    // 2026-09-16 13:30 UTC = 15:30 CEST
    expect(formatRaidInviteSchedule("2026-09-16T13:30:00.000Z")).toBe("16/09/2026 15:30");
  });
});

describe("formatRaidInviteAssignment", () => {
  it("matches Apex booster layout", () => {
    expect(
      formatRaidInviteAssignment({
        participationType: "BOOSTER",
        selectedRole: "HEALER",
        characterName: "Synmist",
        wowClass: "MONK",
        lootType: "VIP",
      }),
    ).toBe("Healer - Synmist (Monk) VIP");
  });

  it("formats lootbuddy with class", () => {
    expect(
      formatRaidInviteAssignment({
        participationType: "LOOTBUDDY",
        selectedRole: null,
        characterName: null,
        wowClass: "MONK",
        lootType: "VIP",
      }),
    ).toBe("Lootbuddy - (Monk) VIP");
  });
});

describe("buildRaidInviteMessage", () => {
  it("builds the full Apex-style DM body", () => {
    const text = buildRaidInviteMessage({
      productLabel: "Venom & Tide",
      scheduledStartAt: "2026-09-16T13:30:00.000Z",
      difficulty: "HEROIC",
      lootType: "VIP",
      participationType: "BOOSTER",
      selectedRole: "HEALER",
      characterName: "Synmist",
      wowClass: "MONK",
      guildName: "Phoenix Star",
      runChannelId: "1550000000000000001",
    });

    expect(text).toBe(
      [
        "📢 **Raid Invite**",
        "**Venom & Tide** - 16/09/2026 15:30 - HEROIC - vip",
        "Assignment: **Healer - Synmist (Monk) VIP**",
        "Channel: Phoenix Star · <#1550000000000000001>",
        "Please be online 10 minutes before start.",
      ].join("\n"),
    );
  });
});
