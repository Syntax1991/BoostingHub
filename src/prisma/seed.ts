import { hashPassword } from "better-auth/crypto";
import { db, orm } from "@/lib/prisma";
import { getDevAuthPassword } from "@/auth/dev-auth";
import { normalizeCharacterIdentity } from "@/lib/character-identity";

const SEED_NOW = "2026-09-08T12:00:00.000Z";
const RESET = "2026-W37";
const PASSWORD = getDevAuthPassword();

function characterIdentity(name: string, realm: string) {
  return {
    name,
    realm,
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(realm),
  };
}

const ids = {
  users: {
    kael: "11111111-1111-4111-8111-111111111111",
    mira: "22222222-2222-4222-8222-222222222222",
    thorne: "33333333-3333-4333-8333-333333333333",
    aelira: "44444444-4444-4444-8444-444444444444",
    brann: "55555555-5555-4555-8555-555555555555",
    sylva: "66666666-6666-4666-8666-666666666666",
  },
  raid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  characters: {
    kaelResto: "c1111111-1111-4111-8111-111111111111",
    kaelEle: "c1111111-1111-4111-8111-111111111112",
    kaelInactive: "c1111111-1111-4111-8111-111111111113",
    miraPriest: "c2222222-2222-4222-8222-222222222221",
    thorneWarrior: "c3333333-3333-4333-8333-333333333331",
    aeliraMonk: "c4444444-4444-4444-8444-444444444441",
    brannPaladin: "c5555555-5555-4555-8555-555555555551",
    brannHoly: "c5555555-5555-4555-8555-555555555552",
    sylvaHunter: "c6666666-6666-4666-8666-666666666661",
  },
  runs: {
    heroicOpen: "r1111111-1111-4111-8111-111111111111",
    mythicOpen: "r2222222-2222-4222-8222-222222222222",
    heroicRostering: "r3333333-3333-4333-8333-333333333333",
    normalOpen: "r4444444-4444-4444-8444-444444444444",
    heroicPublished: "r5555555-5555-4555-8555-555555555555",
    mythicDraft: "r6666666-6666-4666-8666-666666666666",
    heroicWeekend: "r7777777-7777-4777-8777-777777777777",
    rosterLab: "r8888888-8888-4888-8888-888888888888",
  },
  signups: {
    publishedKael: "s5555555-5555-4555-8555-555555555551",
    publishedMira: "s5555555-5555-4555-8555-555555555552",
    publishedBrann: "s5555555-5555-4555-8555-555555555553",
    sunThorne: "s3333333-3333-4333-8333-333333333331",
    sunBrannTank: "s3333333-3333-4333-8333-333333333332",
    sunBrannHoly: "s3333333-3333-4333-8333-333333333333",
    sunAelira: "s3333333-3333-4333-8333-333333333334",
    sunKaelResto: "s3333333-3333-4333-8333-333333333335",
    sunKaelEle: "s3333333-3333-4333-8333-333333333336",
    sunSylva: "s3333333-3333-4333-8333-333333333337",
    sunMira: "s3333333-3333-4333-8333-333333333338",
    labKaelResto: "s8888888-8888-4888-8888-888888888881",
    labKaelEle: "s8888888-8888-4888-8888-888888888882",
    labBrannTank: "s8888888-8888-4888-8888-888888888883",
    labBrannHoly: "s8888888-8888-4888-8888-888888888884",
    labMira: "s8888888-8888-4888-8888-888888888885",
    labSylva: "s8888888-8888-4888-8888-888888888886",
    labThorne: "s8888888-8888-4888-8888-888888888887",
    labAelira: "s8888888-8888-4888-8888-888888888888",
  },
  rosters: {
    sunday: "o3333333-3333-4333-8333-333333333333",
    published: "o5555555-5555-4555-8555-555555555555",
  },
};

