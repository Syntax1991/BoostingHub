import { orm } from "@/lib/prisma";
import type {
  CharacterRole,
  LootbuddyMode,
  LootbuddyVerification,
  ParticipationType,
  RaidDifficulty,
  RunStatus,
  SignupStatus,
} from "@/models/enums";
import {
  asBoolean,
  asString,
  mapCharacterRole,
  mapDifficulty,
  mapLootbuddyMode,
  mapLootbuddyVerification,
  mapParticipation,
  mapRunStatus,
  mapSignupStatus,
} from "@/lib/persistence";

export type SignupListRecord = {
  id: string;
  userId: string;
  status: SignupStatus;
  participationType: ParticipationType;
  isBackup: boolean;
  role: CharacterRole | null;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyVerification: LootbuddyVerification | null;
  character: { id: string; name: string; realm: string } | null;
  run: {
    id: string;
    title: string;
    status: RunStatus;
    difficulty: RaidDifficulty;
    scheduledStartAt: string;
    raid: { name: string };
  };
};

function mapSignup(row: Record<string, unknown>): SignupListRecord {
  const run = (row.run ?? {}) as Record<string, unknown>;
  const raid = (run.raid ?? {}) as Record<string, unknown>;
  const character = row.character ? (row.character as Record<string, unknown>) : null;

  return {
    id: asString(row.id),
    userId: asString(row.userId),
    status: mapSignupStatus(row.status),
    participationType: mapParticipation(row.participationType),
    isBackup: asBoolean(row.isBackup),
    role: row.role == null ? null : mapCharacterRole(row.role),
    lootbuddyMode: row.lootbuddyMode == null ? null : mapLootbuddyMode(row.lootbuddyMode),
    lootbuddyVerification:
      row.lootbuddyVerification == null ? null : mapLootbuddyVerification(row.lootbuddyVerification),
    character: character
      ? {
          id: asString(character.id),
          name: asString(character.name),
          realm: asString(character.realm),
        }
      : null,
    run: {
      id: asString(run.id),
      title: asString(run.title),
      status: mapRunStatus(run.status),
      difficulty: mapDifficulty(run.difficulty),
      scheduledStartAt: asString(run.scheduledStartAt),
      raid: { name: asString(raid.name, "Unknown raid") },
    },
  };
}

export type SignupWriteInput = {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
  isBackup: boolean;
  status: SignupStatus;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyVerification: LootbuddyVerification | null;
};

export const signupRepository = {
  async listByUserId(userId: string): Promise<SignupListRecord[]> {
    const signups = await orm.RunSignup
      .where({ userId })
      .include("run", (run) => run.include("raid").include("raidLead"))
      .include("character")
      .orderBy((signup) => signup.createdAt.desc())
      .all();

    return signups.map((row) => mapSignup(row as Record<string, unknown>));
  },

  async findById(id: string): Promise<SignupListRecord | null> {
    const signup = await orm.RunSignup
      .where({ id })
      .include("run", (run) => run.include("raid"))
      .include("character")
      .first();

    return signup ? mapSignup(signup as Record<string, unknown>) : null;
  },

  async findDuplicate(input: {
    runId: string;
    userId: string;
    characterId: string;
    participationType: ParticipationType;
  }): Promise<SignupListRecord | null> {
    const signup = await orm.RunSignup
      .where({
        runId: input.runId,
        userId: input.userId,
        characterId: input.characterId,
        participationType: input.participationType,
      })
      .include("run", (run) => run.include("raid"))
      .include("character")
      .first();

    return signup ? mapSignup(signup as Record<string, unknown>) : null;
  },

  async create(input: SignupWriteInput): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const created = await orm.RunSignup.create({
      id: crypto.randomUUID(),
      runId: input.runId,
      userId: input.userId,
      characterId: input.characterId,
      participationType: input.participationType,
      role: input.role,
      isBackup: input.isBackup,
      status: input.status,
      lootbuddyMode: input.lootbuddyMode,
      lootbuddyVerification: input.lootbuddyVerification,
      createdAt: now,
      updatedAt: now,
    });

    return { id: asString((created as Record<string, unknown>).id) };
  },

  async update(id: string, input: Partial<SignupWriteInput>) {
    const patch: Record<string, unknown> = {};
    if (input.characterId !== undefined) patch.characterId = input.characterId;
    if (input.participationType !== undefined) patch.participationType = input.participationType;
    if (input.role !== undefined) patch.role = input.role;
    if (input.isBackup !== undefined) patch.isBackup = input.isBackup;
    if (input.status !== undefined) patch.status = input.status;
    if (input.lootbuddyMode !== undefined) patch.lootbuddyMode = input.lootbuddyMode;
    if (input.lootbuddyVerification !== undefined) patch.lootbuddyVerification = input.lootbuddyVerification;
    await orm.RunSignup.where({ id }).update(patch);
  },

  async listByRunId(runId: string): Promise<SignupListRecord[]> {
    const signups = await orm.RunSignup
      .where({ runId })
      .include("run", (run) => run.include("raid"))
      .include("character")
      .orderBy((signup) => signup.createdAt.asc())
      .all();

    return signups.map((row) => mapSignup(row as Record<string, unknown>));
  },
};
