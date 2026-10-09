import { hashPassword } from "better-auth/crypto";
import { db, orm } from "@/lib/prisma";
import { getDevAuthPassword } from "@/auth/dev-auth";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { buildRunTitle } from "@/lib/run-title";
import { MANAFORGE_OMEGA_RAID_ID, WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { WOW_CLASSES } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";

const SEED_NOW = "2026-09-08T12:00:00.000Z";
const RESET = "2026-W37";
const PASSWORD = getDevAuthPassword();
/** Every seeded Run gets at least this many signup rows (named fixtures + fillers). */
const MIN_SIGNUPS_PER_RUN = 25;
/** Minimum BOOSTER role offers per run (desired 2/4/14 composition). */
const MIN_BOOSTER_TANKS = 2;
const MIN_BOOSTER_HEALERS = 4;
const MIN_BOOSTER_DPS = 14;

type FillerWowClass =
  | "DEATH_KNIGHT"
  | "DEMON_HUNTER"
  | "DRUID"
  | "EVOKER"
  | "HUNTER"
  | "MAGE"
  | "MONK"
  | "PALADIN"
  | "PRIEST"
  | "ROGUE"
  | "SHAMAN"
  | "WARLOCK"
  | "WARRIOR";

type FillerBoosterRole = "TANK" | "HEALER" | "MELEE_DPS" | "RANGED_DPS";

type FillerBooster = {
  index: number;
  userId: string;
  characterId: string;
  role: FillerBoosterRole;
  wowClass: FillerWowClass;
  specialization: string;
  name: string;
};

function fillerId(prefix: "u" | "c", index: number): string {
  const n = index.toString(16).padStart(12, "0");
  return prefix === "u" ? `f0000000-0000-4000-8000-${n}` : `fc000000-0000-4000-8000-${n}`;
}

/** Dedicated BOOSTER filler pool — enough for 2 tanks / 4 healers / 14 DPS on every run. */
const FILLER_BOOSTER_DEFS: Array<{
  role: FillerBoosterRole;
  wowClass: FillerWowClass;
  specialization: string;
  name: string;
}> = [
  { role: "TANK", wowClass: "WARRIOR", specialization: "Protection", name: "Filltanka" },
  { role: "TANK", wowClass: "PALADIN", specialization: "Protection", name: "Filltankb" },
  { role: "HEALER", wowClass: "PRIEST", specialization: "Holy", name: "Fillheala" },
  { role: "HEALER", wowClass: "SHAMAN", specialization: "Restoration", name: "Fillhealb" },
  { role: "HEALER", wowClass: "DRUID", specialization: "Restoration", name: "Fillhealc" },
  { role: "HEALER", wowClass: "MONK", specialization: "Mistweaver", name: "Fillheald" },
  { role: "RANGED_DPS", wowClass: "MAGE", specialization: "Frost", name: "Filldpsa" },
  { role: "RANGED_DPS", wowClass: "WARLOCK", specialization: "Affliction", name: "Filldpsb" },
  { role: "RANGED_DPS", wowClass: "HUNTER", specialization: "Beast Mastery", name: "Filldpsc" },
  { role: "MELEE_DPS", wowClass: "ROGUE", specialization: "Assassination", name: "Filldpsd" },
  { role: "MELEE_DPS", wowClass: "DEMON_HUNTER", specialization: "Havoc", name: "Filldpse" },
  { role: "RANGED_DPS", wowClass: "EVOKER", specialization: "Devastation", name: "Filldpsf" },
  { role: "MELEE_DPS", wowClass: "DEATH_KNIGHT", specialization: "Unholy", name: "Filldpsg" },
  { role: "MELEE_DPS", wowClass: "WARRIOR", specialization: "Fury", name: "Filldpsh" },
  { role: "MELEE_DPS", wowClass: "PALADIN", specialization: "Retribution", name: "Filldpsi" },
  { role: "RANGED_DPS", wowClass: "PRIEST", specialization: "Shadow", name: "Filldpsj" },
  { role: "MELEE_DPS", wowClass: "SHAMAN", specialization: "Enhancement", name: "Filldpsk" },
  { role: "RANGED_DPS", wowClass: "DRUID", specialization: "Balance", name: "Filldpsl" },
  { role: "MELEE_DPS", wowClass: "MONK", specialization: "Windwalker", name: "Filldpsm" },
  { role: "RANGED_DPS", wowClass: "MAGE", specialization: "Fire", name: "Filldpsn" },
];

const FILLER_BOOSTERS: FillerBooster[] = FILLER_BOOSTER_DEFS.map((def, index) => ({
  index: index + 1,
  userId: fillerId("u", index + 1),
  characterId: fillerId("c", index + 1),
  ...def,
}));

/**
 * Every seeded BOOSTER offer volunteers exactly the one role its fixture
 * names, so seeded data keeps the single-role shape the older fixtures
 * described while still living on RunSignupRole. Roster entries then read the
 * same role back as their `selectedRole` via `seededRoleBySignupId`.
 */
const seededRoleBySignupId = new Map<string, FillerBoosterRole>();

async function seedOfferedRole(signupId: string, role: FillerBoosterRole | null) {
  if (!role) return;
  seededRoleBySignupId.set(signupId, role);
  await orm.RunSignupRole.create({
    id: crypto.randomUUID(),
    signupId,
    role,
    createdAt: SEED_NOW,
  });
}

/** The role a seeded roster slot is assigned — the fixture's own offered role, or none for a Lootbuddy. */
function seededSelectedRole(signupId: string): FillerBoosterRole | null {
  return seededRoleBySignupId.get(signupId) ?? null;
}

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
    completedSmallA: "r9999993-9993-4993-8993-999999999993",
    completedSmallB: "r9999994-9994-4994-8994-999999999994",
    completedSmallC: "r9999995-9995-4995-8995-999999999995",
    /** Completed multi-participant fixture (20 Boosters + Lootbuddies) for attendance / audit QA. */
    largeCompleted: "r9999996-9996-4996-8996-999999999996",
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
    sqThorne: "s9999996-9996-4996-8996-999999999991",
    sqKael: "s9999996-9996-4996-8996-999999999992",
    sqBrann: "s9999996-9996-4996-8996-999999999993",
    sqAelira: "s9999996-9996-4996-8996-999999999994",
    sqMira: "s9999996-9996-4996-8996-999999999995",
    sqSylva: "s9999996-9996-4996-8996-999999999996",
  },
  rosters: {
    sunday: "o3333333-3333-4333-8333-333333333333",
    published: "o5555555-5555-4555-8555-555555555555",
    inProgress: "o9999991-9991-4991-8991-999999999991",
    completed: "o9999992-9992-4992-8992-999999999992",
    completedSmallA: "o9999993-9993-4993-8993-999999999993",
    completedSmallB: "o9999994-9994-4994-8994-999999999994",
    completedSmallC: "o9999995-9995-4995-8995-999999999995",
    largeCompleted: "o9999996-9996-4996-8996-999999999996",
  },
};

