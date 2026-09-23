import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import {
  userNotificationRepository,
  type CreateUserNotificationInput,
} from "@/repositories/user-notification.repository";
import { settingsService } from "@/services/settings.service";
import type { AuthenticatedUser } from "@/auth/authorization";
import { resolveDiscordDelivery } from "@/services/notification-content";

const ids = {
  user: "qh111111-1111-4111-8111-111111111101",
  noteFuture: "qh111111-1111-4111-8111-111111111201",
  notePast: "qh111111-1111-4111-8111-111111111202",
  noteNull: "qh111111-1111-4111-8111-111111111203",
  noteSent: "qh111111-1111-4111-8111-111111111204",
  noteSkipped: "qh111111-1111-4111-8111-111111111205",
  noteFailed: "qh111111-1111-4111-8111-111111111206",
  noteDeferredThenSettings: "qh111111-1111-4111-8111-111111111207",
};

function asUser(id: string): AuthenticatedUser {
  return {
    id,
    name: "Quiet Hours User",
    email: `${id}@qh.boostting.local`,
    image: null,
    discordUserId: "999001",
    discordUsername: "qhuser",
    accountRole: "USER",
    accountStatus: "ACTIVE",
  };
}

async function cleanup() {
  for (const id of Object.values(ids).filter((v) => v !== ids.user)) {
    try {
      await orm.UserNotification.where({ id }).delete();
    } catch {
      // gone
    }
  }
  try {
    const rows = await orm.UserNotification.where({ userId: ids.user }).select("id").all();
    for (const row of rows) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
  } catch {
    // gone
  }
  try {
    await orm.User.where({ id: ids.user }).delete();
  } catch {
    // gone
  }
}

