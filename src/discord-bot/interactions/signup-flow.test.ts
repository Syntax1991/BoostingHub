import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import {
  buildCharacterSelectOptions,
  describeOfferResult,
  handleCharacterSelect,
  handleConfirmSignupButton,
  handleDiscardSignupButton,
  handleRoleSelect,
  handleSignupButton,
  type IneligibleCharacterOption,
} from "@/discord-bot/interactions/signup-flow";
import { clearAllSessionsForTests, getSession } from "@/discord-bot/interactions/signup-staging";

const mistweaver: { characterId: string; characterName: string; realm: string; roles: ("TANK" | "HEALER" | "DPS")[]; defaultRole: "HEALER" | null } = {
  characterId: "c-mist",
  characterName: "Synmist",
  realm: "Antonidas",
  roles: ["TANK", "HEALER", "DPS"],
  defaultRole: "HEALER",
};

describe("buildCharacterSelectOptions", () => {
  it("labels a fresh selection with its specialization-derived default role", () => {
    const options = buildCharacterSelectOptions([mistweaver], {
      characterIds: [],
      roleByCharacterId: {},
    }).map((option) => option.toJSON());

    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe("c-mist");
    expect(options[0]?.label).toBe("Synmist-Antonidas — Healer (default)");
  });

  it("labels an existing offer with its persisted role, not the specialization default, when they differ", () => {
    const options = buildCharacterSelectOptions([mistweaver], {
      characterIds: ["c-mist"],
      roleByCharacterId: { "c-mist": "TANK" },
    }).map((option) => option.toJSON());
    expect(options[0]?.label).toBe("Synmist-Antonidas — Tank");
  });

  it("preselects a Character with an active booster offer", () => {
    const options = buildCharacterSelectOptions([mistweaver], {
      characterIds: ["c-mist"],
      roleByCharacterId: { "c-mist": "HEALER" },
    }).map((option) => option.toJSON());
    expect(options[0]?.default).toBe(true);
  });

  it("shows no role suffix for a Character with neither an existing offer nor a specialization default", () => {
    const options = buildCharacterSelectOptions(
      [{ characterId: "c-1", characterName: "A", realm: "R", roles: ["DPS", "HEALER"] as ("TANK" | "HEALER" | "DPS")[], defaultRole: null }],
      { characterIds: [], roleByCharacterId: {} },
    ).map((option) => option.toJSON());
    expect(options[0]?.label).toBe("A-R");
  });
});

describe("describeOfferResult", () => {
  it("reports the cleared offers when submitting an empty set", () => {
    expect(describeOfferResult({ created: 0, reactivated: 0, withdrawn: 2, kept: 0 }, 0)).toBe(
      "Your offers for this run were cleared.",
    );
  });

  it("reports the active offer count otherwise", () => {
    expect(describeOfferResult({ created: 1, reactivated: 0, withdrawn: 0, kept: 1 }, 2)).toBe(
      "Signed up with 2 characters offered.",
    );
  });
});

const RUN_ID = "r7777777-7777-4777-8777-777777777777";
const SYNMIST = "c1111111-1111-4111-8111-111111111111"; // hybrid Monk
const FROSTBOLT = "c2222222-2222-4222-8222-222222222222"; // single-role Mage

function signupOptionsPayload(overrides: {
  roleByCharacterId?: Record<string, string>;
  activeCharacterIds?: string[];
  synmistDefaultRole?: "TANK" | "HEALER" | "DPS" | null;
} = {}) {
  return {
    run: {
      title: "Test Run",
      signupWindowOpen: true,
      difficulty: "HEROIC",
      totalBossCount: 8,
      lootType: "UNSAVED",
    },
    booster: {
      eligible: [
        {
          characterId: SYNMIST,
          characterName: "Synmist",
          realm: "Antonidas",
          roles: ["TANK", "HEALER", "DPS"],
          defaultRole: overrides.synmistDefaultRole === undefined ? "HEALER" : overrides.synmistDefaultRole,
        },
        {
          characterId: FROSTBOLT,
          characterName: "Frostbolt",
          realm: "Antonidas",
          roles: ["DPS"],
          defaultRole: "DPS",
        },
      ],
      ineligible: [] as IneligibleCharacterOption[],
    },
    activeBoosterOffers: {
      characterIds: overrides.activeCharacterIds ?? [],
      roleByCharacterId: overrides.roleByCharacterId ?? {},
    },
    activeLootbuddies: [],
  };
}

function fakeApi(input: { getSignupOptions?: unknown; setCharacterOffers?: unknown }): BotApiClient {
  return {
    getSignupOptions: input.getSignupOptions ?? vi.fn(),
    setCharacterOffers: input.setCharacterOffers ?? vi.fn(),
  } as unknown as BotApiClient;
}

