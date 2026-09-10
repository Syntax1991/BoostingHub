import { hashPassword } from "better-auth/crypto";
import { db, orm } from "@/lib/prisma";
import { getDevAuthPassword } from "@/auth/dev-auth";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { MANAFORGE_OMEGA_RAID_ID, WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";

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
  raid: MANAFORGE_OMEGA_RAID_ID,
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
    heroicInProgress: "r9999991-9991-4991-8991-999999999991",
    heroicCompleted: "r9999992-9992-4992-8992-999999999992",
    payoutDraft: "r9999993-9993-4993-8993-999999999993",
    payoutFinalized: "r9999994-9994-4994-8994-999999999994",
    payoutPaid: "r9999995-9995-4995-8995-999999999995",
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
    ipKael: "s9999991-9991-4991-8991-999999999991",
    ipMira: "s9999991-9991-4991-8991-999999999992",
    ipBrann: "s9999991-9991-4991-8991-999999999993",
    ipSylva: "s9999991-9991-4991-8991-999999999994",
    ipAelira: "s9999991-9991-4991-8991-999999999995",
    cpKael: "s9999992-9992-4992-8992-999999999991",
    cpMira: "s9999992-9992-4992-8992-999999999992",
    cpBrann: "s9999992-9992-4992-8992-999999999993",
    pdKael: "s9999993-9993-4993-8993-999999999991",
    pdMira: "s9999993-9993-4993-8993-999999999992",
    pdBrann: "s9999993-9993-4993-8993-999999999993",
    pdSylva: "s9999993-9993-4993-8993-999999999994",
    pfKael: "s9999994-9994-4994-8994-999999999991",
    pfMira: "s9999994-9994-4994-8994-999999999992",
    pfBrann: "s9999994-9994-4994-8994-999999999993",
    pfSylva: "s9999994-9994-4994-8994-999999999994",
    ppKael: "s9999995-9995-4995-8995-999999999991",
    ppMira: "s9999995-9995-4995-8995-999999999992",
    ppBrann: "s9999995-9995-4995-8995-999999999993",
    ppSylva: "s9999995-9995-4995-8995-999999999994",
  },
  rosters: {
    sunday: "o3333333-3333-4333-8333-333333333333",
    published: "o5555555-5555-4555-8555-555555555555",
    inProgress: "o9999991-9991-4991-8991-999999999991",
    completed: "o9999992-9992-4992-8992-999999999992",
    payoutDraft: "o9999993-9993-4993-8993-999999999993",
    payoutFinalized: "o9999994-9994-4994-8994-999999999994",
    payoutPaid: "o9999995-9995-4995-8995-999999999995",
  },
};

