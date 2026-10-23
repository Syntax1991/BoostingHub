import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";

const apiMocks = vi.hoisted(() => ({
  getClientCredentialsToken: vi.fn(),
  getCharacterProfileStatus: vi.fn(),
  getCharacterProfileSummary: vi.fn(),
  getCharacterRaidEncounters: vi.fn(),
}));
vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({ blizzardApiClient: apiMocks }));
vi.mock("@/integrations/raider-io/raider-io-api-client", () => ({
  raiderIoApiClient: { getCharacterEquippedItemLevel: async () => ({ status: "NOT_FOUND" as const }) },
}));
// Keep the post-sync Warcraft Logs enrichment offline.
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

import { PUT as notificationDeliveryPut } from "@/app/api/bot/notifications/[notificationId]/delivery/route";
import { characterRepository } from "@/repositories/character.repository";
import { characterBlizzardSyncService } from "@/services/character-blizzard-sync.service";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * One-time CHARACTER_BATTLENET_REPAIR notification (bell + Discord DM) when a
 * linked Character's sync fails because its Blizzard identity changed, and
 * its account-level DM lane (no Run).
 */
const TOKEN = "bot-api-test-token-repair-0123456789";
/** Discord ids are unique per User — one per test owner. */
const discordId = () => `9${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 1e8)}`;
const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

async function createUser(name: string, discordUserId: string | null): Promise<AuthenticatedUser> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@repair.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    discordUserId,
    createdAt: now,
    updatedAt: now,
  });
  createdUserIds.push(id);
  return {
    id,
    name,
    email: null,
    image: null,
    discordUserId,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
  };
}

let nextBlizzardId = 183112661;

async function createLinkedCharacter(owner: AuthenticatedUser, name: string) {
  const realm = "Draenor";
  const record = await characterRepository.create({
    id: crypto.randomUUID(),
    userId: owner.id,
    name,
    realm,
    region: "EU",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(realm),
    wowClass: "MONK",
    specialization: "Mistweaver",
    primaryRole: "HEALER",
    itemLevel: 640,
    isActive: true,
    blizzardCharacterId: String(nextBlizzardId++),
    blizzardRealmId: "506",
    lastSyncedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
  });
  createdCharacterIds.push(record.id);
  return record;
}

/** Blizzard now reports another character id under this name (the Sharaleen case). */
function mockIdentityConflict() {
  apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: "190292456", isValid: true });
  apiMocks.getCharacterProfileSummary.mockImplementation(async (_region: string, _slug: string, name: string) => ({
    id: "190292456",
    name,
    realmId: "506",
    realmSlug: "draenor",
    realmName: "Draenor",
    wowClass: "MONK",
    equippedItemLevel: 660,
    activeSpecialization: "Mistweaver",
  }));
}

function mockProfileUnavailable() {
  apiMocks.getCharacterProfileStatus.mockResolvedValue({ id: undefined, isValid: false });
}

async function failRefresh(owner: AuthenticatedUser, characterId: string) {
  await characterBlizzardSyncService.refreshCharacter(owner, characterId).catch(() => {});
  // Move the manual cooldown (started by every attempt) into the past.
  await orm.Character.where({ id: characterId }).update({
    lastSyncAttemptAt: new Date(Date.now() - 120_000).toISOString(),
  });
}

async function repairNotifications(userId: string) {
  return orm.UserNotification.where({ userId, type: "CHARACTER_BATTLENET_REPAIR" }).all();
}

function deliveryRequest(notificationId: string, result: string) {
  return notificationDeliveryPut(
    new NextRequest(new URL(`/api/bot/notifications/${notificationId}/delivery`, "http://bot-api.test"), {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ result }),
    }),
    { params: Promise.resolve({ notificationId }) },
  );
}

beforeAll(() => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
  vi.stubEnv("BOOSTINGHUB_BOT_API_TOKEN", TOKEN);
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getClientCredentialsToken.mockResolvedValue("client-token");
  apiMocks.getCharacterRaidEncounters.mockRejectedValue(new Error("encounters unavailable"));
});

afterAll(async () => {
  for (const userId of createdUserIds) {
    await orm.UserNotification.where({ userId }).delete();
  }
  for (const id of createdCharacterIds) {
    await orm.Character.where({ id }).delete();
  }
  for (const id of createdUserIds) {
    await orm.ActivityEvent.where({ userId: id }).delete();
    await orm.User.where({ id }).delete();
  }
  vi.unstubAllEnvs();
});

