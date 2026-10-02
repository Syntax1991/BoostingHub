import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { characterController } from "@/controllers/app.controller";
import type { characterService } from "@/services/character.service";
import type { managementController } from "@/controllers/app.controller";
import {
  additionalPlayableSpecLabels,
  formatCharacterPageSpecLine,
  formatCharacterRosterMetadata,
} from "@/lib/character-roster-metadata";
import { resolveSignupAssignableRoles } from "@/lib/signup-assignable-roles";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/characters/character-form-dialog", () => ({
  CharacterFormDialog: () => null,
}));

vi.mock("@/components/characters/character-lifecycle-button", () => ({
  CharacterLifecycleButton: () => null,
}));

vi.mock("@/components/characters/battle-net-panel", () => ({
  BattleNetPanel: () => null,
}));

vi.mock("@/components/characters/discord-booster-application-cta", () => ({
  DiscordBoosterApplicationCta: () => null,
}));

vi.mock("@/components/characters/character-availability-section", () => ({
  CharacterAvailabilitySection: () => null,
}));

vi.mock("@/components/characters/character-schedule-commitments-section", () => ({
  CharacterScheduleCommitmentsSection: () => null,
}));

vi.mock("@/components/characters/link-warcraft-logs-button", () => ({
  LinkWarcraftLogsButton: () => null,
}));

vi.mock("@/components/characters/find-missing-warcraft-logs-button", () => ({
  FindMissingWarcraftLogsButton: () => null,
}));

vi.mock("@/components/characters/weekly-availability-dialog", () => ({
  WeeklyAvailabilityDialog: ({ triggerLabel }: { triggerLabel: string }) =>
    createElement("button", { type: "button" }, triggerLabel),
}));

vi.mock("@/components/characters/delete-character-button", () => ({
  DeleteCharacterButton: () => null,
}));

vi.mock("@/components/manage/character-operations/character-sync-buttons", () => ({
  CharacterSyncButtons: () => null,
}));

vi.mock("@/components/manage/character-operations/force-refresh-all-button", () => ({
  ForceRefreshAllButton: () => null,
}));

vi.mock("@/components/manage/character-operations/reconcile-links-button", () => ({
  ReconcileLinksButton: () => null,
}));

import { CharactersView } from "@/components/characters/characters-view";
import { CharacterDetailsView } from "@/components/characters/character-details-view";
import { ManageCharactersView } from "@/components/manage/manage-characters-view";
import { ManageCharacterDetailView } from "@/components/manage/manage-character-detail-view";

type UserPage = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type CharacterRow = UserPage["characters"][number];
type Details = Awaited<ReturnType<typeof characterService.getCharacterDetails>>;
type AdminPage = Awaited<ReturnType<typeof managementController.getCharactersPage>>;
type AdminDetail = Awaited<ReturnType<typeof managementController.getCharacterOperationsPage>>;

function userPage(character: CharacterRow): UserPage {
  return {
    characters: [character],
    boostingRoles: { isBooster: false, isLootbuddy: false },
    discordTicketUrl: null,
    totalCharacters: 1,
    activeCharacters: 1,
    currentResetByRegion: { EU: "2026-W38", US: "2026-W38" },
    currentLockoutRaids: [],
    battleNet: {
      configured: false,
      connections: [],
      importSession: null,
      liveSessions: [],
      candidates: [],
      candidatesByRegion: {},
    },
    battleNetFlash: { status: null, region: null, code: null, importSessionId: null },
  } as unknown as UserPage;
}

function userCharacter(overrides: Partial<CharacterRow> & Pick<CharacterRow, "name" | "wowClass" | "specialization" | "primaryRole">): CharacterRow {
  return {
    id: "char-1",
    realm: "Antonidas",
    region: "EU",
    playableSpecs: [],
    itemLevel: 327,
    isActive: true,
    lastSyncedAt: null,
    blizzardSyncState: { kind: "AWAITING_FIRST_SYNC" },
    updatedAt: "2026-09-16T00:00:00.000Z",
    blizzardLinked: false,
    blizzardRealmId: null,
    warcraftLogsLinked: false,
    warcraftLogsId: null,
    boosterAccess: { status: "NONE", approved: false },
    currentReset: "2026-W38",
    lockouts: [],
    weeklyAvailability: {
      characterId: "char-1",
      status: "AVAILABLE",
      unavailableDifficulties: [],
      resetIdentifier: "2026-W38",
      region: "EU",
      resetWindowLabel: "EU",
    },
    ...overrides,
  } as CharacterRow;
}

