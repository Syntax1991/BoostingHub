import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { settingsService } from "@/services/settings.service";

const ids = {
  owner: "s2111111-1111-4111-8111-111111111101",
  other: "s2111111-1111-4111-8111-111111111102",
  charActive: "s2111111-1111-4111-8111-111111111201",
  charInactive: "s2111111-1111-4111-8111-111111111202",
  charOther: "s2111111-1111-4111-8111-111111111203",
};

function asUser(id: string, name: string): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@settings.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(id: string, name: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@settings.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    discordDmQuietHoursEnabled: false,
    discordDmQuietHoursStart: null,
    discordDmQuietHoursEnd: null,
    timeZone: "Europe/Berlin",
    defaultCharacterId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function createCharacter(input: {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
}) {
  await orm.Character.create({
    id: input.id,
    userId: input.userId,
    name: input.name,
    realm: "Antonidas",
    region: "EU",
    normalizedName: input.name.toLowerCase(),
    normalizedRealm: "antonidas",
    wowClass: "MONK",
    specialization: "Mistweaver",
    primaryRole: "HEALER",
    itemLevel: 600,
    isActive: input.isActive,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanup() {
  for (const characterId of [ids.charActive, ids.charInactive, ids.charOther]) {
    try {
      await orm.Character.where({ id: characterId }).delete();
    } catch {
      // gone
    }
  }
  for (const userId of [ids.owner, ids.other]) {
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // gone
    }
  }
}

const owner = asUser(ids.owner, "Settings Owner");
const other = asUser(ids.other, "Settings Other");

const defaultQuietHours = { enabled: false, start: null, end: null } as const;

function baseNotificationPrefs(
  overrides: Partial<import("@/repositories/settings.repository").NotificationDmPreferences> = {},
) {
  return {
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    quietHours: defaultQuietHours,
    ...overrides,
  };
}

beforeAll(async () => {
  await cleanup();
  await createTestUser(ids.owner, "Settings Owner");
  await createTestUser(ids.other, "Settings Other");
  await createCharacter({ id: ids.charActive, userId: ids.owner, name: "Synmist", isActive: true });
  await createCharacter({ id: ids.charInactive, userId: ids.owner, name: "Sleepy", isActive: false });
  await createCharacter({ id: ids.charOther, userId: ids.other, name: "Other", isActive: true });
});

afterAll(async () => {
  await cleanup();
});

describe("settingsService preferences v2", () => {
  it("defaults master DM and every event DM to enabled", async () => {
    const settings = await settingsService.getSettings(owner);
    expect(settings.notifications).toEqual({
      discordDmEnabled: true,
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
      dmRunCancelledEnabled: true,
      dmRunRescheduledEnabled: true,
      dmRosterRemovedEnabled: true,
      quietHours: defaultQuietHours,
    });
  });

  it("defaults timezone to Europe/Berlin", async () => {
    const settings = await settingsService.getSettings(owner);
    expect(settings.regional.timeZone).toBe("Europe/Berlin");
  });

  it("turning master OFF preserves individual event fields", async () => {
    await settingsService.updateNotificationDmPreferences(
      owner,
      baseNotificationPrefs({
        dmRaidInviteEnabled: false,
        dmRunRescheduledEnabled: false,
      }),
    );

    const masterOff = await settingsService.updateNotificationDmPreferences(
      owner,
      baseNotificationPrefs({
        discordDmEnabled: false,
        dmRaidInviteEnabled: false,
        dmRunRescheduledEnabled: false,
      }),
    );
    expect(masterOff.notifications.discordDmEnabled).toBe(false);
    expect(masterOff.notifications.dmRosterSelectedEnabled).toBe(true);
    expect(masterOff.notifications.dmRaidInviteEnabled).toBe(false);
    expect(masterOff.notifications.dmRunRescheduledEnabled).toBe(false);

    const masterOn = await settingsService.updateNotificationDmPreferences(owner, {
      ...masterOff.notifications,
      discordDmEnabled: true,
    });
    expect(masterOn.notifications.discordDmEnabled).toBe(true);
    expect(masterOn.notifications.dmRosterSelectedEnabled).toBe(true);
    expect(masterOn.notifications.dmRaidInviteEnabled).toBe(false);
    expect(masterOn.notifications.dmRunRescheduledEnabled).toBe(false);
  });

  it("accepts a valid IANA timezone and rejects invalid ones", async () => {
    const ok = await settingsService.updateRegionalPreferences(owner, {
      timeZone: "America/New_York",
    });
    expect(ok.regional.timeZone).toBe("America/New_York");

    await expect(
      settingsService.updateRegionalPreferences(owner, { timeZone: "UTC+2" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" } satisfies Partial<DomainError>);

    await settingsService.updateRegionalPreferences(owner, { timeZone: "Europe/Berlin" });
  });

  it("allows None, requires owned active Character for default", async () => {
    const none = await settingsService.updateGameplayPreferences(owner, {
      defaultCharacterId: null,
    });
    expect(none.gameplay.defaultCharacterId).toBeNull();

    const set = await settingsService.updateGameplayPreferences(owner, {
      defaultCharacterId: ids.charActive,
    });
    expect(set.gameplay.defaultCharacterId).toBe(ids.charActive);

    await expect(
      settingsService.updateGameplayPreferences(owner, { defaultCharacterId: ids.charInactive }),
    ).rejects.toMatchObject({ code: "CHARACTER_INACTIVE" });

    await expect(
      settingsService.updateGameplayPreferences(owner, { defaultCharacterId: ids.charOther }),
    ).rejects.toMatchObject({ code: "CHARACTER_NOT_OWNED" });

    await settingsService.updateGameplayPreferences(owner, { defaultCharacterId: null });
  });

  it("validates Quiet Hours when enabled and preserves times when disabled", async () => {
    const enabled = await settingsService.updateNotificationDmPreferences(
      owner,
      baseNotificationPrefs({
        quietHours: { enabled: true, start: "22:00", end: "07:00" },
      }),
    );
    expect(enabled.notifications.quietHours).toEqual({
      enabled: true,
      start: "22:00",
      end: "07:00",
    });

    await expect(
      settingsService.updateNotificationDmPreferences(
        owner,
        baseNotificationPrefs({
          quietHours: { enabled: true, start: "09:00", end: "09:00" },
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" } satisfies Partial<DomainError>);

    const disabled = await settingsService.updateNotificationDmPreferences(
      owner,
      baseNotificationPrefs({
        quietHours: { enabled: false, start: "22:00", end: "07:00" },
      }),
    );
    expect(disabled.notifications.quietHours).toEqual({
      enabled: false,
      start: "22:00",
      end: "07:00",
    });
  });

  it("does not let another user change the owner's preferences via their own update", async () => {
    await settingsService.updateNotificationDmPreferences(owner, baseNotificationPrefs());
    await settingsService.updateNotificationDmPreferences(
      other,
      baseNotificationPrefs({
        discordDmEnabled: false,
        dmRosterSelectedEnabled: false,
        dmRaidInviteEnabled: false,
        dmRunCancelledEnabled: false,
        dmRunRescheduledEnabled: false,
        dmRosterRemovedEnabled: false,
      }),
    );

    const ownerSettings = await settingsService.getSettings(owner);
    const otherSettings = await settingsService.getSettings(other);
    expect(ownerSettings.notifications.discordDmEnabled).toBe(true);
    expect(otherSettings.notifications.discordDmEnabled).toBe(false);
  });
});