type FakeInteraction = {
  user: { id: string };
  values: string[];
  deferUpdate: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
};

function fakeInteraction(userId: string, values: string[] = []): FakeInteraction {
  return {
    user: { id: userId },
    values,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

// Test doubles satisfy only the subset of discord.js interaction properties
// each handler actually reads; the real handlers are typed against the full
// discord.js interaction classes, so calls below go through `unknown` casts.
const characterSelect = handleCharacterSelect as unknown as (
  interaction: FakeInteraction,
  api: BotApiClient,
  runId: string,
) => Promise<void>;
const roleSelect = handleRoleSelect as unknown as (
  interaction: FakeInteraction,
  api: BotApiClient,
  runId: string,
  characterId: string,
) => Promise<void>;
const confirmSignup = handleConfirmSignupButton as unknown as (
  interaction: FakeInteraction,
  api: BotApiClient,
  runId: string,
) => Promise<void>;
const discardSignup = handleDiscardSignupButton as unknown as (
  interaction: FakeInteraction,
  runId: string,
) => Promise<void>;

describe("BOOSTER staging flow (character select -> role select -> confirm/cancel)", () => {
  beforeEach(() => {
    clearAllSessionsForTests();
  });

  it("selecting characters stages a session and does NOT call setCharacterOffers", async () => {
    const setCharacterOffers = vi.fn();
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()), setCharacterOffers });
    const interaction = fakeInteraction("user-a", [SYNMIST, FROSTBOLT]);

    await characterSelect(interaction, api, RUN_ID);

    expect(setCharacterOffers).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("new Character selection seeds the specialization-derived default, never the first class role", async () => {
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()) });
    const interaction = fakeInteraction("user-a", [SYNMIST]);

    await characterSelect(interaction, api, RUN_ID);

    const session = getSession("user-a", RUN_ID)!;
    // Synmist's class-order first role is TANK (Brewmaster listed first); the
    // seeded role must be its specialization default (HEALER), never that.
    expect(session.offers.get(SYNMIST)).toBe("HEALER");
  });

  it("existing signup preselects each Character's persisted role, which wins over the specialization default", async () => {
    const api = fakeApi({
      getSignupOptions: vi.fn().mockResolvedValue(
        signupOptionsPayload({ activeCharacterIds: [SYNMIST], roleByCharacterId: { [SYNMIST]: "TANK" } }),
      ),
    });
    const interaction = fakeInteraction("user-a", [SYNMIST]);

    await characterSelect(interaction, api, RUN_ID);

    const session = getSession("user-a", RUN_ID)!;
    expect(session.offers.get(SYNMIST)).toBe("TANK");
    expect(session.isExistingSignup).toBe(true);
  });

  it("a single-role Character resolves its fixed role even without a valid specialization — never left unresolved", async () => {
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()) });
    const interaction = fakeInteraction("user-a", [FROSTBOLT]);

    await characterSelect(interaction, api, RUN_ID);

    expect(getSession("user-a", RUN_ID)!.offers.get(FROSTBOLT)).toBe("DPS");
  });

  it("a hybrid Character with no specialization default stays unresolved — never guessed from class order", async () => {
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload({ synmistDefaultRole: null })) });
    const interaction = fakeInteraction("user-a", [SYNMIST]);

    await characterSelect(interaction, api, RUN_ID);

    expect(getSession("user-a", RUN_ID)!.offers.get(SYNMIST)).toBeNull();
  });

  it("changing a staged role does NOT call setCharacterOffers", async () => {
    const setCharacterOffers = vi.fn();
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()), setCharacterOffers });
    await characterSelect(fakeInteraction("user-a", [SYNMIST]), api, RUN_ID);

    const roleInteraction = fakeInteraction("user-a", ["TANK"]);
    await roleSelect(roleInteraction, api, RUN_ID, SYNMIST);

    expect(setCharacterOffers).not.toHaveBeenCalled();
    expect(getSession("user-a", RUN_ID)!.offers.get(SYNMIST)).toBe("TANK");
  });

  it("Confirm persists the full staged set exactly once, with each Character's own role", async () => {
    const setCharacterOffers = vi.fn().mockResolvedValue({ created: 2, reactivated: 0, withdrawn: 0, kept: 0 });
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()), setCharacterOffers });
    await characterSelect(fakeInteraction("user-a", [SYNMIST, FROSTBOLT]), api, RUN_ID);
    await roleSelect(fakeInteraction("user-a", ["TANK"]), api, RUN_ID, SYNMIST);

    const confirmInteraction = fakeInteraction("user-a");
    await confirmSignup(confirmInteraction, api, RUN_ID);

    expect(setCharacterOffers).toHaveBeenCalledTimes(1);
    const [, , body] = setCharacterOffers.mock.calls[0];
    expect(body.offers).toEqual(
      expect.arrayContaining([
        { characterId: SYNMIST, role: "TANK" },
        { characterId: FROSTBOLT, role: "DPS" },
      ]),
    );
    expect(body.offers).toHaveLength(2);
    // Confirming ends the session — it is no longer editable.
    expect(getSession("user-a", RUN_ID)).toBeUndefined();
  });

  it("no offered Character can appear twice in the Confirm payload", async () => {
    const setCharacterOffers = vi.fn().mockResolvedValue({ created: 1, reactivated: 0, withdrawn: 0, kept: 0 });
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()), setCharacterOffers });
    await characterSelect(fakeInteraction("user-a", [SYNMIST]), api, RUN_ID);
    await roleSelect(fakeInteraction("user-a", ["TANK"]), api, RUN_ID, SYNMIST);
    await roleSelect(fakeInteraction("user-a", ["HEALER"]), api, RUN_ID, SYNMIST);

    await confirmSignup(fakeInteraction("user-a"), api, RUN_ID);

    const [, , body] = setCharacterOffers.mock.calls[0];
    const characterIds = body.offers.map((offer: { characterId: string }) => offer.characterId);
    expect(new Set(characterIds).size).toBe(characterIds.length);
    expect(body.offers).toEqual([{ characterId: SYNMIST, role: "HEALER" }]);
  });

  it("Cancel discards the session and never calls setCharacterOffers", async () => {
    const setCharacterOffers = vi.fn();
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()), setCharacterOffers });
    await characterSelect(fakeInteraction("user-a", [SYNMIST]), api, RUN_ID);
    await roleSelect(fakeInteraction("user-a", ["TANK"]), api, RUN_ID, SYNMIST);

    const cancelInteraction = fakeInteraction("user-a");
    await discardSignup(cancelInteraction, RUN_ID);

    expect(setCharacterOffers).not.toHaveBeenCalled();
    expect(getSession("user-a", RUN_ID)).toBeUndefined();
    expect(cancelInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Signup changes cancelled." }),
    );
  });

  it("a stale/expired session returns an explicit message instead of silently failing", async () => {
    const setCharacterOffers = vi.fn();
    const api = fakeApi({ setCharacterOffers });

    const roleInteraction = fakeInteraction("user-a", ["TANK"]);
    await roleSelect(roleInteraction, api, RUN_ID, SYNMIST);
    expect(roleInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("expired") }),
    );

    const confirmInteraction = fakeInteraction("user-a");
    await confirmSignup(confirmInteraction, api, RUN_ID);
    expect(confirmInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("expired") }),
    );

    expect(setCharacterOffers).not.toHaveBeenCalled();
  });

  it("User B cannot read or mutate User A's staged session", async () => {
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()) });
    await characterSelect(fakeInteraction("user-a", [SYNMIST]), api, RUN_ID);

    const userBRoleSelect = fakeInteraction("user-b", ["TANK"]);
    await roleSelect(userBRoleSelect, api, RUN_ID, SYNMIST);

    expect(userBRoleSelect.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("expired") }),
    );
    // User A's own session is completely unaffected by User B's attempt.
    expect(getSession("user-a", RUN_ID)!.offers.get(SYNMIST)).toBe("HEALER");
  });

  it("a failed Confirm keeps the staged session so the User can retry, and mutates nothing", async () => {
    const setCharacterOffers = vi.fn().mockRejectedValue(new Error("boom"));
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload()), setCharacterOffers });
    await characterSelect(fakeInteraction("user-a", [SYNMIST]), api, RUN_ID);

    const confirmInteraction = fakeInteraction("user-a");
    await confirmSignup(confirmInteraction, api, RUN_ID);

    expect(setCharacterOffers).toHaveBeenCalledTimes(1);
    // The session survives the failure — nothing was silently discarded.
    expect(getSession("user-a", RUN_ID)).not.toBeUndefined();
    expect(confirmInteraction.editReply).toHaveBeenCalled();
  });

  it("Confirm blocks and re-renders when a Character's role is still unresolved, without calling the API", async () => {
    const setCharacterOffers = vi.fn();
    const api = fakeApi({
      getSignupOptions: vi.fn().mockResolvedValue(signupOptionsPayload({ synmistDefaultRole: null })),
      setCharacterOffers,
    });
    await characterSelect(fakeInteraction("user-a", [SYNMIST]), api, RUN_ID);

    const confirmInteraction = fakeInteraction("user-a");
    await confirmSignup(confirmInteraction, api, RUN_ID);

    expect(setCharacterOffers).not.toHaveBeenCalled();
    expect(getSession("user-a", RUN_ID)).not.toBeUndefined();
    expect(confirmInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Choose a role") }),
    );
  });
});