async function wipe() {
  // Strike.userId/createdById are Restrict against User; must go before Users.
  for (const row of await orm.Strike.select("id").all()) {
    await orm.Strike.where({ id: row.id }).delete();
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
  for (const row of await orm.RunSignupRole.select("id").all()) {
    await orm.RunSignupRole.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunSignup.select("id").all()) {
    await orm.RunSignup.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunRaidContent.select("id").all()) {
    await orm.RunRaidContent.where({ id: row.id }).delete();
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
  // Shared Warcraft Logs report cache is not owned by any Run; its Run
  // associations/fight rows cascade from it (and from the Runs below).
  for (const row of await orm.WarcraftLogsReport.select("id").all()) {
    await orm.WarcraftLogsReport.where({ id: row.id }).delete();
  }
  for (const row of await orm.Run.select("id").all()) {
    await orm.Run.where({ id: row.id }).delete();
  }
  // Templates reference Raid + User (Restrict); clear before both.
  for (const row of await orm.RunTemplate.select("id").all()) {
    await orm.RunTemplate.where({ id: row.id }).delete();
  }
  // Product contents reference Raid (Restrict); clear products before raids.
  for (const row of await orm.ProductRaidContent.select("id").all()) {
    await orm.ProductRaidContent.where({ id: row.id }).delete();
  }
  for (const row of await orm.Product.select("id").all()) {
    await orm.Product.where({ id: row.id }).delete();
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
    primaryRole: "RANGED_DPS",
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
    primaryRole: "MELEE_DPS",
    // Unknown item level for QA: Blizzard never supplied one for this row.
    itemLevel: null,
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
    primaryRole: "RANGED_DPS",
    itemLevel: 684,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  for (const filler of FILLER_BOOSTERS) {
    await orm.User.create({
      id: filler.userId,
      name: `Filler ${filler.name}`,
      email: `filler${filler.index}@dev.boostting.local`,
      emailVerified: true,
      discordUserId: `200000000000000${String(filler.index).padStart(3, "0")}`,
      discordUsername: `filler${filler.index}`,
      accountRole: "USER",
      accountStatus: "ACTIVE",
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await orm.Account.create({
      id: crypto.randomUUID(),
      accountId: filler.userId,
      providerId: "credential",
      userId: filler.userId,
      password,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await orm.Character.create({
      id: filler.characterId,
      userId: filler.userId,
      ...characterIdentity(filler.name, "Twisting Nether"),
      region: "EU",
      wowClass: filler.wowClass,
      specialization: filler.specialization,
      primaryRole: filler.role,
      itemLevel: 680,
      isActive: true,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  const access: Array<{
    userId: string;
    characterId: string;
    wowClass: "DEATH_KNIGHT" | "DEMON_HUNTER" | "DRUID" | "EVOKER" | "HUNTER" | "MAGE" | "MONK" | "PALADIN" | "PRIEST" | "ROGUE" | "SHAMAN" | "WARLOCK" | "WARRIOR";
    role: "TANK" | "HEALER" | "MELEE_DPS" | "RANGED_DPS" | "DPS";
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

  // Boosting Roles live on the User. Users with an APPROVED legacy request and
  // the filler boosters hold the Booster role (all difficulties). mira has none
  // (ADMIN does not auto-qualify).
  const boosterUserIds = new Set<string>(FILLER_BOOSTERS.map((filler) => filler.userId));
  for (const item of access) {
    if (item.status === "APPROVED") boosterUserIds.add(item.userId);
  }
  for (const userId of boosterUserIds) {
    await orm.User.where({ id: userId }).update({ isBooster: true });
  }

  await raidRepository.ensureReferenceRaids(SEED_NOW);

  const largeCompletedRaid = WOW_RAID_CATALOG.find((raid) => raid.id === MANAFORGE_OMEGA_RAID_ID)!;
  const largeCompletedScheduledStartAt = "2026-10-01T17:00:00.000Z";
  const largeCompletedTitle = buildRunTitle({
    scheduledStartAt: largeCompletedScheduledStartAt,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    titleCoverage: `8/${largeCompletedRaid.bosses.length}`,
    raidLeadName: "Thorne Ironvein",
  });

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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
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
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: "2026-09-07T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.completedSmallA,
      title: "Completed Heroic A",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: "2026-09-06T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.completedSmallB,
      title: "Completed Heroic B",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: "2026-09-05T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.completedSmallC,
      title: "Completed Heroic C",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: "2026-09-04T19:00:00.000Z",
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
    {
      id: ids.runs.largeCompleted,
      title: largeCompletedTitle,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: largeCompletedScheduledStartAt,
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: ids.users.thorne,
    },
  ] as const;

  for (const run of runs) {
    const { plannedBossCount, ...runFields } = run;
    await orm.Run.create({
      ...runFields,
      notes:
        run.id === ids.runs.largeCompleted
          ? "Large completed fixture: 20 Boosters + Lootbuddies with fully marked attendance."
          : run.status === "DRAFT"
            ? "Not visible as an open signup run until published."
            : null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await orm.RunRaidContent.create({
      id: crypto.randomUUID(),
      runId: run.id,
      raidId: ids.raid,
      sortOrder: 1,
      plannedBossCount,
      createdAt: SEED_NOW,
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
      role: "RANGED_DPS",
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
      role: "RANGED_DPS",
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
      role: "RANGED_DPS",
      isBackup: false,
      status: "PENDING",
    },
    {
      id: crypto.randomUUID(),
      runId: ids.runs.normalOpen,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.publishedKael,
      runId: ids.runs.heroicPublished,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
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
      role: "RANGED_DPS",
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
      role: "RANGED_DPS",
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
      role: "RANGED_DPS",
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
      role: "RANGED_DPS",
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
      role: "RANGED_DPS",
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
      runId: ids.runs.completedSmallA,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pdMira,
      runId: ids.runs.completedSmallA,
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
      runId: ids.runs.completedSmallA,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pdSylva,
      runId: ids.runs.completedSmallA,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: true,
      status: "SELECTED",
    },
    {
      id: ids.signups.pfKael,
      runId: ids.runs.completedSmallB,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pfMira,
      runId: ids.runs.completedSmallB,
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
      runId: ids.runs.completedSmallB,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.pfSylva,
      runId: ids.runs.completedSmallB,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: true,
      status: "SELECTED",
    },
    {
      id: ids.signups.ppKael,
      runId: ids.runs.completedSmallC,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.ppMira,
      runId: ids.runs.completedSmallC,
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
      runId: ids.runs.completedSmallC,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.ppSylva,
      runId: ids.runs.completedSmallC,
      userId: ids.users.sylva,
      characterId: ids.characters.sylvaHunter,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: true,
      status: "SELECTED",
    },
    {
      id: ids.signups.sqThorne,
      runId: ids.runs.largeCompleted,
      userId: ids.users.thorne,
      characterId: ids.characters.thorneWarrior,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.sqKael,
      runId: ids.runs.largeCompleted,
      userId: ids.users.kael,
      characterId: ids.characters.kaelEle,
      participationType: "BOOSTER",
      role: "RANGED_DPS",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.sqBrann,
      runId: ids.runs.largeCompleted,
      userId: ids.users.brann,
      characterId: ids.characters.brannPaladin,
      participationType: "BOOSTER",
      role: "TANK",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.sqAelira,
      runId: ids.runs.largeCompleted,
      userId: ids.users.aelira,
      characterId: ids.characters.aeliraMonk,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "SELECTED",
    },
    {
      id: ids.signups.sqMira,
      runId: ids.runs.largeCompleted,
      userId: ids.users.mira,
      characterId: null,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "SELECTED",
      lootbuddyClass: "PRIEST",
      lootbuddyMode: "PLAYING",
      lootbuddyVerification: "ACCESS",
    },
    {
      id: ids.signups.sqSylva,
      runId: ids.runs.largeCompleted,
      userId: ids.users.sylva,
      characterId: null,
      participationType: "LOOTBUDDY",
      role: null,
      isBackup: false,
      status: "SELECTED",
      lootbuddyClass: "HUNTER",
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyVerification: "NONE",
    },
  ] as const;

  for (const signup of signups) {
    await orm.RunSignup.create({
      id: signup.id,
      runId: signup.runId,
      userId: signup.userId,
      characterId: signup.characterId,
      participationType: signup.participationType,
      isBackup: signup.isBackup,
      status: signup.status,
      // Live published assignment — only SELECTED BOOSTERs carry a snapshotted role.
      publishedRole:
        signup.status === "SELECTED" && signup.participationType === "BOOSTER" && signup.role
          ? signup.role
          : null,
      lootbuddyClass: "lootbuddyClass" in signup ? signup.lootbuddyClass : null,
      lootbuddyMode: "lootbuddyMode" in signup ? signup.lootbuddyMode : null,
      lootbuddyVerification: "lootbuddyVerification" in signup ? signup.lootbuddyVerification : null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await seedOfferedRole(signup.id, signup.role);
  }

  // Large completed: 16 extra SELECTED Boosters so named 4 + fillers 16 = 20 full Cuts.
  // Prefer healers/DPS fillers so combined role minima stay at least 2/4/14.
  const largeCompletedFillerDefs = [
    ...FILLER_BOOSTERS.filter((filler) => filler.role === "HEALER").slice(0, 3),
    ...FILLER_BOOSTERS.filter((filler) => filler.role === "MELEE_DPS" || filler.role === "RANGED_DPS").slice(0, 13),
  ];
  const largeCompletedFillerSignups: Array<{
    id: string;
    runId: string;
    userId: string;
    characterId: string;
    participationType: "BOOSTER";
    role: FillerBoosterRole;
    isBackup: boolean;
    status: "SELECTED";
  }> = [];
  for (const [index, filler] of largeCompletedFillerDefs.entries()) {
    const n = String(index + 1).padStart(2, "0");
    const row = {
      id: `s9999996-f016-4016-8016-0000000000${n}`,
      runId: ids.runs.largeCompleted,
      userId: filler.userId,
      characterId: filler.characterId,
      participationType: "BOOSTER" as const,
      role: filler.role,
      isBackup: false,
      status: "SELECTED" as const,
    };
    largeCompletedFillerSignups.push(row);
    const { role, ...signupRow } = row;
    await orm.RunSignup.create({
      ...signupRow,
      publishedRole: role,
      lootbuddyClass: null,
      lootbuddyMode: null,
      lootbuddyVerification: null,
      notes: "Large completed filler Booster.",
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await seedOfferedRole(row.id, role);
  }

  // Pad every run to composition minima (2/4/14 BOOSTER) then MIN_SIGNUPS_PER_RUN.
  // BOOSTER fillers use the dedicated filler pool; LOOTBUDDY fillers pad remainder.
  // Never SELECTED / never on roster — keeps attendance and roster tests stable.
  // Skip mira for lootbuddy padding: signup.service tests assert her PENDING counts.
  const lootbuddyFillerOwners = [ids.users.kael, ids.users.thorne, ids.users.aelira, ids.users.brann, ids.users.sylva];
  type CompositionBucket = "TANK" | "HEALER" | "DPS";
  function compositionBucket(role: string): CompositionBucket | null {
    if (role === "TANK" || role === "HEALER") return role;
    if (role === "DPS" || role === "MELEE_DPS" || role === "RANGED_DPS") return "DPS";
    return null;
  }
  const roleMinimums: Array<{ bucket: CompositionBucket; minimum: number }> = [
    { bucket: "TANK", minimum: MIN_BOOSTER_TANKS },
    { bucket: "HEALER", minimum: MIN_BOOSTER_HEALERS },
    { bucket: "DPS", minimum: MIN_BOOSTER_DPS },
  ];

  for (const run of runs) {
    const runSignups = [
      ...signups.filter((signup) => signup.runId === run.id),
      ...(run.id === ids.runs.largeCompleted ? largeCompletedFillerSignups : []),
    ];
    const fillerStatus =
      run.status === "OPEN" || run.status === "DRAFT" || run.status === "ROSTERING" ? "PENDING" : "NOT_SELECTED";

    const roleCounts: Record<CompositionBucket, number> = { TANK: 0, HEALER: 0, DPS: 0 };
    for (const signup of runSignups) {
      if (signup.participationType !== "BOOSTER" || signup.status === "WITHDRAWN" || signup.role == null) continue;
      const bucket = compositionBucket(signup.role);
      if (bucket) roleCounts[bucket] += 1;
    }

    // Characters already offered as BOOSTER on this run (named + large completed fillers).
    const usedCharacterIds = new Set(
      runSignups
        .filter((signup) => signup.participationType === "BOOSTER" && signup.characterId)
        .map((signup) => signup.characterId as string),
    );

    let created = 0;
    for (const { bucket, minimum } of roleMinimums) {
      let need = Math.max(0, minimum - roleCounts[bucket]);
      for (const filler of FILLER_BOOSTERS) {
        if (need <= 0) break;
        if (compositionBucket(filler.role) !== bucket) continue;
        if (usedCharacterIds.has(filler.characterId)) continue;
        const fillerSignupId = crypto.randomUUID();
        await orm.RunSignup.create({
          id: fillerSignupId,
          runId: run.id,
          userId: filler.userId,
          characterId: filler.characterId,
          participationType: "BOOSTER",
          isBackup: false,
          status: fillerStatus,
          publishedRole: null,
          lootbuddyClass: null,
          lootbuddyMode: null,
          lootbuddyVerification: null,
          notes: "Seed filler booster for 2/4/14 composition QA.",
          createdAt: SEED_NOW,
          updatedAt: SEED_NOW,
        });
        await seedOfferedRole(fillerSignupId, filler.role);
        usedCharacterIds.add(filler.characterId);
        need -= 1;
        created += 1;
        roleCounts[bucket] += 1;
      }
      if (need > 0) {
        throw new Error(`Seed filler pool exhausted for ${bucket} on run ${run.id} (still need ${need}).`);
      }
    }

    const activeNamed = runSignups.filter((signup) => signup.status !== "WITHDRAWN").length;
    const lootNeed = Math.max(0, MIN_SIGNUPS_PER_RUN - (activeNamed + created));
    for (let i = 0; i < lootNeed; i++) {
      await orm.RunSignup.create({
        id: crypto.randomUUID(),
        runId: run.id,
        userId: lootbuddyFillerOwners[i % lootbuddyFillerOwners.length]!,
        characterId: null,
        participationType: "LOOTBUDDY",
        isBackup: false,
        status: fillerStatus,
        publishedRole: null,
        lootbuddyClass: WOW_CLASSES[i % WOW_CLASSES.length]!,
        lootbuddyMode: "LOOT_ONLY",
        lootbuddyVerification: "NONE",
        notes: "Seed filler to reach minimum signup volume for UI QA.",
        createdAt: SEED_NOW,
        updatedAt: SEED_NOW,
      });
    }
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
      selectedRole: seededSelectedRole(signupId),
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
      selectedRole: seededSelectedRole(entry.signupId),
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
      selectedRole: seededSelectedRole(entry.signupId),
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

  // Large completed: COMPLETED + published roster + fully marked attendance.
  // 20 PRESENT Boosters (named + filler pool) + PRESENT Lootbuddy + STANDBY Lootbuddy.
  await orm.RunRoster.create({
    id: ids.rosters.largeCompleted,
    runId: ids.runs.largeCompleted,
    state: "PUBLISHED",
    version: 1,
    publishedAt: SEED_NOW,
    publishedById: ids.users.thorne,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  const largeCompletedMembers = [
    {
      rosterEntryId: "e9999996-9996-4996-8996-999999999991",
      attendanceId: "a9999996-9996-4996-8996-999999999991",
      signupId: ids.signups.sqThorne,
      status: "PRESENT" as const,
      note: null as string | null,
    },
    {
      rosterEntryId: "e9999996-9996-4996-8996-999999999992",
      attendanceId: "a9999996-9996-4996-8996-999999999992",
      signupId: ids.signups.sqKael,
      status: "PRESENT" as const,
      note: null,
    },
    {
      rosterEntryId: "e9999996-9996-4996-8996-999999999993",
      attendanceId: "a9999996-9996-4996-8996-999999999993",
      signupId: ids.signups.sqBrann,
      status: "PRESENT" as const,
      note: null,
    },
    {
      rosterEntryId: "e9999996-9996-4996-8996-999999999994",
      attendanceId: "a9999996-9996-4996-8996-999999999994",
      signupId: ids.signups.sqAelira,
      status: "PRESENT" as const,
      note: null,
    },
    {
      rosterEntryId: "e9999996-9996-4996-8996-999999999995",
      attendanceId: "a9999996-9996-4996-8996-999999999995",
      signupId: ids.signups.sqMira,
      status: "PRESENT" as const,
      note: "characterless PLAYING lootbuddy",
    },
    {
      rosterEntryId: "e9999996-9996-4996-8996-999999999996",
      attendanceId: "a9999996-9996-4996-8996-999999999996",
      signupId: ids.signups.sqSylva,
      status: "STANDBY" as const,
      note: "standby lootbuddy",
    },
  ];
  for (const [index, fillerSignup] of largeCompletedFillerSignups.entries()) {
    const n = String(index + 1).padStart(2, "0");
    largeCompletedMembers.push({
      rosterEntryId: `e9999996-f016-4016-8016-0000000000${n}`,
      attendanceId: `a9999996-f016-4016-8016-0000000000${n}`,
      signupId: fillerSignup.id,
      status: "PRESENT",
      note: null,
    });
  }
  for (const member of largeCompletedMembers) {
    await orm.RunRosterEntry.create({
      id: member.rosterEntryId,
      rosterId: ids.rosters.largeCompleted,
      signupId: member.signupId,
      selected: true,
      selectedRole: seededSelectedRole(member.signupId),
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
    await orm.RunAttendance.create({
      id: member.attendanceId,
      runId: ids.runs.largeCompleted,
      rosterEntryId: member.rosterEntryId,
      status: member.status,
      note: member.note,
      markedAt: SEED_NOW,
      markedById: ids.users.thorne,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  }

  /** COMPLETED Run fixture: published roster + fully marked attendance. */
  async function seedCompletedRunWithAttendance(input: {
    runId: string;
    rosterId: string;
    members: Array<{
      signupId: string;
      rosterEntryId: string;
      attendanceId: string;
      userId: string;
      userDisplayName: string;
      characterId: string;
      characterName: string;
      characterRealm: string;
      characterRegion: "EU" | "US";
      participationType: "BOOSTER" | "LOOTBUDDY";
      attendanceStatus: "PRESENT" | "LATE" | "NO_SHOW" | "STANDBY";
      role: "TANK" | "HEALER" | "MELEE_DPS" | "RANGED_DPS" | "DPS" | null;
      isBackup: boolean;
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
        selectedRole: seededSelectedRole(member.signupId),
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
  }

  const completedRunMembers = {
    kael: {
      userId: ids.users.kael,
      userDisplayName: "Kael Stormhowl",
      characterId: ids.characters.kaelEle,
      characterName: "Stormhowl",
      characterRealm: "Tarren Mill",
      characterRegion: "EU" as const,
      participationType: "BOOSTER" as const,
      attendanceStatus: "PRESENT" as const,
      role: "RANGED_DPS" as const,
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
      role: "RANGED_DPS" as const,
      isBackup: true,
    },
  };

  await seedCompletedRunWithAttendance({
    runId: ids.runs.completedSmallA,
    rosterId: ids.rosters.completedSmallA,
    members: [
      { ...completedRunMembers.kael, signupId: ids.signups.pdKael, rosterEntryId: "e9999993-9993-4993-8993-999999999991", attendanceId: "a9999993-9993-4993-8993-999999999991" },
      { ...completedRunMembers.mira, signupId: ids.signups.pdMira, rosterEntryId: "e9999993-9993-4993-8993-999999999992", attendanceId: "a9999993-9993-4993-8993-999999999992" },
      { ...completedRunMembers.brann, signupId: ids.signups.pdBrann, rosterEntryId: "e9999993-9993-4993-8993-999999999993", attendanceId: "a9999993-9993-4993-8993-999999999993" },
      { ...completedRunMembers.sylva, signupId: ids.signups.pdSylva, rosterEntryId: "e9999993-9993-4993-8993-999999999994", attendanceId: "a9999993-9993-4993-8993-999999999994" },
    ],
  });

  await seedCompletedRunWithAttendance({
    runId: ids.runs.completedSmallB,
    rosterId: ids.rosters.completedSmallB,
    members: [
      { ...completedRunMembers.kael, signupId: ids.signups.pfKael, rosterEntryId: "e9999994-9994-4994-8994-999999999991", attendanceId: "a9999994-0001-4000-8000-000000000001" },
      { ...completedRunMembers.mira, signupId: ids.signups.pfMira, rosterEntryId: "e9999994-9994-4994-8994-999999999992", attendanceId: "a9999994-0001-4000-8000-000000000002" },
      { ...completedRunMembers.brann, signupId: ids.signups.pfBrann, rosterEntryId: "e9999994-9994-4994-8994-999999999993", attendanceId: "a9999994-0001-4000-8000-000000000003", attendanceStatus: "NO_SHOW" },
      { ...completedRunMembers.sylva, signupId: ids.signups.pfSylva, rosterEntryId: "e9999994-9994-4994-8994-999999999994", attendanceId: "a9999994-0001-4000-8000-000000000004" },
    ],
  });

  await seedCompletedRunWithAttendance({
    runId: ids.runs.completedSmallC,
    rosterId: ids.rosters.completedSmallC,
    members: [
      { ...completedRunMembers.kael, signupId: ids.signups.ppKael, rosterEntryId: "e9999995-9995-4995-8995-999999999991", attendanceId: "a9999995-9995-4995-8995-999999999991" },
      { ...completedRunMembers.mira, signupId: ids.signups.ppMira, rosterEntryId: "e9999995-9995-4995-8995-999999999992", attendanceId: "a9999995-9995-4995-8995-999999999992" },
      { ...completedRunMembers.brann, signupId: ids.signups.ppBrann, rosterEntryId: "e9999995-9995-4995-8995-999999999993", attendanceId: "a9999995-9995-4995-8995-999999999993" },
      { ...completedRunMembers.sylva, signupId: ids.signups.ppSylva, rosterEntryId: "e9999995-9995-4995-8995-999999999994", attendanceId: "a9999995-9995-4995-8995-999999999994" },
    ],
  });

  // Strikes: disciplinary history.
  // Kael: one ACTIVE, general (no run). Mira: one REVOKED, general. Brann:
  // one ACTIVE, linked to their NO_SHOW on completed run B — a
  // realistic run-linked incident. Sylva/Thorne/Aelira: no strikes, to keep
  // "no disciplinary history" represented too.
  await orm.Strike.create({
    id: "k1111111-1111-4111-8111-111111111111",
    userId: ids.users.kael,
    runId: null,
    reason: "Late without notice on two consecutive runs",
    notes: "Discussed in Discord; no further action yet.",
    status: "ACTIVE",
    createdById: ids.users.aelira,
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Strike.create({
    id: "k2222222-2222-4222-8222-222222222222",
    userId: ids.users.mira,
    runId: null,
    reason: "Incorrect loot rule assumption",
    notes: null,
    status: "REVOKED",
    createdById: ids.users.aelira,
    revokedAt: SEED_NOW,
    revokedById: ids.users.aelira,
    revokedReason: "Staff review found the rule was followed correctly.",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await orm.Strike.create({
    id: "k5555555-5555-4555-8555-555555555555",
    userId: ids.users.brann,
    runId: ids.runs.completedSmallB,
    reason: "No-show without notice",
    notes: "Did not respond to Discord ping before or during the run.",
    status: "ACTIVE",
    createdById: ids.users.thorne,
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
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
  console.log(`Large completed run: ${largeCompletedTitle}`);
  console.log(`  id: ${ids.runs.largeCompleted}`);
  console.log(`  http://localhost:3000/runs/${ids.runs.largeCompleted}?tab=attendance`);
  console.log(`Every run padded to ≥${MIN_SIGNUPS_PER_RUN} signups and ≥${MIN_BOOSTER_TANKS}/${MIN_BOOSTER_HEALERS}/${MIN_BOOSTER_DPS} BOOSTER roles.`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
