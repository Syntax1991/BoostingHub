import { describe, expect, it } from "vitest";
import {
  formatCommunityScheduleShare,
  formatScheduleShareRunDescription,
} from "@/lib/community-schedule-share";
import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID, isSelectableForRunSetup } from "@/lib/wow-raid-catalog";
import { MANAFORGE_OMEGA_RAID_ID } from "@/lib/wow-raid-catalog";

describe("isSelectableForRunSetup", () => {
  it("includes Tide and Venomous; excludes Manaforge", () => {
    expect(isSelectableForRunSetup(VENOMOUS_ABYSS_RAID_ID)).toBe(true);
    expect(isSelectableForRunSetup(TIDEBOUND_GROTTO_RAID_ID)).toBe(true);
    expect(isSelectableForRunSetup(MANAFORGE_OMEGA_RAID_ID)).toBe(false);
  });
});

describe("formatScheduleShareRunDescription", () => {
  it("formats planned/total difficulty loot canonically", () => {
    expect(
      formatScheduleShareRunDescription({
        plannedBossCount: 7,
        totalBossCount: 9,
        difficulty: "HEROIC",
        lootType: "VIP",
      }),
    ).toBe("7/9 HC VIP");
    expect(
      formatScheduleShareRunDescription({
        plannedBossCount: 1,
        totalBossCount: 1,
        difficulty: "HEROIC",
        lootType: "VIP",
      }),
    ).toBe("1/1 HC VIP");
  });
});

describe("formatCommunityScheduleShare", () => {
  it("matches the golden Management Discord fixture", () => {
    const leadA = "162111367837515777";
    const leadB = "797170803069550633";
    const role = "1502639997688221927";
    const result = formatCommunityScheduleShare({
      managementRoleId: role,
      slots: [
        {
          id: "wed",
          weekday: "WEDNESDAY",
          localStartTime: "22:30",
          runMode: "INHOUSE",
          runDescription: "7/9 HC VIP",
          raidLeadDiscordId: leadA,
          raidLeadName: "Lead A",
        },
        {
          id: "fri",
          weekday: "FRIDAY",
          localStartTime: "23:00",
          runMode: "TEAM_RUN",
          runDescription: "7/9 HC VIP",
          raidLeadDiscordId: leadB,
          raidLeadName: "Lead B",
        },
        {
          id: "sat",
          weekday: "SATURDAY",
          localStartTime: "23:00",
          runMode: "INHOUSE",
          runDescription: "7/9 HC VIP",
          raidLeadDiscordId: leadA,
          raidLeadName: "Lead A",
        },
        {
          id: "sun-early",
          weekday: "SUNDAY",
          localStartTime: "15:00",
          runMode: "INHOUSE",
          runDescription: "9/9 HC VIP",
          raidLeadDiscordId: leadA,
          raidLeadName: "Lead A",
        },
        {
          id: "sun-late",
          weekday: "SUNDAY",
          localStartTime: "22:30",
          runMode: "INHOUSE",
          runDescription: "7/9 HC VIP",
          raidLeadDiscordId: leadA,
          raidLeadName: "Lead A",
        },
        {
          id: "mon",
          weekday: "MONDAY",
          localStartTime: "22:30",
          runMode: "INHOUSE",
          runDescription: "7/9 HC VIP",
          raidLeadDiscordId: leadA,
          raidLeadName: "Lead A",
        },
        {
          id: "tue",
          weekday: "TUESDAY",
          localStartTime: "22:30",
          runMode: "INHOUSE",
          runDescription: "7/9 HC VIP",
          raidLeadDiscordId: leadA,
          raidLeadName: "Lead A",
        },
      ],
    });

    expect(result.text).toBe(
      [
        `<@&${role}>`,
        "",
        `Wednesday: 22:30 7/9 HC VIP <@${leadA}> inhouse`,
        `Friday: 23:00 7/9 HC VIP <@${leadB}> Teamrun`,
        `Saturday: 23:00 7/9 HC VIP <@${leadA}> inhouse`,
        `Sunday: 15:00 9/9 HC VIP <@${leadA}> inhouse & 22:30 7/9 HC VIP <@${leadA}> inhouse`,
        `Monday: 22:30 7/9 HC VIP <@${leadA}> inhouse`,
        `Tuesday: 22:30 7/9 HC VIP <@${leadA}> inhouse`,
        "",
        "Please check which recurring Runs we have at the moment. 🙂",
      ].join("\n"),
    );
    expect(result.warnings).toEqual([]);
  });

  it("omits empty weekdays, falls back to name, warns on missing role", () => {
    const result = formatCommunityScheduleShare({
      managementRoleId: null,
      slots: [
        {
          id: "a",
          weekday: "FRIDAY",
          localStartTime: "23:00",
          runMode: "INHOUSE",
          runDescription: "7/9 HC VIP",
          raidLeadDiscordId: null,
          raidLeadName: "Lead A",
        },
      ],
    });
    expect(result.text).toContain("Friday: 23:00 7/9 HC VIP Lead A inhouse");
    expect(result.text).not.toContain("<@&");
    expect(result.text).not.toContain("<@null>");
    expect(result.warnings.some((w) => w.includes("Management Discord role"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("no linked Discord"))).toBe(true);
  });
});
