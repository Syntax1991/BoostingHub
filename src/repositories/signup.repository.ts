import { db, orm } from "@/lib/prisma";
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
import { DomainError } from "@/lib/errors";

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

  /** All of one User's signup rows on one Run, every status included — the full offer history. */
  async listByRunAndUser(runId: string, userId: string): Promise<SignupListRecord[]> {
    const signups = await orm.RunSignup
      .where({ runId, userId })
      .include("run", (run) => run.include("raid"))
      .include("character")
      .orderBy((signup) => signup.createdAt.asc())
      .all();

    return signups.map((row) => mapSignup(row as Record<string, unknown>));
  },

  /**
   * Executes one already-authorized, already-eligibility-checked reconciliation
   * plan atomically. Each planned mutation re-checks the row's current status
   * against fresh in-transaction reads immediately before writing it, so a
   * concurrent change (e.g. another request reactivating the same WITHDRAWN
   * row) fails the whole transaction instead of corrupting state — the plan
   * itself is not recomputed here, only defended at the row level.
   */
  async applyOfferPlan(input: {
    runId: string;
    userId: string;
    participationType: ParticipationType;
    toWithdraw: string[];
    toReactivate: Array<{
      id: string;
      characterId: string;
      role: CharacterRole | null;
      lootbuddyMode: LootbuddyMode | null;
      lootbuddyVerification: LootbuddyVerification | null;
    }>;
    toCreate: Array<{
      characterId: string;
      role: CharacterRole | null;
      lootbuddyMode: LootbuddyMode | null;
      lootbuddyVerification: LootbuddyVerification | null;
    }>;
    toUpdateRole: Array<{ id: string; role: CharacterRole | null }>;
  }): Promise<{ created: string[]; reactivated: string[]; withdrawn: string[] }> {
    const created: string[] = [];
    const reactivated: string[] = [];
    const withdrawn: string[] = [];

    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const now = new Date().toISOString();

      for (const id of input.toWithdraw) {
        const row = await txOrm.RunSignup.where({ id }).first();
        if (!row) continue;
        const status = mapSignupStatus((row as Record<string, unknown>).status);
        if (status === "WITHDRAWN") continue;
        await txOrm.RunSignup.where({ id }).update({ status: "WITHDRAWN", updatedAt: now });
        withdrawn.push(id);
      }

      for (const offer of input.toReactivate) {
        const row = await txOrm.RunSignup.where({ id: offer.id }).first();
        if (!row) {
          throw new DomainError("NOT_FOUND", "A previously offered character was removed.");
        }
        const status = mapSignupStatus((row as Record<string, unknown>).status);
        if (status !== "WITHDRAWN") {
          throw new DomainError(
            "INVALID_STATE_TRANSITION",
            "This offer changed since it was loaded. Please try again.",
          );
        }
        await txOrm.RunSignup.where({ id: offer.id }).update({
          status: "PENDING",
          role: offer.role,
          isBackup: false,
          lootbuddyMode: offer.lootbuddyMode,
          lootbuddyVerification: offer.lootbuddyVerification,
          updatedAt: now,
        });
        reactivated.push(offer.id);
      }

      for (const offer of input.toCreate) {
        const id = crypto.randomUUID();
        await txOrm.RunSignup.create({
          id,
          runId: input.runId,
          userId: input.userId,
          characterId: offer.characterId,
          participationType: input.participationType,
          role: offer.role,
          isBackup: false,
          status: "PENDING",
          lootbuddyMode: offer.lootbuddyMode,
          lootbuddyVerification: offer.lootbuddyVerification,
          createdAt: now,
          updatedAt: now,
        });
        created.push(id);
      }

      for (const update of input.toUpdateRole) {
        await txOrm.RunSignup.where({ id: update.id }).update({ role: update.role, updatedAt: now });
      }
    });

    return { created, reactivated, withdrawn };
  },
};

type TxOrm = typeof orm;