function renderUserList(character: CharacterRow): string {
  return renderToStaticMarkup(createElement(CharactersView, { data: userPage(character) }));
}

function details(overrides: Partial<Details>): Details {
  return {
    id: "char-1",
    name: "Syndraco",
    realm: "Antonidas",
    region: "EU",
    wowClass: "EVOKER",
    specialization: "Preservation",
    primaryRole: "HEALER",
    playableSpecs: ["Augmentation", "Devastation"],
    itemLevel: 321,
    isActive: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    lastSyncedAt: null,
    blizzardSyncState: { kind: "AWAITING_FIRST_SYNC" },
    blizzardLinked: false,
    blizzardCharacterId: null,
    blizzardRealmId: null,
    warcraftLogsLinked: false,
    warcraftLogsId: null,
    ownerIsBooster: false,
    discordTicketUrl: null,
    currentReset: "2026-W38",
    currentLockoutRaids: [],
    lockouts: [],
    weeklyAvailability: {
      characterId: "char-1",
      status: "AVAILABLE",
      unavailableDifficulties: [],
      resetIdentifier: "2026-W38",
      region: "EU",
      resetWindowLabel: "EU · Wed 16/09/2026 → Wed 23/09/2026",
    },
    scheduleCommitments: [],
    ...overrides,
  } as Details;
}

function adminRow(overrides: {
  name: string;
  wowClass: AdminPage["rows"][number]["wowClass"];
  specialization: string | null;
  playableSpecs?: string[];
}): AdminPage["rows"][number] {
  return {
    id: "ops-1",
    name: overrides.name,
    realm: "Antonidas",
    region: "EU",
    wowClass: overrides.wowClass,
    specialization: overrides.specialization,
    playableSpecs: overrides.playableSpecs ?? [],
    itemLevel: 327,
    isActive: true,
    owner: { id: "owner-1", name: "Owner", discordUsername: null },
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    lastSyncErrorAt: null,
    lastSyncErrorCode: null,
    lastSyncErrorLabel: null,
    syncFailureCount: 0,
    retired: false,
    linkage: "NOT_LINKED",
    health: "NEVER_SYNCED",
    lockoutSlots: [],
    syncIneligibleReason: null,
    cooldownRemainingMs: 0,
    autoRetryAt: null,
    autoRetryInMs: 0,
    deleteBlockedReason: null,
  } as AdminPage["rows"][number];
}

function renderAdminList(row: AdminPage["rows"][number]): string {
  const page = {
    filters: { status: "all", sort: "character" },
    rows: [row],
    summary: {
      total: 1,
      active: 1,
      retired: 0,
      healthy: 0,
      stale: 0,
      errors: 0,
      neverSynced: 1,
      linked: 0,
      noConnection: 0,
      notLinked: 1,
    },
    bulkEligibleCount: 1,
    staleMinutes: 120,
  } as unknown as AdminPage;
  return renderToStaticMarkup(createElement(ManageCharactersView, { data: page }));
}

function renderAdminDetail(row: AdminPage["rows"][number]): string {
  const data = {
    row,
    deleteBlockedReason: null,
    identity: {
      primaryRole: "HEALER",
      blizzardCharacterId: null,
      blizzardRealmId: null,
      ownerHasRegionConnection: false,
    },
    currentReset: "2026-W38",
    weeklyAvailability: null,
    ownerBoostingRoles: { isBooster: false, isLootbuddy: false },
  } as unknown as AdminDetail;
  return renderToStaticMarkup(createElement(ManageCharacterDetailView, { data }));
}

