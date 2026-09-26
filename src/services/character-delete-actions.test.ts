import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: unknown }) =>
    createElement("a", { href, ...props }, children as never),
}));
vi.mock("@/components/characters/battle-net-panel", () => ({ BattleNetPanel: () => null }));

import { CharactersView } from "@/components/characters/characters-view";
import { ManageCharactersView } from "@/components/manage/manage-characters-view";
import { characterRepository } from "@/repositories/character.repository";
import {
  characterOperationsService,
  OWNER_CHARACTER_DELETE_PROTECTED_COPY,
} from "@/services/character-operations.service";
import { characterService } from "@/services/character.service";
import { parseCharacterOperationsFilters } from "@/validators/character-operations";

/**
 * Delete is reachable from the management LISTS (owner /characters and admin
 * /manage/characters, desktop + mobile), not only from detail pages — and the
 * list mirrors the Platform Owner protection while the server stays authoritative.
 */

const token = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 5).padEnd(5, "x");
const userIds: string[] = [];
let owner: AuthenticatedUser;
let admin: AuthenticatedUser;
let platformOwner: AuthenticatedUser;
let createdOwnerCharacterIds: string[] = [];

function asUser(id: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name: `Dela ${accountRole} ${token}`,
    email: `${id}@delete-actions.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(accountRole: AuthenticatedUser["accountRole"]) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name: `Dela ${accountRole} ${token}`,
    email: `${id}@delete-actions.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  userIds.push(id);
  return asUser(id, accountRole);
}

let nameCounter = 0;
async function createCharacter(user: AuthenticatedUser) {
  nameCounter += 1;
  const created = await characterService.createCharacter(user, {
    name: `Dela${token}${String.fromCharCode(96 + nameCounter)}`,
    realm: "Twisting Nether",
    region: "EU",
    wowClass: "MAGE",
    specialization: "Frost",
    itemLevel: 640,
  });
  if (user.id === platformOwner.id) createdOwnerCharacterIds.push(created.id);
  return created;
}

const dialogTitle = (character: { name: string; realm: string }) =>
  `Delete ${character.name}-${character.realm} permanently?`;
const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeAll(async () => {
  owner = await createUser("USER");
  admin = await createUser("ADMIN");
  // Only one OWNER may exist: reuse it when present (never deleted here), else create one.
  const existing = (await orm.User.where({ accountRole: "OWNER" }).select("id").first()) as { id: string } | null;
  platformOwner = existing ? asUser(existing.id, "OWNER") : await createUser("OWNER");
});

afterAll(async () => {
  for (const id of createdOwnerCharacterIds) await orm.Character.where({ id }).deleteAll();
  for (const userId of userIds) {
    await orm.Character.where({ userId }).deleteAll();
    await orm.ActivityEvent.where({ userId }).deleteAll();
    await orm.User.where({ id: userId }).delete();
  }
  createdOwnerCharacterIds = [];
});

describe("owner /characters list", () => {
  it("every owned row has a permanent Delete (confirmation wired), separate from Deactivate", async () => {
    const first = await createCharacter(owner);
    const second = await createCharacter(owner);
    const page = await characterService.getCharacterPage(owner);
    const data = {
      ...page,
      battleNet: { configured: false, connections: [], importSession: null, liveSessions: [], candidates: [], candidatesByRegion: {} },
      battleNetFlash: { status: null, region: null, code: null, importSessionId: null },
    } as unknown as Parameters<typeof CharactersView>[0]["data"];

    const html = renderToStaticMarkup(createElement(CharactersView, { data }));

    for (const character of [first, second]) {
      expect(count(html, dialogTitle(character))).toBe(1);
    }
    expect(html).toContain("This permanently removes the Character from BoostingHub");
    expect(html).toContain("Historical completed-run records and payout history are preserved.");
    expect(html).toContain("Characters with active run signups cannot be deleted.");
    expect(count(html, ">Delete permanently<")).toBe(2);
    expect(count(html, ">Cancel<")).toBeGreaterThanOrEqual(2);
    // Deactivate (retire) stays its own action next to Delete.
    expect(count(html, ">Deactivate<")).toBe(2);
    expect(count(html, ">Delete<")).toBe(2);
  });

  it("the owner action can never target someone else's Character", async () => {
    const foreign = await createCharacter(admin);
    const error = await characterService.deleteCharacter(owner, foreign.id).catch((caught) => caught);
    expect(isDomainError(error) && error.code).toBe("CHARACTER_NOT_OWNED");
    expect(await characterRepository.findById(foreign.id)).not.toBeNull();
  });
});

describe("admin /manage/characters list", () => {
  it("normal-user rows have Delete in the desktop table AND the mobile card; Platform Owner rows are protected for ADMIN", async () => {
    const userCharacter = await createCharacter(owner);
    const ownerCharacter = await createCharacter(platformOwner);
    const page = await characterOperationsService.getListPage(admin, parseCharacterOperationsFilters({ query: `Dela${token}` }));

    const byId = new Map(page.rows.map((row) => [row.id, row]));
    expect(byId.get(userCharacter.id)?.deleteBlockedReason).toBeNull();
    expect(byId.get(ownerCharacter.id)?.deleteBlockedReason).toBe(OWNER_CHARACTER_DELETE_PROTECTED_COPY);

    const html = renderToStaticMarkup(createElement(ManageCharactersView, { data: page }));
    // Desktop table + mobile card each render the row's actions.
    expect(count(html, dialogTitle(userCharacter))).toBe(2);
    expect(count(html, `href="/manage/characters/${userCharacter.id}"`)).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain(dialogTitle(ownerCharacter));
    expect(count(html, `title="${OWNER_CHARACTER_DELETE_PROTECTED_COPY}"`)).toBe(2);
    expect(html).toContain("Delete protected");
  });

  it("the Platform Owner sees Delete on their own row; a direct ADMIN call is still OWNER_ROLE_PROTECTED", async () => {
    const ownerCharacter = await createCharacter(platformOwner);
    const asOwner = await characterOperationsService.getListPage(platformOwner, parseCharacterOperationsFilters({ query: ownerCharacter.name }));
    expect(asOwner.rows.find((row) => row.id === ownerCharacter.id)?.deleteBlockedReason).toBeNull();

    const error = await characterOperationsService.deleteCharacter(admin, ownerCharacter.id).catch((caught) => caught);
    expect(isDomainError(error) && error.code).toBe("OWNER_ROLE_PROTECTED");
    expect(await characterRepository.findById(ownerCharacter.id)).not.toBeNull();
  });

  it("after an ADMIN delete the row is gone and the summary total drops; the owner id is returned for revalidation", async () => {
    const character = await createCharacter(owner);
    const filters = parseCharacterOperationsFilters({});
    const before = await characterOperationsService.getListPage(admin, filters);
    expect(before.rows.some((row) => row.id === character.id)).toBe(true);

    const result = await characterOperationsService.deleteCharacter(admin, character.id);

    expect(result.ownerId).toBe(owner.id);
    const after = await characterOperationsService.getListPage(admin, filters);
    expect(after.rows.some((row) => row.id === character.id)).toBe(false);
    expect(after.summary.total).toBe(before.summary.total - 1);
  });
});
