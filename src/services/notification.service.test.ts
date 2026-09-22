import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { notificationService } from "@/services/notification.service";

const ids = {
  owner: "n1111111-1111-4111-8111-111111111101",
  other: "n1111111-1111-4111-8111-111111111102",
};

function asUser(id: string, name: string): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@notify.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@notify.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanup() {
  for (const userId of Object.values(ids)) {
    const rows = await orm.UserNotification.where({ userId }).select("id").all();
    for (const row of rows) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // already gone
    }
  }
}

const owner = asUser(ids.owner, "Notify Owner");
const other = asUser(ids.other, "Notify Other");

beforeAll(async () => {
  await cleanup();
  await createTestUser(ids.owner, "Notify Owner");
  await createTestUser(ids.other, "Notify Other");
});

afterAll(async () => {
  await cleanup();
});

describe("notificationService web read/unread/ownership", () => {
  it("tracks unread count, markRead, markAllRead, and rejects foreign ids", async () => {
    const now = new Date().toISOString();
    const ownedA = crypto.randomUUID();
    const ownedB = crypto.randomUUID();
    const foreign = crypto.randomUUID();

    await userNotificationRepository.createIgnoreDuplicate({
      id: ownedA,
      userId: ids.owner,
      type: "ROSTER_SELECTED",
      runId: null,
      signupId: null,
      sourceKey: `test-web:${ownedA}`,
      title: "A",
      message: "first",
      href: "/runs",
      discordDeliveryStatus: "SKIPPED",
      discordUserId: null,
      createdAt: now,
    });
    await userNotificationRepository.createIgnoreDuplicate({
      id: ownedB,
      userId: ids.owner,
      type: "RAID_INVITE",
      runId: null,
      signupId: null,
      sourceKey: `test-web:${ownedB}`,
      title: "B",
      message: "second",
      href: "/runs",
      discordDeliveryStatus: "SKIPPED",
      discordUserId: null,
      createdAt: now,
    });
    await userNotificationRepository.createIgnoreDuplicate({
      id: foreign,
      userId: ids.other,
      type: "ROSTER_SELECTED",
      runId: null,
      signupId: null,
      sourceKey: `test-web:${foreign}`,
      title: "Foreign",
      message: "other",
      href: "/runs",
      discordDeliveryStatus: "SKIPPED",
      discordUserId: null,
      createdAt: now,
    });

    const bell = await notificationService.getBellData(owner);
    expect(bell.unreadCount).toBeGreaterThanOrEqual(2);
    expect(bell.latest.some((row) => row.id === ownedA)).toBe(true);

    await notificationService.markRead(owner, ownedA);
    const afterOne = await notificationService.getBellData(owner);
    expect(afterOne.latest.find((row) => row.id === ownedA)?.readAt).toBeTruthy();

    await notificationService.markAllRead(owner);
    const afterAll = await notificationService.getBellData(owner);
    expect(afterAll.unreadCount).toBe(0);

    await expectDomainCode(notificationService.markRead(owner, foreign), "NOT_FOUND");
    await expectDomainCode(notificationService.markRead(other, ownedA), "NOT_FOUND");
  });
});