describe("character offspec display", () => {
  it("1. user list hides the offspec label when none are configured", () => {
    const html = renderUserList(
      userCharacter({
        name: "Glesien",
        wowClass: "HUNTER",
        specialization: "Marksmanship",
        primaryRole: "RANGED_DPS",
        playableSpecs: [],
        itemLevel: 324,
      }),
    );
    expect(html).toContain("Marksmanship");
    expect(html).not.toMatch(/Offspec/);
  });

  it("2. user list shows one offspec", () => {
    const html = renderUserList(
      userCharacter({
        name: "Synblast",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        primaryRole: "HEALER",
        playableSpecs: ["Elemental"],
      }),
    );
    expect(html).toContain("Restoration · Offspec: Elemental");
  });

  it("3. user list uses Offspecs and catalog order", () => {
    const html = renderUserList(
      userCharacter({
        name: "Synvoid",
        wowClass: "PRIEST",
        specialization: "Holy",
        primaryRole: "HEALER",
        playableSpecs: ["Shadow", "Discipline"],
        itemLevel: 326,
      }),
    );
    expect(html).toContain("Holy · Offspecs: Discipline, Shadow");
  });

  it("4. character detail lists every additional spec in catalog order", () => {
    const html = renderToStaticMarkup(
      createElement(CharacterDetailsView, {
        data: details({
          playableSpecs: ["Augmentation", "Devastation"],
        }),
      }),
    );
    expect(html).toContain("Preservation");
    expect(html).toContain("Playable offspecs");
    expect(html).toContain("Devastation, Augmentation");
    expect(html).not.toContain("Augmentation, Devastation");
  });

  it("5. admin list shows playable specs without an edit control", () => {
    const html = renderAdminList(
      adminRow({
        name: "Synblast",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        playableSpecs: ["Elemental"],
      }),
    );
    expect(html).toContain("Synblast");
    expect(html).toContain("Restoration · Offspec: Elemental");
    expect(html).not.toContain("Edit");
  });

  it("6. admin detail shows the same configured offspecs", () => {
    const html = renderAdminDetail(
      adminRow({
        name: "Synvoid",
        wowClass: "PRIEST",
        specialization: "Holy",
        playableSpecs: ["Shadow", "Discipline"],
      }),
    );
    expect(html).toContain("Holy");
    expect(html).toContain("Playable offspecs");
    expect(html).toContain("Discipline, Shadow");
  });

  it("7. a playable row that repeats the primary spec is omitted", () => {
    const character = userCharacter({
      name: "Synblast",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      primaryRole: "HEALER",
      playableSpecs: ["Restoration", "Elemental"],
    });
    const list = renderUserList(character);
    expect(list).toContain("Restoration · Offspec: Elemental");
    expect(list).not.toContain("Offspecs:");
    const detail = renderToStaticMarkup(createElement(CharacterDetailsView, { data: details(character) }));
    expect(detail).toContain(">Elemental<");
    expect(detail).not.toContain("Restoration, Elemental");
  });

  it("8. character pages and roster cards order the same playable specs", () => {
    const input = {
      itemLevel: 321,
      specialization: "Preservation",
      primaryRole: "HEALER" as const,
      wowClass: "EVOKER" as const,
      playableSpecs: ["Augmentation", "Devastation"],
    };
    const page = formatCharacterPageSpecLine(input);
    const roster = formatCharacterRosterMetadata(input);
    expect(additionalPlayableSpecLabels(input)).toEqual(["Devastation", "Augmentation"]);
    expect(page).toBe("Preservation · Offspecs: Devastation, Augmentation");
    expect(roster).toBe("321 ilvl · Preservation · Offspecs: Devastation, Augmentation");
  });

  it("9. rendering offspecs does not change signup assignment", () => {
    const signup = {
      offeredRoles: ["HEALER", "RANGED_DPS"] as const,
      characterClass: "SHAMAN" as const,
      primarySpecialization: "Restoration",
      playableSpecs: ["Elemental", "Enhancement"],
    };
    const before = resolveSignupAssignableRoles(signup);
    const html = renderUserList(
      userCharacter({
        name: "Synblast",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        primaryRole: "HEALER",
        playableSpecs: ["Enhancement", "Elemental"],
      }),
    );
    expect(html).toContain("Restoration · Offspecs: Elemental, Enhancement");
    expect(resolveSignupAssignableRoles(signup)).toEqual(before);
    expect(before).toEqual(["HEALER", "RANGED_DPS"]);
    expect(signup.offeredRoles).toEqual(["HEALER", "RANGED_DPS"]);
  });

  it("10. roster metadata stays the deployed offspec line", () => {
    expect(
      formatCharacterRosterMetadata({
        itemLevel: 327,
        specialization: "Restoration",
        primaryRole: "HEALER",
        wowClass: "SHAMAN",
        playableSpecs: ["Elemental"],
      }),
    ).toBe("327 ilvl · Restoration · Offspec: Elemental");
  });
});