async function wipe() {
  for (const row of await orm.RunRosterEntry.select("id").all()) {
    await orm.RunRosterEntry.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunRoster.select("id").all()) {
    await orm.RunRoster.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunSignup.select("id").all()) {
    await orm.RunSignup.where({ id: row.id }).delete();
  }
  for (const row of await orm.CharacterRaidLockout.select("id").all()) {
    await orm.CharacterRaidLockout.where({ id: row.id }).delete();
  }
  for (const row of await orm.BoosterAccess.select("id").all()) {
    await orm.BoosterAccess.where({ id: row.id }).delete();
  }
  for (const row of await orm.ActivityEvent.select("id").all()) {
    await orm.ActivityEvent.where({ id: row.id }).delete();
  }
  for (const row of await orm.Run.select("id").all()) {
    await orm.Run.where({ id: row.id }).delete();
  }
  for (const row of await orm.RaidBoss.select("id").all()) {
    await orm.RaidBoss.where({ id: row.id }).delete();
  }
  for (const row of await orm.Character.select("id").all()) {
    await orm.Character.where({ id: row.id }).delete();
  }
  for (const row of await orm.Session.select("id").all()) {
    await orm.Session.where({ id: row.id }).delete();
  }
  for (const row of await orm.Account.select("id").all()) {
    await orm.Account.where({ id: row.id }).delete();
  }
  for (const row of await orm.Verification.select("id").all()) {
    await orm.Verification.where({ id: row.id }).delete();
  }
  for (const row of await orm.Raid.select("id").all()) {
    await orm.Raid.where({ id: row.id }).delete();
  }
  for (const row of await orm.User.select("id").all()) {
    await orm.User.where({ id: row.id }).delete();
  }
}