describe("CHARACTER_BATTLENET_REPAIR notification", () => {
  it("an identity conflict notifies the owner exactly once (bell + pending Discord DM), however often the sync fails", async () => {
    const ownerDiscordId = discordId();
    const owner = await createUser("Repair Owner", ownerDiscordId);
    const character = await createLinkedCharacter(owner, "Sharaleen");
    mockIdentityConflict();

    await failRefresh(owner, character.id);
    await failRefresh(owner, character.id);
    await failRefresh(owner, character.id);

    const failed = await characterRepository.findById(character.id);
    expect([failed?.lastSyncErrorCode, failed?.syncFailureCount]).toEqual(["IDENTITY_CONFLICT", 3]);
    const rows = await repairNotifications(owner.id);
    expect(rows).toHaveLength(1);
    const notification = rows[0]!;
    expect(String(notification.discordDeliveryStatus)).toBe("PENDING");
    expect(String(notification.discordUserId)).toBe(ownerDiscordId);
    expect(notification.runId ?? null).toBeNull();
    expect(String(notification.href)).toBe(`/characters/${character.id}`);
    expect(String(notification.message)).toContain("Sharaleen-Draenor (EU)");
    expect(String(notification.message)).toContain("No need to delete it.");
    expect(notification.visibleInApp).toBe(true);
  });

  it("a profile 404 notifies only once it repeats (a single 404 is usually Blizzard propagation lag)", async () => {
    const owner = await createUser("Repair Owner 404", discordId());
    const character = await createLinkedCharacter(owner, "Scalerry");
    mockProfileUnavailable();

    await failRefresh(owner, character.id);
    await failRefresh(owner, character.id);
    expect(await repairNotifications(owner.id)).toHaveLength(0);

    await failRefresh(owner, character.id);
    expect(await repairNotifications(owner.id)).toHaveLength(1);
  });

  it("without a Discord account the owner still gets the bell notification, but no DM", async () => {
    const owner = await createUser("Repair Owner No Discord", null);
    const character = await createLinkedCharacter(owner, "Nodiscord");
    mockIdentityConflict();

    await failRefresh(owner, character.id);

    const rows = await repairNotifications(owner.id);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.discordDeliveryStatus)).toBe("SKIPPED");
  });

  it("the bot gets it as an account DM, acks it per notification, and a repaired Character is never DMed", async () => {
    const ownerDiscordId = discordId();
    const owner = await createUser("Repair Owner Bot", ownerDiscordId);
    const sent = await createLinkedCharacter(owner, "Botdm");
    const repaired = await createLinkedCharacter(owner, "Botfixed");
    mockIdentityConflict();
    await failRefresh(owner, sent.id);
    await failRefresh(owner, repaired.id);
    const [sentRow] = (await repairNotifications(owner.id)).filter((row) => String(row.href).endsWith(sent.id));
    const [repairedRow] = (await repairNotifications(owner.id)).filter((row) => String(row.href).endsWith(repaired.id));

    const work = await discordSyncService.listSyncWork();
    expect(work.accountNotificationDms).toContainEqual({
      notificationId: String(sentRow!.id),
      type: "CHARACTER_BATTLENET_REPAIR",
      discordUserId: ownerDiscordId,
      characterLabel: "Botdm-Draenor (EU)",
      charactersUrl: expect.stringMatching(/\/characters$/),
    });
    expect(work.notificationDms.map((item) => item.notificationId)).not.toContain(String(sentRow!.id));
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(String(sentRow!.id))).toEqual({ deliver: true });

    // The owner reconnected before the DM went out (e.g. Quiet Hours): not deliverable, terminalized.
    await characterRepository.repairBlizzardIdentity(repaired.id, {
      name: repaired.name,
      realm: repaired.realm,
      normalizedName: repaired.normalizedName,
      normalizedRealm: repaired.normalizedRealm,
      blizzardCharacterId: "290292456",
      blizzardRealmId: "506",
    });
    expect(await discordSyncService.getNotificationDmDeliveryAuthority(String(repairedRow!.id))).toEqual({ deliver: false });
    const next = await discordSyncService.listSyncWork();
    expect(next.accountNotificationDms.map((item) => item.notificationId)).not.toContain(String(repairedRow!.id));
    const skipped = await orm.UserNotification.where({ id: String(repairedRow!.id) }).first();
    expect(String(skipped?.discordDeliveryStatus)).toBe("SKIPPED");

    // Ack through the notification-scoped bot route.
    const response = await deliveryRequest(String(sentRow!.id), "SENT");
    expect(response.status).toBe(200);
    const acked = await orm.UserNotification.where({ id: String(sentRow!.id) }).first();
    expect(String(acked?.discordDeliveryStatus)).toBe("SENT");
    expect((await deliveryRequest(String(sentRow!.id), "BOGUS")).status).toBe(400);
  });
});