async function wipe() {
  for (const row of await orm.RunPayoutEntry.select("id").all()) {
    await orm.RunPayoutEntry.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunSettlement.select("id").all()) {
    await orm.RunSettlement.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunAttendance.select("id").all()) {
    await orm.RunAttendance.where({ id: row.id }).delete();
  }
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
  for (const row of await orm.BoosterQualification.select("id").all()) {
    await orm.BoosterQualification.where({ id: row.id }).delete();
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

  // Collapse APPROVED legacy rows into authoritative User+Difficulty qualifications.
  // mira has zero; aelira gets HEROIC+MYTHIC only (ADMIN does not auto-get all).
  const approvedPairs = new Map<string, { userId: string; difficulty: "NORMAL" | "HEROIC" | "MYTHIC" }>();
  for (const item of access) {
    if (item.status !== "APPROVED") continue;
    approvedPairs.set(`${item.userId}:${item.difficulty}`, {
      userId: item.userId,
      difficulty: item.difficulty,
    });
  }
  for (const pair of approvedPairs.values()) {
    await orm.BoosterQualification.create({
      id: crypto.randomUUID(),
      userId: pair.userId,
      difficulty: pair.difficulty,
      status: "APPROVED",
      notes: "Seeded from approved legacy access.",
      grantedAt: SEED_NOW,
      grantedById: ids.users.aelira,
      revokedAt: null,
      revokedById: null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  await raidRepository.ensureReferenceRaids(SEED_NOW);

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
    {
      id: ids.runs.heroicInProgress,
      title: "In Progress Heroic Attendance",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-08T19:00:00.000Z",
      status: "IN_PROGRESS",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.heroicCompleted,
      title: "Completed Heroic Attendance",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-07T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.payoutDraft,
      title: "Draft Payout Heroic",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-06T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.payoutFinalized,
      title: "Finalized Payout Heroic",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-05T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.payoutPaid,
      title: "Paid Payout Heroic",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-09-04T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
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
    {
      id: ids.signups.ipKael,
      runId: ids.runs.heroicInProgress,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.ipMira,
      runId: ids.runs.heroicInProgress,
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
      id: ids.signups.ipBrann,
      runId: ids.runs.heroicInProgress,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.ipSylva,
      runId: ids.runs.heroicInProgress,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: true,
      status: "SELECTED",
    },
    {
      id: ids.signups.ipAelira,
      runId: ids.runs.heroicInProgress,
      userId: ids.users.aelira,
      characterId: ids.characters.aeliraMonk,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.cpKael,
      runId: ids.runs.heroicCompleted,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.cpMira,
      runId: ids.runs.heroicCompleted,
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
      id: ids.signups.cpBrann,
      runId: ids.runs.heroicCompleted,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pdKael,
      runId: ids.runs.payoutDraft,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pdMira,
      runId: ids.runs.payoutDraft,
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
      id: ids.signups.pdBrann,
      runId: ids.runs.payoutDraft,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pdSylva,
      runId: ids.runs.payoutDraft,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: true,
      status: "SELECTED",
    },
    {
      id: ids.signups.pfKael,
      runId: ids.runs.payoutFinalized,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pfMira,
      runId: ids.runs.payoutFinalized,
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
      id: ids.signups.pfBrann,
      runId: ids.runs.payoutFinalized,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pfSylva,
      runId: ids.runs.payoutFinalized,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: true,
      status: "SELECTED",
    },
    {
      id: ids.signups.ppKael,
      runId: ids.runs.payoutPaid,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.ppMira,
      runId: ids.runs.payoutPaid,
      userId: ids.users.mira,
      characterId: ids.characters.miraPriest,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "SELECTED",
      lootbuddyMode: "PLAYING",
      lootbuddyVerification: "ACCESS",
    },
    {
      id: ids.signups.ppBrann,
      runId: ids.runs.payoutPaid,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.ppSylva,
      runId: ids.runs.payoutPaid,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "DPS",
      isBackup: true,
      status: "SELECTED",
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

  await orm.RunRoster.create({
    id: ids.rosters.inProgress,
    runId: ids.runs.heroicInProgress,
    state: "PUBLISHED",
    version: 1,
    publishedAt: SEED_NOW,
    publishedById: ids.users.thorne,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  const inProgressEntries = [
    { id: "e9999991-9991-4991-8991-999999999991", signupId: ids.signups.ipKael },
    { id: "e9999991-9991-4991-8991-999999999992", signupId: ids.signups.ipMira },
    { id: "e9999991-9991-4991-8991-999999999993", signupId: ids.signups.ipBrann },
    { id: "e9999991-9991-4991-8991-999999999994", signupId: ids.signups.ipSylva },
    { id: "e9999991-9991-4991-8991-999999999995", signupId: ids.signups.ipAelira },
  ];
  for (const entry of inProgressEntries) {
    await orm.RunRosterEntry.create({
      id: entry.id,
      rosterId: ids.rosters.inProgress,
      signupId: entry.signupId,
      selected: true,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }
  const inProgressAttendance = [
    { rosterEntryId: inProgressEntries[0].id, status: "UNMARKED", note: null },
    { rosterEntryId: inProgressEntries[1].id, status: "UNMARKED", note: null },
    { rosterEntryId: inProgressEntries[2].id, status: "NO_SHOW", note: "Did not show" },
    { rosterEntryId: inProgressEntries[3].id, status: "STANDBY", note: "standby, not needed" },
    { rosterEntryId: inProgressEntries[4].id, status: "LATE", note: "joined after boss 1" },
  ] as const;
  for (const row of inProgressAttendance) {
    await orm.RunAttendance.create({
      id: crypto.randomUUID(),
      runId: ids.runs.heroicInProgress,
      rosterEntryId: row.rosterEntryId,
      status: row.status,
      note: row.note,
      markedAt: row.status === "UNMARKED" ? null : SEED_NOW,
      markedById: row.status === "UNMARKED" ? null : ids.users.thorne,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  await orm.RunRoster.create({
    id: ids.rosters.completed,
    runId: ids.runs.heroicCompleted,
    state: "PUBLISHED",
    version: 1,
    publishedAt: SEED_NOW,
    publishedById: ids.users.thorne,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  const completedEntries = [
    { id: "e9999992-9992-4992-8992-999999999991", signupId: ids.signups.cpKael, status: "PRESENT" as const, note: null },
    { id: "e9999992-9992-4992-8992-999999999992", signupId: ids.signups.cpMira, status: "LATE" as const, note: "lootbuddy joined late" },
    { id: "e9999992-9992-4992-8992-999999999993", signupId: ids.signups.cpBrann, status: "EXCUSED" as const, note: "connection problems" },
  ];
  for (const entry of completedEntries) {
    await orm.RunRosterEntry.create({
      id: entry.id,
      rosterId: ids.rosters.completed,
      signupId: entry.signupId,
      selected: true,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await orm.RunAttendance.create({
      id: crypto.randomUUID(),
      runId: ids.runs.heroicCompleted,
      rosterEntryId: entry.id,
      status: entry.status,
      note: entry.note,
      markedAt: SEED_NOW,
      markedById: ids.users.thorne,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  async function seedCompletedPayoutRun(input: {
    runId: string;
    rosterId: string;
    raidName: string;
    settlementId: string;
    status: "DRAFT" | "FINALIZED" | "PAID";
    totalGold: number;
    members: Array<{
      signupId: string;
      rosterEntryId: string;
      attendanceId: string;
      payoutEntryId: string;
      userId: string;
      userDisplayName: string;
      characterId: string;
      characterName: string;
      characterRealm: string;
      characterRegion: "EU" | "US";
      participationType: "BOOSTER" | "LOOTBUDDY";
      attendanceStatus: "PRESENT" | "LATE" | "NO_SHOW" | "STANDBY";
      role: "TANK" | "HEALER" | "DPS" | null;
      isBackup: boolean;
      shareUnits: number;
      amountGold: number;
      adjustmentReason?: string | null;
    }>;
  }) {
    await orm.RunRoster.create({
      id: input.rosterId,
      runId: input.runId,
      state: "PUBLISHED",
      version: 1,
      publishedAt: SEED_NOW,
      publishedById: ids.users.thorne,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    for (const member of input.members) {
      await orm.RunRosterEntry.create({
        id: member.rosterEntryId,
        rosterId: input.rosterId,
        signupId: member.signupId,
        selected: true,
        createdAt: SEED_NOW,
        updatedAt: SEED_NOW,
      });
      await orm.RunAttendance.create({
        id: member.attendanceId,
        runId: input.runId,
        rosterEntryId: member.rosterEntryId,
        status: member.attendanceStatus,
        note: null,
        markedAt: SEED_NOW,
        markedById: ids.users.thorne,
        createdAt: SEED_NOW,
        updatedAt: SEED_NOW,
      });
    }
    await orm.RunSettlement.create({
      id: input.settlementId,
      runId: input.runId,
      totalGold: input.totalGold,
      status: input.status,
      preparedById: ids.users.thorne,
      finalizedAt: input.status === "DRAFT" ? null : SEED_NOW,
      finalizedById: input.status === "DRAFT" ? null : ids.users.thorne,
      paidAt: input.status === "PAID" ? SEED_NOW : null,
      paidById: input.status === "PAID" ? ids.users.aelira : null,
      runTitle:
        input.runId === ids.runs.payoutDraft
          ? "Draft Payout Heroic"
          : input.runId === ids.runs.payoutFinalized
            ? "Finalized Payout Heroic"
            : "Paid Payout Heroic",
      raidName: input.raidName,
      difficulty: "HEROIC",
      raidLeadName: "Thorne Ironvein",
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    for (const member of input.members) {
      await orm.RunPayoutEntry.create({
        id: member.payoutEntryId,
        settlementId: input.settlementId,
        attendanceId: member.attendanceId,
        rosterEntryId: member.rosterEntryId,
        signupId: member.signupId,
        userId: member.userId,
        characterId: member.characterId,
        userDisplayName: member.userDisplayName,
        characterName: member.characterName,
        characterRealm: member.characterRealm,
        characterRegion: member.characterRegion,
        participationType: member.participationType,
        attendanceStatus: member.attendanceStatus,
        role: member.role,
        isBackup: member.isBackup,
        shareUnits: member.shareUnits,
        amountGold: member.amountGold,
        adjustmentReason: member.adjustmentReason ?? null,
        createdAt: SEED_NOW,
        updatedAt: SEED_NOW,
      });
    }
  }

  const raidName = WOW_RAID_CATALOG.find((raid) => raid.id === MANAFORGE_OMEGA_RAID_ID)?.name ?? "Manaforge Omega";
  const payoutMembers = {
    kael: {
      userId: ids.users.kael,
      userDisplayName: "Kael Stormhowl",
      characterId: ids.characters.kaelEle,
      characterName: "Stormhowl",
      characterRealm: "Tarren Mill",
      characterRegion: "EU" as const,
      participationType: "BOOSTER" as const,
      attendanceStatus: "PRESENT" as const,
      role: "DPS" as const,
      isBackup: false,
    },
    mira: {
      userId: ids.users.mira,
      userDisplayName: "Mira Dawnward",
      characterId: ids.characters.miraPriest,
      characterName: "Dawnward",
      characterRealm: "Silvermoon",
      characterRegion: "EU" as const,
      participationType: "LOOTBUDDY" as const,
      attendanceStatus: "LATE" as const,
      role: null,
      isBackup: false,
    },
    brann: {
      userId: ids.users.brann,
      userDisplayName: "Brann Emberforge",
      characterId: ids.characters.brannPaladin,
      characterName: "Emberforge",
      characterRealm: "Kazzak",
      characterRegion: "EU" as const,
      participationType: "BOOSTER" as const,
      attendanceStatus: "NO_SHOW" as const,
      role: "TANK" as const,
      isBackup: false,
    },
    sylva: {
      userId: ids.users.sylva,
      userDisplayName: "Sylva Windchaser",
      characterId: ids.characters.sylvaHunter,
      characterName: "Windchaser",
      characterRealm: "Area 52",
      characterRegion: "US" as const,
      participationType: "BOOSTER" as const,
      attendanceStatus: "STANDBY" as const,
      role: "DPS" as const,
      isBackup: true,
    },
  };

  await seedCompletedPayoutRun({
    runId: ids.runs.payoutDraft,
    rosterId: ids.rosters.payoutDraft,
    raidName,
    settlementId: "t9999993-9993-4993-8993-999999999993",
    status: "DRAFT",
    totalGold: 10000,
    members: [
      { ...payoutMembers.kael, signupId: ids.signups.pdKael, rosterEntryId: "e9999993-9993-4993-8993-999999999991", attendanceId: "a9999993-9993-4993-8993-999999999991", payoutEntryId: "p9999993-9993-4993-8993-999999999991", shareUnits: 100, amountGold: 5000 },
      { ...payoutMembers.mira, signupId: ids.signups.pdMira, rosterEntryId: "e9999993-9993-4993-8993-999999999992", attendanceId: "a9999993-9993-4993-8993-999999999992", payoutEntryId: "p9999993-9993-4993-8993-999999999992", shareUnits: 100, amountGold: 5000 },
      { ...payoutMembers.brann, signupId: ids.signups.pdBrann, rosterEntryId: "e9999993-9993-4993-8993-999999999993", attendanceId: "a9999993-9993-4993-8993-999999999993", payoutEntryId: "p9999993-9993-4993-8993-999999999993", shareUnits: 0, amountGold: 0 },
      { ...payoutMembers.sylva, signupId: ids.signups.pdSylva, rosterEntryId: "e9999993-9993-4993-8993-999999999994", attendanceId: "a9999993-9993-4993-8993-999999999994", payoutEntryId: "p9999993-9993-4993-8993-999999999994", shareUnits: 0, amountGold: 0 },
    ],
  });

  await seedCompletedPayoutRun({
    runId: ids.runs.payoutFinalized,
    rosterId: ids.rosters.payoutFinalized,
    raidName,
    settlementId: "t9999994-9994-4994-8994-999999999994",
    status: "FINALIZED",
    totalGold: 1001,
    members: [
      { ...payoutMembers.kael, signupId: ids.signups.pfKael, rosterEntryId: "e9999994-9994-4994-8994-999999999991", attendanceId: "a9999994-0001-4000-8000-000000000001", payoutEntryId: "p9999994-9994-4994-8994-999999999991", shareUnits: 100, amountGold: 401 },
      { ...payoutMembers.mira, signupId: ids.signups.pfMira, rosterEntryId: "e9999994-9994-4994-8994-999999999992", attendanceId: "a9999994-0001-4000-8000-000000000002", payoutEntryId: "p9999994-9994-4994-8994-999999999992", shareUnits: 100, amountGold: 400 },
      { ...payoutMembers.brann, signupId: ids.signups.pfBrann, rosterEntryId: "e9999994-9994-4994-8994-999999999993", attendanceId: "a9999994-0001-4000-8000-000000000003", payoutEntryId: "p9999994-9994-4994-8994-999999999993", shareUnits: 50, amountGold: 200, attendanceStatus: "NO_SHOW", adjustmentReason: "manager half share" },
      { ...payoutMembers.sylva, signupId: ids.signups.pfSylva, rosterEntryId: "e9999994-9994-4994-8994-999999999994", attendanceId: "a9999994-0001-4000-8000-000000000004", payoutEntryId: "p9999994-9994-4994-8994-999999999994", shareUnits: 0, amountGold: 0 },
    ],
  });

  await seedCompletedPayoutRun({
    runId: ids.runs.payoutPaid,
    rosterId: ids.rosters.payoutPaid,
    raidName,
    settlementId: "t9999995-9995-4995-8995-999999999995",
    status: "PAID",
    totalGold: 9000,
    members: [
      { ...payoutMembers.kael, signupId: ids.signups.ppKael, rosterEntryId: "e9999995-9995-4995-8995-999999999991", attendanceId: "a9999995-9995-4995-8995-999999999991", payoutEntryId: "p9999995-9995-4995-8995-999999999991", shareUnits: 100, amountGold: 4500 },
      { ...payoutMembers.mira, signupId: ids.signups.ppMira, rosterEntryId: "e9999995-9995-4995-8995-999999999992", attendanceId: "a9999995-9995-4995-8995-999999999992", payoutEntryId: "p9999995-9995-4995-8995-999999999992", shareUnits: 100, amountGold: 4500 },
      { ...payoutMembers.brann, signupId: ids.signups.ppBrann, rosterEntryId: "e9999995-9995-4995-8995-999999999993", attendanceId: "a9999995-9995-4995-8995-999999999993", payoutEntryId: "p9999995-9995-4995-8995-999999999993", shareUnits: 0, amountGold: 0 },
      { ...payoutMembers.sylva, signupId: ids.signups.ppSylva, rosterEntryId: "e9999995-9995-4995-8995-999999999994", attendanceId: "a9999995-9995-4995-8995-999999999994", payoutEntryId: "p9999995-9995-4995-8995-999999999994", shareUnits: 0, amountGold: 0 },
    ],
  });

  const activity = [
    { userId: ids.users.thorne, type: "RUN_OPENED", message: "Opened signups for Wednesday Heroic Full Clear." },
    { userId: ids.users.kael, type: "SIGNUP", message: "Kael signed Stormhowl (Restoration) as Healer." },
    { userId: ids.users.aelira, type: "ACCESS", message: "Approved Kael as Shaman Healer for Heroic." },
    { userId: ids.users.mira, type: "SIGNUP", message: "Mira signed as lootbuddy for Friday Mythic." },
    { userId: ids.users.thorne, type: "ROSTERING_STARTED", message: "Started rostering Sunday Heroic Boost." },
    { userId: ids.users.thorne, type: "ROSTER_PUBLISHED", message: "Published the roster for Published Heroic Split." },
    { userId: ids.users.thorne, type: "RUN_STARTED", message: "Started a run." },
    { userId: ids.users.thorne, type: "RUN_COMPLETED", message: "Completed a run." },
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
