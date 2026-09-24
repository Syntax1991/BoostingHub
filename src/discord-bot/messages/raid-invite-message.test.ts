import { describe, expect, it } from "vitest";
import {
  buildRaidInviteMessage,
  formatRaidInviteAssignment,
  formatRaidInviteSchedule,
} from "@/discord-bot/messages/raid-invite-message";

describe("formatRaidInviteSchedule", () => {
  it("formats Europe/Berlin as DD/MM/YYYY HH:mm", () => {
    // 2026-09-16 13:30 UTC = 15:30 CEST
    expect(formatRaidInviteSchedule("2026-09-16T13:30:00.000Z")).toBe("16/09/2026 15:30");
  });
});

describe("formatRaidInviteAssignment", () => {
  it("shows VIP once on VIP booster assignment", () => {
    expect(
      formatRaidInviteAssignment({
        participationType: "BOOSTER",
        selectedRole: "HEALER",
        characterName: "Synmist",
        wowClass: "MONK",
        lootType: "VIP",
      }),
    ).toBe("Healer · Synmist (Monk) · VIP");
  });

  it("omits VIP marker for non-VIP booster assignment", () => {
    expect(
      formatRaidInviteAssignment({
        participationType: "BOOSTER",
        selectedRole: "TANK",
        characterName: "Synblast",
        wowClass: "WARRIOR",
        lootType: "SAVED",
      }),
    ).toBe("Tank · Synblast (Warrior)");
    expect(
      formatRaidInviteAssignment({
        participationType: "BOOSTER",
        selectedRole: "DPS",
        characterName: "Synvoid",
        wowClass: "MAGE",
        lootType: "UNSAVED",
      }),
    ).not.toMatch(/VIP/i);
  });

  it("formats lootbuddy VIP with class", () => {
    expect(
      formatRaidInviteAssignment({
        participationType: "LOOTBUDDY",
        selectedRole: null,
        characterName: null,
        wowClass: "MONK",
        lootType: "VIP",
      }),
    ).toBe("Lootbuddy · (Monk) · VIP");
  });
});

describe("buildRaidInviteMessage", () => {
  it("renders a real Discord channel mention when runChannelId exists", () => {
    const text = buildRaidInviteMessage({
      productLabel: "Venom & Tide",
      scheduledStartAt: "2026-09-16T13:30:00.000Z",
      difficulty: "HEROIC",
      lootType: "VIP",
      participationType: "BOOSTER",
      selectedRole: "HEALER",
      characterName: "Synmist",
      wowClass: "MONK",
      runChannelId: "1550000000000000001",
      voiceChannelId: null,
    });

    expect(text).toContain("<t:1789565400:F> · HEROIC");
    expect(text).toContain("Assignment: Healer · Synmist (Monk) · VIP");
    expect(text).toContain("Channel: <#1550000000000000001>");
    expect(text).toContain("<#1550000000000000001>");
    expect(text).not.toMatch(/unknown/i);
    expect(text).not.toMatch(/ - vip/i);
    expect((text.match(/VIP/g) ?? []).length).toBe(1);
  });

  it("omits the Channel line when runChannelId is missing", () => {
    const text = buildRaidInviteMessage({
      productLabel: "Venom & Tide",
      scheduledStartAt: "2026-09-16T13:30:00.000Z",
      difficulty: "HEROIC",
      lootType: "VIP",
      participationType: "BOOSTER",
      selectedRole: "HEALER",
      characterName: "Synmist",
      wowClass: "MONK",
      runChannelId: null,
      voiceChannelId: null,
    });

    expect(text).not.toContain("Channel:");
    expect(text).not.toMatch(/unknown/i);
    expect(text).not.toContain("<#");
    expect(text).toContain("Please be online 10 minutes before start.");
  });

  it("omits Channel line for blank runChannelId and never invents #name", () => {
    const text = buildRaidInviteMessage({
      productLabel: "Raid",
      scheduledStartAt: "2026-09-16T13:30:00.000Z",
      difficulty: "NORMAL",
      lootType: "UNSAVED",
      participationType: "BOOSTER",
      selectedRole: "DPS",
      characterName: "Bob",
      wowClass: "HUNTER",
      runChannelId: "   ",
      voiceChannelId: "   ",
    });
    expect(text).not.toContain("Channel:");
    expect(text).not.toContain("Voice:");
    expect(text).not.toMatch(/#\s*unknown/i);
    expect(text).not.toMatch(/VIP/i);
  });

  describe("Channel / Voice lines", () => {
    const base = {
      productLabel: "Season 2 Bundle",
      scheduledStartAt: "2026-09-16T13:30:00.000Z",
      difficulty: "HEROIC" as const,
      lootType: "UNSAVED" as const,
      participationType: "BOOSTER" as const,
      selectedRole: "HEALER" as const,
      characterName: "Synlight",
      wowClass: "PRIEST" as const,
    };
    const head = ["📣 **Raid Invite**", "", "Season 2 Bundle", "<t:1789565400:F> · HEROIC", "", "Assignment: Healer · Synlight (Priest)"];
    const tail = ["", "Please be online 10 minutes before start."];

    it("text + voice: both lines, Channel before Voice", () => {
      expect(buildRaidInviteMessage({ ...base, runChannelId: "111", voiceChannelId: "222" })).toBe(
        [...head, "Channel: <#111>", "Voice: <#222>", ...tail].join("\n"),
      );
    });

    it("text only: no Voice line", () => {
      expect(buildRaidInviteMessage({ ...base, runChannelId: "111", voiceChannelId: null })).toBe(
        [...head, "Channel: <#111>", ...tail].join("\n"),
      );
    });

    it("voice only: no Channel line", () => {
      expect(buildRaidInviteMessage({ ...base, runChannelId: null, voiceChannelId: "222" })).toBe(
        [...head, "Voice: <#222>", ...tail].join("\n"),
      );
    });

    it("neither: no Channel or Voice line", () => {
      expect(buildRaidInviteMessage({ ...base, runChannelId: null, voiceChannelId: null })).toBe([...head, ...tail].join("\n"));
    });
  });
});
