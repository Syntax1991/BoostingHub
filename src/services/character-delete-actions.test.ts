import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: unknown }) =>
    createElement("a", { href, ...props }, children as never),
}));
vi.mock("@/components/characters/battle-net-panel", () => ({ BattleNetPanel: () => null }));
// Warcraft Logs auto-link enrichment runs after Character writes/syncs; keep it
// offline (a real WARCRAFT_LOGS_* in .env would otherwise hit the live API).
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

import { CharactersView } from "@/components/characters/characters-view";
import { ManageCharactersView } from "@/components/manage/manage-characters-view";
import { characterRepository } from "@/repositories/character.repository";
import {
  characterOperationsService,
  OWNER_CHARACTER_DELETE_PROTECTED_COPY,
} from "@/services/character-operations.service";
import { characterService } from "@/services/character.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";
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
const createdOwnerCharacterIds: string[] = [];

async function createUser(accountRole: AuthenticatedUser["accountRole"]) {
  const id = await createTestUser({ name: `Dela ${accountRole} ${token}`, accountRole });
  userIds.push(id);
  return testActor(id, accountRole);
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
  assertIsolatedTestDatabase();
  owner = await createUser("USER");
  admin = await createUser("ADMIN");
  // Only one OWNER may exist: reuse it when present (never deleted here), else create one.
  const existing = (await orm.User.where({ accountRole: "OWNER" }).select("id").first()) as { id: string } | null;
  platformOwner = existing ? testActor(existing.id, "OWNER") : await createUser("OWNER");
});

// The suite's own users take their Characters with them; a pre-existing Platform Owner keeps
// everything except the Characters created on it here.
afterAll(() => deleteCreatedRows({ characterIds: createdOwnerCharacterIds, userIds }));

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

    // Desktop unit + mobile card each mount a Delete confirmation dialog.
    for (const character of [first, second]) {
      expect(count(html, dialogTitle(character))).toBe(2);
    }
    expect(html).toContain("This permanently removes the Character from Manawyrm Hub");
    expect(html).toContain("Historical completed-run records are preserved.");
    expect(html).toContain("Characters with active run signups cannot be deleted.");
    // Desktop + mobile each mount confirm dialogs and overflow Delete triggers.
    expect(count(html, ">Delete permanently<")).toBe(4);
    expect(count(html, ">Cancel<")).toBeGreaterThanOrEqual(4);
    // Deactivate (retire) stays its own overflow action next to Delete (desktop + mobile).
    expect(count(html, ">Deactivate<")).toBe(4);
    expect(count(html, ">Delete<")).toBe(4);
  });

  it("the owner action can never target someone else's Character", async () => {
    const foreign = await createCharacter(admin);
    await expectDomainError(characterService.deleteCharacter(owner, foreign.id), "CHARACTER_NOT_OWNED");
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

    await expectDomainError(characterOperationsService.deleteCharacter(admin, ownerCharacter.id), "OWNER_ROLE_PROTECTED");
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
