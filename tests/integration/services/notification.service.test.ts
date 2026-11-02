import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import type { NotificationType } from "@/models/enums";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { notificationService } from "@/services/notification.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";

const created = { userIds: [] as string[] };
let owner: AuthenticatedUser;
let other: AuthenticatedUser;

/** A web-only notification (no Discord delivery) for `userId`; returns its id. */
async function notify(userId: string, type: NotificationType, title: string) {
  const id = crypto.randomUUID();
  await userNotificationRepository.createIgnoreDuplicate({
    id,
    userId,
    type,
    runId: null,
    signupId: null,
    sourceKey: `test-web:${id}`,
    title,
    message: title,
    href: "/runs",
    discordDeliveryStatus: "SKIPPED",
    discordUserId: null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  const ownerId = await createTestUser({ name: "Notify Owner" });
  const otherId = await createTestUser({ name: "Notify Other" });
  created.userIds.push(ownerId, otherId);
  owner = testActor(ownerId);
  other = testActor(otherId);
});

// Notifications cascade with their User.
afterAll(() => deleteCreatedRows(created));

describe("notificationService web read/unread/ownership", () => {
  it("tracks unread count, markRead, markAllRead, and rejects foreign ids", async () => {
    const ownedA = await notify(owner.id, "ROSTER_SELECTED", "A");
    await notify(owner.id, "RAID_INVITE", "B");
    const foreign = await notify(other.id, "ROSTER_SELECTED", "Foreign");

    const bell = await notificationService.getBellData(owner);
    expect(bell.unreadCount).toBe(2);
    expect(bell.latest.some((row) => row.id === ownedA)).toBe(true);

    await notificationService.markRead(owner, ownedA);
    const afterOne = await notificationService.getBellData(owner);
    expect(afterOne.unreadCount).toBe(1);
    expect(afterOne.latest.find((row) => row.id === ownedA)?.readAt).toBeTruthy();

    await notificationService.markAllRead(owner);
    expect((await notificationService.getBellData(owner)).unreadCount).toBe(0);
    // Marking all read touches only the caller's own notifications.
    expect((await notificationService.getBellData(other)).unreadCount).toBe(1);

    await expectDomainError(notificationService.markRead(owner, foreign), "NOT_FOUND");
    await expectDomainError(notificationService.markRead(other, ownedA), "NOT_FOUND");
  });
});
