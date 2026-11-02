import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { resolveDiscordDelivery } from "@/domain/notification-content";
import type { NotificationDmPreferences } from "@/repositories/settings.repository";
import {
  userNotificationRepository,
  type CreateUserNotificationInput,
} from "@/repositories/user-notification.repository";
import { settingsService } from "@/services/settings.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows, syntheticDiscordId } from "@tests/fixtures/db-fixtures";

const DISCORD_ID = syntheticDiscordId();
const QUIET_HOURS = { enabled: true, start: "22:00", end: "07:00" } as const;
/** 22:30 Berlin (CET) on a March evening: inside Quiet Hours, which end at 07:00 local = 06:00 UTC. */
const INSIDE_QUIET_HOURS = new Date("2026-03-10T21:30:00.000Z");
const QUIET_HOURS_END = "2026-03-11T06:00:00.000Z";

/** Notifications cascade with their User. */
const created = { userIds: [] as string[] };
let user: AuthenticatedUser;

function allDmsOn(quietHours: NotificationDmPreferences["quietHours"]): NotificationDmPreferences {
  return {
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    quietHours,
  };
}

/** A pending Discord DM notification for the suite's user with a fresh id; returns the input it wrote. */
async function notify(partial: Partial<CreateUserNotificationInput> = {}) {
  const id = crypto.randomUUID();
  const input: CreateUserNotificationInput = {
    id,
    userId: user.id,
    type: "ROSTER_SELECTED",
    runId: null,
    signupId: null,
    sourceKey: `qh-${id}`,
    title: "t",
    message: "m",
    href: "/runs",
    discordDeliveryStatus: "PENDING",
    discordUserId: DISCORD_ID,
    discordDeliverAfter: null,
    ...partial,
  };
  const row = await userNotificationRepository.createIgnoreDuplicate(input);
  return { input, row };
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  const userId = await createTestUser({ name: "Quiet Hours User", discordUserId: DISCORD_ID });
  created.userIds.push(userId);
  user = testActor(userId, "USER", { discordUserId: DISCORD_ID });
});

afterAll(() => deleteCreatedRows(created));

describe("listPendingDiscordDmNotifications deliverAfter filter", () => {
  it("returns null/past/now and excludes future + terminal statuses", async () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
    const deliverable = [
      await notify({ discordDeliverAfter: null }),
      await notify({ discordDeliverAfter: minutesFromNow(-1) }),
      await notify({ discordDeliverAfter: now.toISOString() }),
    ];
    await notify({ discordDeliverAfter: minutesFromNow(1) });
    await notify({ discordDeliveryStatus: "SENT" });
    await notify({ discordDeliveryStatus: "SKIPPED", discordUserId: null });
    await notify({ discordDeliveryStatus: "FAILED_PERMANENT" });

    const pending = await userNotificationRepository.listPendingDiscordDmNotifications(50, now);
    const mine = pending.filter((row) => row.userId === user.id).map((row) => row.sourceKey).sort();
    expect(mine).toEqual(deliverable.map(({ input }) => input.sourceKey).sort());
    expect(pending.every((row) => row.discordDeliveryStatus === "PENDING")).toBe(true);
  });
});

describe("Quiet Hours snapshot non-retroactive", () => {
  it("keeps deliverAfter when Quiet Hours later disabled", async () => {
    await settingsService.updateNotificationDmPreferences(user, allDmsOn(QUIET_HOURS));

    const delivery = resolveDiscordDelivery({
      discordDmEnabled: true,
      eventDmEnabled: true,
      discordUserId: DISCORD_ID,
      quietHours: QUIET_HOURS,
      timeZone: "Europe/Berlin",
      now: INSIDE_QUIET_HOURS,
    });
    expect(delivery.discordDeliverAfter).toBe(QUIET_HOURS_END);

    const { row, input } = await notify({
      discordDeliveryStatus: delivery.status,
      discordUserId: delivery.discordUserId,
      discordDeliverAfter: delivery.discordDeliverAfter,
    });
    expect(row?.discordDeliverAfter).toBe(QUIET_HOURS_END);

    await settingsService.updateNotificationDmPreferences(user, allDmsOn({ ...QUIET_HOURS, enabled: false }));
    await settingsService.updateRegionalPreferences(user, { timeZone: "America/New_York" });

    expect((await userNotificationRepository.findById(input.id!))?.discordDeliverAfter).toBe(QUIET_HOURS_END);
  });

  it("keeps SKIPPED when master later enabled", async () => {
    const { row, input } = await notify({ discordDeliveryStatus: "SKIPPED", discordUserId: null });
    expect(row?.discordDeliveryStatus).toBe("SKIPPED");

    await settingsService.updateNotificationDmPreferences(user, allDmsOn({ ...QUIET_HOURS, enabled: false }));

    const again = await userNotificationRepository.findById(input.id!);
    expect(again?.discordDeliveryStatus).toBe("SKIPPED");
    expect(again?.discordDeliverAfter).toBeNull();
  });
});

describe("resolveDiscordDelivery with an event DM switched off", () => {
  it("is SKIPPED even inside Quiet Hours with the master switch on", () => {
    expect(
      resolveDiscordDelivery({
        discordDmEnabled: true,
        eventDmEnabled: false,
        discordUserId: DISCORD_ID,
        quietHours: QUIET_HOURS,
        timeZone: "Europe/Berlin",
        now: INSIDE_QUIET_HOURS,
      }),
    ).toEqual({ status: "SKIPPED", discordUserId: null, discordDeliverAfter: null });
  });
});
