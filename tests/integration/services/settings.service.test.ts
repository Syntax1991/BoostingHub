import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import type { NotificationDmPreferences } from "@/repositories/settings.repository";
import { settingsService } from "@/services/settings.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";

/** Characters cascade with their owner. */
const created = { userIds: [] as string[] };
let owner: AuthenticatedUser;
let other: AuthenticatedUser;
let activeCharacterId = "";
let inactiveCharacterId = "";
let otherCharacterId = "";

const defaultQuietHours = { enabled: false, start: null, end: null } as const;

function notificationPrefs(overrides: Partial<NotificationDmPreferences> = {}): NotificationDmPreferences {
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

function monk(userId: string, name: string, isActive = true) {
  return createTestCharacter({
    userId,
    name,
    realm: "Antonidas",
    wowClass: "MONK",
    specialization: "Mistweaver",
    primaryRole: "HEALER",
    isActive,
  });
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  const otherId = await createTestUser({ name: "Settings Other" });
  created.userIds.push(otherId);
  other = testActor(otherId);
  otherCharacterId = await monk(otherId, "Other");
});

// A fresh owner per test: every test starts from the stored defaults.
beforeEach(async () => {
  const ownerId = await createTestUser({ name: "Settings Owner" });
  created.userIds.push(ownerId);
  owner = testActor(ownerId);
  activeCharacterId = await monk(ownerId, "Testmist");
  inactiveCharacterId = await monk(ownerId, "Sleepy", false);
});

afterAll(() => deleteCreatedRows(created));

describe("settingsService preferences v2", () => {
  it("defaults master DM and every event DM to enabled", async () => {
    const settings = await settingsService.getSettings(owner);
    expect(settings.notifications).toEqual(notificationPrefs());
  });

  it("defaults timezone to Europe/Berlin", async () => {
    const settings = await settingsService.getSettings(owner);
    expect(settings.regional.timeZone).toBe("Europe/Berlin");
  });

  it("turning master OFF preserves individual event fields", async () => {
    const masterOff = await settingsService.updateNotificationDmPreferences(
      owner,
      notificationPrefs({ discordDmEnabled: false, dmRaidInviteEnabled: false, dmRunRescheduledEnabled: false }),
    );
    expect(masterOff.notifications).toMatchObject({
      discordDmEnabled: false,
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: false,
      dmRunRescheduledEnabled: false,
    });

    const masterOn = await settingsService.updateNotificationDmPreferences(owner, {
      ...masterOff.notifications,
      discordDmEnabled: true,
    });
    expect(masterOn.notifications).toMatchObject({
      discordDmEnabled: true,
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: false,
      dmRunRescheduledEnabled: false,
    });
  });

  it("accepts a valid IANA timezone and rejects invalid ones", async () => {
    const ok = await settingsService.updateRegionalPreferences(owner, { timeZone: "America/New_York" });
    expect(ok.regional.timeZone).toBe("America/New_York");

    await expectDomainError(settingsService.updateRegionalPreferences(owner, { timeZone: "UTC+2" }), "VALIDATION_FAILED");
    expect((await settingsService.getSettings(owner)).regional.timeZone).toBe("America/New_York");
  });

  it("allows None, requires owned active Character for default", async () => {
    const set = await settingsService.updateGameplayPreferences(owner, { defaultCharacterId: activeCharacterId });
    expect(set.gameplay.defaultCharacterId).toBe(activeCharacterId);

    await expectDomainError(
      settingsService.updateGameplayPreferences(owner, { defaultCharacterId: inactiveCharacterId }),
      "CHARACTER_INACTIVE",
    );
    await expectDomainError(
      settingsService.updateGameplayPreferences(owner, { defaultCharacterId: otherCharacterId }),
      "CHARACTER_NOT_OWNED",
    );
    expect((await settingsService.getSettings(owner)).gameplay.defaultCharacterId).toBe(activeCharacterId);

    const none = await settingsService.updateGameplayPreferences(owner, { defaultCharacterId: null });
    expect(none.gameplay.defaultCharacterId).toBeNull();
  });

  it("validates Quiet Hours when enabled and preserves times when disabled", async () => {
    const enabled = await settingsService.updateNotificationDmPreferences(
      owner,
      notificationPrefs({ quietHours: { enabled: true, start: "22:00", end: "07:00" } }),
    );
    expect(enabled.notifications.quietHours).toEqual({ enabled: true, start: "22:00", end: "07:00" });

    await expectDomainError(
      settingsService.updateNotificationDmPreferences(
        owner,
        notificationPrefs({ quietHours: { enabled: true, start: "09:00", end: "09:00" } }),
      ),
      "VALIDATION_FAILED",
    );

    const disabled = await settingsService.updateNotificationDmPreferences(
      owner,
      notificationPrefs({ quietHours: { enabled: false, start: "22:00", end: "07:00" } }),
    );
    expect(disabled.notifications.quietHours).toEqual({ enabled: false, start: "22:00", end: "07:00" });
  });

  it("does not let another user change the owner's preferences via their own update", async () => {
    await settingsService.updateNotificationDmPreferences(
      other,
      notificationPrefs({
        discordDmEnabled: false,
        dmRosterSelectedEnabled: false,
        dmRaidInviteEnabled: false,
        dmRunCancelledEnabled: false,
        dmRunRescheduledEnabled: false,
        dmRosterRemovedEnabled: false,
      }),
    );

    expect((await settingsService.getSettings(owner)).notifications).toEqual(notificationPrefs());
    expect((await settingsService.getSettings(other)).notifications.discordDmEnabled).toBe(false);
  });
});