const signupButton = handleSignupButton as unknown as (
  interaction: FakeInteraction,
  api: BotApiClient,
  runId: string,
) => Promise<void>;

describe("cross-Run reservation conflicts in the Discord signup flow", () => {
  it("excludes a reservation-blocked character from the select menu but lists it as unavailable", async () => {
    const payload = signupOptionsPayload();
    payload.booster.eligible = [payload.booster.eligible[1]!]; // Frostbolt only — Synmist is reserved elsewhere
    payload.booster.ineligible = [
      {
        characterId: SYNMIST,
        characterName: "Synmist",
        realm: "Antonidas",
        reason: "ALREADY_SELECTED_OTHER_RUN",
        message: "Already selected for Sat 20:00 HC VIP 8/8 Aelira Nightwatch.",
        conflictingRunTitle: "Sat 20:00 HC VIP 8/8 Aelira Nightwatch",
      },
    ];
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(payload) });

    const interaction = fakeInteraction("user-a");
    await signupButton(interaction, api, RUN_ID);

    const call = interaction.editReply.mock.calls[0]?.[0];
    expect(call.content).toContain("Unavailable characters");
    expect(call.content).toContain("Synmist-Antonidas");
    expect(call.content).toContain("Sat 20:00 HC VIP 8/8 Aelira Nightwatch");
    const menu = call.components[0].components[0].toJSON();
    expect(menu.options.map((option: { value: string }) => option.value)).toEqual([FROSTBOLT]);
  });

  it("shows a clear explanation instead of an empty selector when every character is reservation-blocked", async () => {
    const payload = signupOptionsPayload();
    payload.booster.eligible = [];
    payload.booster.ineligible = [
      {
        characterId: SYNMIST,
        characterName: "Synmist",
        realm: "Antonidas",
        reason: "ALREADY_SELECTED_OTHER_RUN",
        message: "Already selected for another run.",
        conflictingRunTitle: "Sat 20:00 HC VIP 8/8 Aelira Nightwatch",
      },
      {
        characterId: FROSTBOLT,
        characterName: "Frostbolt",
        realm: "Antonidas",
        reason: "ALREADY_SELECTED_OTHER_RUN",
        message: "Already selected for another run.",
        conflictingRunTitle: "Sat 20:00 HC VIP 8/8 Aelira Nightwatch",
      },
    ];
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(payload) });

    const interaction = fakeInteraction("user-a");
    await signupButton(interaction, api, RUN_ID);

    const call = interaction.editReply.mock.calls[0]?.[0];
    expect(call.content).toContain("no eligible booster characters");
    expect(call.content).toContain("Unavailable characters");
    expect(call.content).toContain("Frostbolt-Antonidas");
    expect(call.components).toBeUndefined();
  });
});

