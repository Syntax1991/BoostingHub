import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { characterService } from "@/services/character.service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/characters/character-form-dialog", () => ({
  CharacterFormDialog: () => null,
}));

vi.mock("@/components/characters/character-lifecycle-button", () => ({
  CharacterLifecycleButton: () => null,
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

vi.mock("@/components/characters/weekly-availability-dialog", () => ({
  WeeklyAvailabilityDialog: ({ triggerLabel }: { triggerLabel: string }) =>
    createElement("button", { type: "button" }, triggerLabel),
}));

vi.mock("@/components/characters/link-warcraft-logs-button", () => ({
  LinkWarcraftLogsButton: ({ characterId }: { characterId: string }) =>
    createElement("button", { type: "button", "data-character-id": characterId }, "Find Warcraft Logs"),
}));

import { CharacterDetailsView } from "@/components/characters/character-details-view";

type Details = Awaited<ReturnType<typeof characterService.getCharacterDetails>>;

function baseDetails(overrides: Partial<Details> = {}): Details {
  return {
    id: "char-1",
    name: "Stormhowl",
    realm: "Twisting Nether",
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
    itemLevel: 640,
    isActive: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    lastSyncedAt: null,
    blizzardLinked: false,
    blizzardCharacterId: null,
    blizzardRealmId: null,
    warcraftLogsLinked: false,
    warcraftLogsId: null,
    boosterQualifications: [],
    accessPanel: {
      difficulties: [],
      discordTicketUrl: null,
      selfRequestDisabled: true,
    },
    currentReset: "2026-W38",
    currentLockoutRaids: [
      { id: "venomous", name: "The Venomous Abyss" },
      { id: "tidebound", name: "Tide" },
    ],
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
  };
}

describe("CharacterDetailsView Warcraft Logs action", () => {
  it("renders a safe new-tab Warcraft Logs link when an id is present", () => {
    const html = renderToStaticMarkup(
      createElement(CharacterDetailsView, {
        data: baseDetails({ warcraftLogsId: "55566677", warcraftLogsLinked: true }),
      }),
    );
    expect(html).toContain("https://www.warcraftlogs.com/character/id/55566677");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Warcraft Logs");
    expect(html).not.toContain("Find Warcraft Logs");
  });

  it("offers Find Warcraft Logs when warcraftLogsId is missing", () => {
    const html = renderToStaticMarkup(createElement(CharacterDetailsView, { data: baseDetails() }));
    expect(html).not.toContain("warcraftlogs.com");
    expect(html).toContain("Find Warcraft Logs");
  });
});