async function createUser() {
  await orm.User.create({
    id: ids.user,
    name: "Quiet Hours User",
    email: `${ids.user}@qh.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    discordUserId: "999001",
    discordUsername: "qhuser",
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

function baseNote(
  partial: Partial<CreateUserNotificationInput> & { id: string; sourceKey: string },
): CreateUserNotificationInput {
  return {
    userId: ids.user,
    type: "ROSTER_SELECTED",
    runId: null,
    signupId: null,
    title: "t",
    message: "m",
    href: "/runs",
    discordDeliveryStatus: "PENDING",
    discordUserId: "999001",
    discordDeliverAfter: null,
    ...partial,
  };
}

beforeAll(async () => {
  await cleanup();
  await createUser();
});

afterAll(async () => {
  await cleanup();
});

describe("listPendingDiscordDelivery deliverAfter filter", () => {
  it("returns null/past/now and excludes future + terminal statuses", async () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: ids.noteNull,
        sourceKey: "qh-null",
        discordDeliverAfter: null,
        createdAt: "2026-06-15T11:00:00.000Z",
      }),
    );
    await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: ids.notePast,
        sourceKey: "qh-past",
        discordDeliverAfter: "2026-06-15T11:59:00.000Z",
        createdAt: "2026-06-15T11:01:00.000Z",
      }),
    );
    await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: ids.noteFuture,
        sourceKey: "qh-future",
        discordDeliverAfter: "2026-06-15T12:01:00.000Z",
        createdAt: "2026-06-15T11:02:00.000Z",
      }),
    );
    await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: ids.noteSent,
        sourceKey: "qh-sent",
        discordDeliveryStatus: "SENT",
        createdAt: "2026-06-15T11:03:00.000Z",
      }),
    );
    await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: ids.noteSkipped,
        sourceKey: "qh-skipped",
        discordDeliveryStatus: "SKIPPED",
        discordUserId: null,
        createdAt: "2026-06-15T11:04:00.000Z",
      }),
    );
    await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: ids.noteFailed,
        sourceKey: "qh-failed",
        discordDeliveryStatus: "FAILED_PERMANENT",
        createdAt: "2026-06-15T11:05:00.000Z",
      }),
    );

    // Exactly now
    await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: "qh111111-1111-4111-8111-111111111208",
        sourceKey: "qh-now",
        discordDeliverAfter: now.toISOString(),
        createdAt: "2026-06-15T11:06:00.000Z",
      }),
    );

    const pending = await userNotificationRepository.listPendingDiscordDelivery(50, now);
    const keys = pending
      .filter((row) => row.userId === ids.user && row.sourceKey.startsWith("qh-"))
      .map((row) => row.sourceKey)
      .sort();
    expect(keys).toEqual(["qh-now", "qh-null", "qh-past"].sort());
    expect(pending.every((row) => row.discordDeliveryStatus === "PENDING")).toBe(true);
  });
});

describe("Quiet Hours snapshot non-retroactive", () => {
  it("keeps deliverAfter when Quiet Hours later disabled", async () => {
    const actor = asUser(ids.user);
    await settingsService.updateNotificationDmPreferences(actor, {
      discordDmEnabled: true,
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
      dmRunCancelledEnabled: true,
      dmRunRescheduledEnabled: true,
      dmRosterRemovedEnabled: true,
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    });

    const delivery = resolveDiscordDelivery({
      discordDmEnabled: true,
      eventDmEnabled: true,
      discordUserId: "999001",
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
      timeZone: "Europe/Berlin",
      now: new Date("2026-03-10T21:30:00.000Z"),
    });
    expect(delivery.discordDeliverAfter).toBe("2026-03-11T06:00:00.000Z");

    const created = await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: ids.noteDeferredThenSettings,
        sourceKey: "qh-snapshot-defer",
        discordDeliveryStatus: delivery.status,
        discordUserId: delivery.discordUserId,
        discordDeliverAfter: delivery.discordDeliverAfter,
      }),
    );
    expect(created?.discordDeliverAfter).toBe("2026-03-11T06:00:00.000Z");

    await settingsService.updateNotificationDmPreferences(actor, {
      discordDmEnabled: true,
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
      dmRunCancelledEnabled: true,
      dmRunRescheduledEnabled: true,
      dmRosterRemovedEnabled: true,
      quietHours: { enabled: false, start: "22:00", end: "07:00" },
    });
    await settingsService.updateRegionalPreferences(actor, { timeZone: "America/New_York" });

    const again = await userNotificationRepository.findById(ids.noteDeferredThenSettings);
    expect(again?.discordDeliverAfter).toBe("2026-03-11T06:00:00.000Z");
  });

  it("keeps SKIPPED when master later enabled", async () => {
    const skipped = await userNotificationRepository.createIgnoreDuplicate(
      baseNote({
        id: "qh111111-1111-4111-8111-111111111209",
        sourceKey: "qh-snapshot-skipped",
        discordDeliveryStatus: "SKIPPED",
        discordUserId: null,
        discordDeliverAfter: null,
      }),
    );
    expect(skipped?.discordDeliveryStatus).toBe("SKIPPED");

    await settingsService.updateNotificationDmPreferences(asUser(ids.user), {
      discordDmEnabled: true,
      dmRosterSelectedEnabled: true,
      dmRaidInviteEnabled: true,
      dmRunCancelledEnabled: true,
      dmRunRescheduledEnabled: true,
      dmRosterRemovedEnabled: true,
      quietHours: { enabled: false, start: "22:00", end: "07:00" },
    });

    const again = await userNotificationRepository.findById("qh111111-1111-4111-8111-111111111209");
    expect(again?.discordDeliveryStatus).toBe("SKIPPED");
    expect(again?.discordDeliverAfter).toBeNull();
  });
});

describe("resolveDiscordDelivery covers all event toggles conceptually", () => {
  const eventKeys = [
    "dmRosterSelectedEnabled",
    "dmRaidInviteEnabled",
    "dmRunCancelledEnabled",
    "dmRunRescheduledEnabled",
    "dmRosterRemovedEnabled",
  ] as const;

  for (const key of eventKeys) {
    it(`${key} OFF → SKIPPED`, () => {
      expect(
        resolveDiscordDelivery({
          discordDmEnabled: true,
          eventDmEnabled: false,
          discordUserId: "1",
          quietHours: { enabled: true, start: "22:00", end: "07:00" },
          timeZone: "Europe/Berlin",
          now: new Date("2026-03-10T21:30:00.000Z"),
        }),
      ).toEqual({ status: "SKIPPED", discordUserId: null, discordDeliverAfter: null });
    });
  }
});