describe("raid save (lockout) is informational in the Discord signup flow", () => {
  it("a saved character stays selectable, carries a save description on its option, and is summarized up front", async () => {
    const payload = signupOptionsPayload();
    payload.booster.eligible = payload.booster.eligible.map((option) =>
      option.characterId === SYNMIST ? { ...option, raidSave: { bossesDefeated: 8, totalBossCount: 8, isComplete: true } } : option,
    );
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(payload) });

    const interaction = fakeInteraction("user-a");
    await signupButton(interaction, api, RUN_ID);

    const call = interaction.editReply.mock.calls[0]?.[0];
    expect(call.content).toContain("Lockouts this reset");
    expect(call.content).toContain("Synmist");
    const menu = call.components[0].components[0].toJSON();
    // Still selectable — present in the menu, same as any other eligible character.
    expect(menu.options.map((option: { value: string }) => option.value)).toEqual(expect.arrayContaining([SYNMIST, FROSTBOLT]));
    const synmistOption = menu.options.find((option: { value: string }) => option.value === SYNMIST);
    expect(synmistOption.description).toContain("8/8");
    expect(synmistOption.description).toContain("Fully saved");
  });

  it("selecting a saved character still stages only — no DB call until Confirm", async () => {
    const payload = signupOptionsPayload();
    payload.booster.eligible = payload.booster.eligible.map((option) =>
      option.characterId === SYNMIST ? { ...option, raidSave: { bossesDefeated: 8, totalBossCount: 8, isComplete: true } } : option,
    );
    const setCharacterOffers = vi.fn();
    const api = fakeApi({ getSignupOptions: vi.fn().mockResolvedValue(payload), setCharacterOffers });

    await characterSelect(fakeInteraction("user-a", [SYNMIST]), api, RUN_ID);

    expect(setCharacterOffers).not.toHaveBeenCalled();
    expect(getSession("user-a", RUN_ID)?.offers.get(SYNMIST)).toBe("HEALER");
  });
});