async function seed() {
  await wipe();
  const password = await hashPassword(PASSWORD);

  await orm.User.create({
    id: ids.users.kael,
    name: "Kael Stormhowl",
    email: "kael@dev.boostting.local",
    emailVerified: true,
    discordUserId: "100000000000000001",
    discordUsername: "kaelstorm",
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.User.create({
    id: ids.users.mira,
    name: "Mira Dawnward",
    email: "mira@dev.boostting.local",
    emailVerified: true,
    discordUserId: "100000000000000002",
    discordUsername: "miradawn",
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.User.create({
    id: ids.users.thorne,
    name: "Thorne Ironvein",
    email: "thorne@dev.boostting.local",
    emailVerified: true,
    discordUserId: "100000000000000003",
    discordUsername: "thornelead",
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.User.create({
    id: ids.users.aelira,
    name: "Aelira Nightwatch",
    email: "aelira@dev.boostting.local",
    emailVerified: true,
    discordUserId: "100000000000000004",
    discordUsername: "aeliraadmin",
    accountRole: "ADMIN",
    accountStatus: "ACTIVE",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.User.create({
    id: ids.users.brann,
    name: "Brann Emberforge",
    email: "brann@dev.boostting.local",
    emailVerified: true,
    discordUserId: "100000000000000005",
    discordUsername: "brannforge",
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.User.create({
    id: ids.users.sylva,
    name: "Sylva Windchaser",
    email: "sylva@dev.boostting.local",
    emailVerified: true,
    discordUserId: "100000000000000006",
    discordUsername: "sylvawind",
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  for (const userId of Object.values(ids.users)) {
    await orm.Account.create({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  await orm.Character.create({
    id: ids.characters.kaelResto,
    userId: ids.users.kael,
    ...characterIdentity("Stormhowl", "Twisting Nether"),
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
    itemLevel: 701,
    isActive: true,
    lastSyncedAt: SEED_NOW,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.kaelEle,
    userId: ids.users.kael,
    ...characterIdentity("Stormhowl", "Tarren Mill"),
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Elemental",
    primaryRole: "DPS",
    itemLevel: 688,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.kaelInactive,
    userId: ids.users.kael,
    ...characterIdentity("Stormhowl", "Ragnaros"),
    region: "EU",
    wowClass: "SHAMAN",
    specialization: "Enhancement",
    primaryRole: "DPS",
    itemLevel: 640,
    isActive: false,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.miraPriest,
    userId: ids.users.mira,
    ...characterIdentity("Dawnward", "Silvermoon"),
    region: "EU",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
    itemLevel: 672,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.thorneWarrior,
    userId: ids.users.thorne,
    ...characterIdentity("Ironvein", "Draenor"),
    region: "EU",
    wowClass: "WARRIOR",
    specialization: "Protection",
    primaryRole: "TANK",
    itemLevel: 706,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.aeliraMonk,
    userId: ids.users.aelira,
    ...characterIdentity("Nightwatch", "Ravencrest"),
    region: "EU",
    wowClass: "MONK",
    specialization: "Mistweaver",
    primaryRole: "HEALER",
    itemLevel: 710,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.brannPaladin,
    userId: ids.users.brann,
    ...characterIdentity("Emberforge", "Kazzak"),
    region: "EU",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
    itemLevel: 698,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.brannHoly,
    userId: ids.users.brann,
    ...characterIdentity("Emberlight", "Kazzak"),
    region: "EU",
    wowClass: "PALADIN",
    specialization: "Holy",
    primaryRole: "HEALER",
    itemLevel: 690,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Character.create({
    id: ids.characters.sylvaHunter,
    userId: ids.users.sylva,
    ...characterIdentity("Windchaser", "Area 52"),
    region: "US",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
    itemLevel: 684,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  const access: Array<{
    userId: string;
    characterId: string;
    wowClass: "DEATH_KNIGHT" | "DEMON_HUNTER" | "DRUID" | "EVOKER" | "HUNTER" | "MAGE" | "MONK" | "PALADIN" | "PRIEST" | "ROGUE" | "SHAMAN" | "WARLOCK" | "WARRIOR";
    role: "TANK" | "HEALER" | "DPS";
    difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
    status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
    notes?: string;
  }> = [
    { userId: ids.users.kael, characterId: ids.characters.kaelResto, wowClass: "SHAMAN", role: "HEALER", difficulty: "HEROIC", status: "APPROVED" },
    { userId: ids.users.kael, characterId: ids.characters.kaelResto, wowClass: "SHAMAN", role: "HEALER", difficulty: "MYTHIC", status: "PENDING" },
    { userId: ids.users.kael, characterId: ids.characters.kaelEle, wowClass: "SHAMAN", role: "DPS", difficulty: "HEROIC", status: "APPROVED" },
    { userId: ids.users.kael, characterId: ids.characters.kaelEle, wowClass: "SHAMAN", role: "DPS", difficulty: "MYTHIC", status: "REJECTED", notes: "Logs not yet sufficient for mythic DPS." },
    { userId: ids.users.kael, characterId: ids.characters.kaelInactive, wowClass: "SHAMAN", role: "DPS", difficulty: "NORMAL", status: "REVOKED", notes: "Revoked while the character is inactive." },
    { userId: ids.users.brann, characterId: ids.characters.brannPaladin, wowClass: "PALADIN", role: "TANK", difficulty: "HEROIC", status: "APPROVED" },
    { userId: ids.users.brann, characterId: ids.characters.brannPaladin, wowClass: "PALADIN", role: "TANK", difficulty: "MYTHIC", status: "APPROVED" },
    { userId: ids.users.brann, characterId: ids.characters.brannHoly, wowClass: "PALADIN", role: "HEALER", difficulty: "HEROIC", status: "APPROVED" },
    { userId: ids.users.sylva, characterId: ids.characters.sylvaHunter, wowClass: "HUNTER", role: "DPS", difficulty: "NORMAL", status: "APPROVED" },
    { userId: ids.users.sylva, characterId: ids.characters.sylvaHunter, wowClass: "HUNTER", role: "DPS", difficulty: "HEROIC", status: "PENDING" },
    { userId: ids.users.thorne, characterId: ids.characters.thorneWarrior, wowClass: "WARRIOR", role: "TANK", difficulty: "MYTHIC", status: "APPROVED" },
    { userId: ids.users.thorne, characterId: ids.characters.thorneWarrior, wowClass: "WARRIOR", role: "TANK", difficulty: "HEROIC", status: "APPROVED" },
    { userId: ids.users.aelira, characterId: ids.characters.aeliraMonk, wowClass: "MONK", role: "HEALER", difficulty: "MYTHIC", status: "APPROVED" },
    { userId: ids.users.aelira, characterId: ids.characters.aeliraMonk, wowClass: "MONK", role: "HEALER", difficulty: "HEROIC", status: "APPROVED" },
  ];

  for (const item of access) {
    await orm.BoosterAccess.create({
      id: crypto.randomUUID(),
      ...item,
      approvedAt: item.status === "APPROVED" || item.status === "REVOKED" ? SEED_NOW : null,
      approvedById: item.status === "APPROVED" || item.status === "REVOKED" ? ids.users.aelira : null,
      notes: item.notes ?? (item.status === "PENDING" ? "Awaiting review." : null),
      reviewedAt: item.status === "PENDING" ? null : SEED_NOW,
      reviewedById: item.status === "PENDING" ? null : ids.users.aelira,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  await orm.Raid.create({
    id: ids.raid,
    name: "Manaforge Omega",
    season: "The War Within Season 3",
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  const bosses = [
    "Plexus Sentinel",
    "Loom'ithar",
    "Soulbinder Naazindhri",
    "Forgeweaver Araz",
    "The Soul Hunters",
    "Fractillus",
    "Nexus-King Salhadaar",
    "Dimensius",
  ];

  for (const [index, name] of bosses.entries()) {
    await orm.RaidBoss.create({
      id: crypto.randomUUID(),
      raidId: ids.raid,
      name,
      sortOrder: index + 1,
    });
  }

  await orm.CharacterRaidLockout.create({
    id: crypto.randomUUID(),
    characterId: ids.characters.kaelResto,
    raidId: ids.raid,
    difficulty: "HEROIC",
    resetIdentifier: RESET,
    bossesDefeated: 3,
    isComplete: false,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.CharacterRaidLockout.create({
    id: crypto.randomUUID(),
    characterId: ids.characters.brannPaladin,
    raidId: ids.raid,
    difficulty: "MYTHIC",
    resetIdentifier: RESET,
    bossesDefeated: 8,
    isComplete: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  const runs = [
    {
      id: ids.runs.heroicOpen,
      title: "Wednesday Heroic Full Clear",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-10T19:00:00.000Z",
      status: "OPEN",
      signupsOpen: true,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.mythicOpen,
      title: "Friday Mythic Progression",
      difficulty: "MYTHIC",
      scheduledStartAt: "2026-09-12T18:30:00.000Z",
      status: "OPEN",
      signupsOpen: true,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.heroicRostering,
      title: "Sunday Heroic Boost",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-14T19:00:00.000Z",
      status: "ROSTERING",
      signupsOpen: true,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.normalOpen,
      title: "US Evening Normal Clear",
      difficulty: "NORMAL",
      scheduledStartAt: "2026-09-17T01:00:00.000Z",
      status: "OPEN",
      signupsOpen: true,
      desiredTankCount: 2,
      desiredHealerCount: 3,
      desiredDpsCount: 15,
      raidLeadId: ids.users.aelira,
    },
    {
      id: ids.runs.heroicPublished,
      title: "Published Heroic Split",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-19T19:00:00.000Z",
      status: "PUBLISHED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.mythicDraft,
      title: "Draft Mythic Planning",
      difficulty: "MYTHIC",
      scheduledStartAt: "2026-09-21T18:00:00.000Z",
      status: "DRAFT",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.heroicWeekend,
      title: "Weekend Heroic Catch-up",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-24T18:00:00.000Z",
      status: "OPEN",
      signupsOpen: true,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.rosterLab,
      title: "Roster Lab Heroic",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-28T18:00:00.000Z",
      status: "OPEN",
      signupsOpen: true,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
  ] as const;

  for (const run of runs) {
    await orm.Run.create({
      ...run,
      raidId: ids.raid,
      notes: run.status === "DRAFT" ? "Not visible as an open signup run until published." : null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  const signups = [
    {
      id: crypto.randomUUID(),
      runId: ids.runs.heroicOpen,
      userId: ids.users.kael,
      characterId: ids.characters.kaelResto,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.heroicOpen,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.heroicOpen,
      userId: ids.users.mira,
      characterId: ids.characters.miraPriest,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "PENDING",
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyVerification: "ACCESS",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.mythicOpen,
      userId: ids.users.kael,
      characterId: ids.characters.kaelResto,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: true,
      status: "PENDING",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.mythicOpen,
      userId: ids.users.mira,
      characterId: ids.characters.miraPriest,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "SELECTED",
      lootbuddyMode: "PLAYING",
      lootbuddyVerification: "TRIAL",
    },
    {
      id: ids.signups.sunKaelEle,
      runId: ids.runs.heroicRostering,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.sunKaelResto,
      runId: ids.runs.heroicRostering,
      userId: ids.users.kael,
      characterId: ids.characters.kaelResto,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.sunThorne,
      runId: ids.runs.heroicRostering,
      userId: ids.users.thorne,
      characterId: ids.characters.thorneWarrior,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.sunBrannTank,
      runId: ids.runs.heroicRostering,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.sunBrannHoly,
      runId: ids.runs.heroicRostering,
      userId: ids.users.brann,
      characterId: ids.characters.brannHoly,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: true,
      status: "PENDING",
    },
    {
      id: ids.signups.sunAelira,
      runId: ids.runs.heroicRostering,
      userId: ids.users.aelira,
      characterId: ids.characters.aeliraMonk,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.sunSylva,
      runId: ids.runs.heroicRostering,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.sunMira,
      runId: ids.runs.heroicRostering,
      userId: ids.users.mira,
      characterId: ids.characters.miraPriest,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "PENDING",
      lootbuddyMode: "PLAYING",
      lootbuddyVerification: "TRIAL",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.heroicWeekend,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.normalOpen,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.publishedKael,
      runId: ids.runs.heroicPublished,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.publishedMira,
      runId: ids.runs.heroicPublished,
      userId: ids.users.mira,
      characterId: ids.characters.miraPriest,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "SELECTED",
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyVerification: "ACCESS",
    },
    {
      id: ids.signups.publishedBrann,
      runId: ids.runs.heroicPublished,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "NOT_SELECTED",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.heroicWeekend,
      userId: ids.users.mira,
      characterId: ids.characters.miraPriest,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "WITHDRAWN",
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyVerification: "NONE",
    },
    {
      id: ids.signups.labKaelResto,
      runId: ids.runs.rosterLab,
      userId: ids.users.kael,
      characterId: ids.characters.kaelResto,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.labKaelEle,
      runId: ids.runs.rosterLab,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.labBrannTank,
      runId: ids.runs.rosterLab,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.labBrannHoly,
      runId: ids.runs.rosterLab,
      userId: ids.users.brann,
      characterId: ids.characters.brannHoly,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "WITHDRAWN",
    },
    {
      id: ids.signups.labMira,
      runId: ids.runs.rosterLab,
      userId: ids.users.mira,
      characterId: ids.characters.miraPriest,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "PENDING",
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyVerification: "ACCESS",
    },
    {
      id: ids.signups.labSylva,
      runId: ids.runs.rosterLab,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.labThorne,
      runId: ids.runs.rosterLab,
      userId: ids.users.thorne,
      characterId: ids.characters.thorneWarrior,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: ids.signups.labAelira,
      runId: ids.runs.rosterLab,
      userId: ids.users.aelira,
      characterId: ids.characters.aeliraMonk,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: true,
      status: "PENDING",
    },
  ] as const;

  for (const signup of signups) {
    await orm.RunSignup.create({
      id: signup.id,
      runId: signup.runId,
      userId: signup.userId,
      characterId: signup.characterId,
      participationType: signup.participationType,
      role: signup.role,
      isBackup: signup.isBackup,
      status: signup.status,
      lootbuddyMode: "lootbuddyMode" in signup ? signup.lootbuddyMode : null,
      lootbuddyVerification: "lootbuddyVerification" in signup ? signup.lootbuddyVerification : null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  await orm.RunRoster.create({
    id: ids.rosters.sunday,
    runId: ids.runs.heroicRostering,
    state: "DRAFT",
    version: 2,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  for (const signupId of [
    ids.signups.sunThorne,
    ids.signups.sunBrannHoly,
    ids.signups.sunKaelResto,
    ids.signups.sunAelira,
    ids.signups.sunMira,
  ]) {
    await orm.RunRosterEntry.create({
      id: crypto.randomUUID(),
      rosterId: ids.rosters.sunday,
      signupId,
      selected: true,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  await orm.RunRoster.create({
    id: ids.rosters.published,
    runId: ids.runs.heroicPublished,
    state: "PUBLISHED",
    version: 1,
    publishedAt: SEED_NOW,
    publishedById: ids.users.thorne,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  const activity = [
    { userId: ids.users.thorne, type: "RUN_OPENED", message: "Opened signups for Wednesday Heroic Full Clear." },
    { userId: ids.users.kael, type: "SIGNUP", message: "Kael signed Stormhowl (Restoration) as Healer." },
    { userId: ids.users.aelira, type: "ACCESS", message: "Approved Kael as Shaman Healer for Heroic." },
    { userId: ids.users.mira, type: "SIGNUP", message: "Mira signed as lootbuddy for Friday Mythic." },
    { userId: ids.users.thorne, type: "ROSTERING_STARTED", message: "Started rostering Sunday Heroic Boost." },
    { userId: ids.users.thorne, type: "ROSTER_PUBLISHED", message: "Published the roster for Published Heroic Split." },
  ];

  for (const [index, event] of activity.entries()) {
    await orm.ActivityEvent.create({
      id: crypto.randomUUID(),
      ...event,
      occurredAt: new Date(Date.parse(SEED_NOW) - index * 3_600_000).toISOString(),
    });
  }

  console.log("Seed complete. Development identities:");
  console.log("  kael@dev.boostting.local     USER");
  console.log("  mira@dev.boostting.local     USER");
  console.log("  thorne@dev.boostting.local   RAID_LEAD");
  console.log("  aelira@dev.boostting.local   ADMIN");
  console.log("  brann@dev.boostting.local    USER");
  console.log("  sylva@dev.boostting.local    USER");
  console.log(`  password: ${PASSWORD}`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
