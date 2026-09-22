import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { settingsService } from "@/services/settings.service";

const ids = {
  owner: "s1111111-1111-4111-8111-111111111101",
  other: "s1111111-1111-4111-8111-111111111102",
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
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanup() {
  for (const userId of Object.values(ids)) {
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // already gone
    }
  }
}

const owner = asUser(ids.owner, "Settings Owner");
const other = asUser(ids.other, "Settings Other");

beforeAll(async () => {
  await cleanup();
  await createTestUser(ids.owner, "Settings Owner");
  await createTestUser(ids.other, "Settings Other");
});

afterAll(async () => {
  await cleanup();
});

describe("settingsService notification preferences", () => {
  it("defaults both Discord DM prefs to enabled for existing users", async () => {
    const settings = await settingsService.getSettings(owner);
    expect(settings.notifications).toEqual({
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
    });
  });

  it("updates roster and raid invite prefs independently and persists them", async () => {
    const rosterOff = await settingsService.updateNotificationDmPreferences(owner, {
      dmRosterSelectedEnabled: false,
      dmRaidInviteEnabled: true,
    });
    expect(rosterOff.notifications).toEqual({
      dmRosterSelectedEnabled: false,
      dmRaidInviteEnabled: true,
    });

    const inviteOff = await settingsService.updateNotificationDmPreferences(owner, {
      dmRosterSelectedEnabled: false,
      dmRaidInviteEnabled: false,
    });
    expect(inviteOff.notifications).toEqual({
      dmRosterSelectedEnabled: false,
      dmRaidInviteEnabled: false,
    });

    const reloaded = await settingsService.getSettings(owner);
    expect(reloaded.notifications).toEqual({
      dmRosterSelectedEnabled: false,
      dmRaidInviteEnabled: false,
    });

    await settingsService.updateNotificationDmPreferences(owner, {
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
    });
  });

  it("does not let another user change the owner's preferences via their own update", async () => {
    await settingsService.updateNotificationDmPreferences(owner, {
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
    });
    await settingsService.updateNotificationDmPreferences(other, {
      dmRosterSelectedEnabled: false,
      dmRaidInviteEnabled: false,
    });

    const ownerSettings = await settingsService.getSettings(owner);
    const otherSettings = await settingsService.getSettings(other);
    expect(ownerSettings.notifications).toEqual({
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
    });
    expect(otherSettings.notifications).toEqual({
      dmRosterSelectedEnabled: false,
      dmRaidInviteEnabled: false,
    });
  });
});
