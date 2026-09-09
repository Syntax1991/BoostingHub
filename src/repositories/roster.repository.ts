import { db, orm } from "@/lib/prisma";
import type {
  CharacterRole,
  LootbuddyMode,
  LootbuddyVerification,
  ParticipationType,
  RaidDifficulty,
  RosterState,
  RunStatus,
  SignupStatus,
  WowClass,
} from "@/models/enums";
import type { BoosterAccessMatch } from "@/models/records";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapAccessStatus,
  mapCharacterRole,
  mapDifficulty,
  mapLootbuddyMode,
  mapLootbuddyVerification,
  mapParticipation,
  mapRosterState,
  mapSignupStatus,
  mapWowClass,
} from "@/lib/persistence";
import { DomainError } from "@/lib/errors";

export type RosterCharacterSnapshot = {
  id: string;
  name: string;
  realm: string;
  wowClass: WowClass;
  specialization: string | null;
  primaryRole: CharacterRole;
  itemLevel: number;
  isActive: boolean;
  boosterAccess: BoosterAccessMatch[];
  lockouts: Array<{
    raidId: string;
    difficulty: RaidDifficulty;
    resetIdentifier: string;
    isComplete: boolean;
    bossesDefeated: number;
  }>;
};

export type RosterSignupRow = {
  id: string;
  runId: string;
  userId: string;
  userName: string;
  status: SignupStatus;
  participationType: ParticipationType;
  role: CharacterRole | null;
  isBackup: boolean;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyVerification: LootbuddyVerification | null;
  character: RosterCharacterSnapshot | null;
};

export type RosterRecord = {
  id: string;
  runId: string;
  state: RosterState;
  version: number;
  publishedAt: string | null;
  publishedById: string | null;
  publishedByName: string | null;
  selectedSignupIds: string[];
};

function mapCharacter(row: Record<string, unknown>): RosterCharacterSnapshot {
  const access = Array.isArray(row.boosterAccess) ? row.boosterAccess : [];
  const lockouts = Array.isArray(row.lockouts) ? row.lockouts : [];
  return {
    id: asString(row.id),
    name: asString(row.name),
    realm: asString(row.realm),
    wowClass: mapWowClass(row.wowClass),
    specialization: asStringOrNull(row.specialization),
    primaryRole: mapCharacterRole(row.primaryRole),
    itemLevel: asNumber(row.itemLevel),
    isActive: asBoolean(row.isActive, true),
    boosterAccess: access.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        wowClass: mapWowClass(record.wowClass),
        role: mapCharacterRole(record.role),
        difficulty: mapDifficulty(record.difficulty),
        status: mapAccessStatus(record.status),
      };
    }),
    lockouts: lockouts.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        raidId: asString(record.raidId),
        difficulty: mapDifficulty(record.difficulty),
        resetIdentifier: asString(record.resetIdentifier),
        isComplete: asBoolean(record.isComplete),
        bossesDefeated: asNumber(record.bossesDefeated),
      };
    }),
  };
}

function mapSignupRow(row: Record<string, unknown>): RosterSignupRow {
  const user = (row.user ?? {}) as Record<string, unknown>;
  const character = row.character ? (row.character as Record<string, unknown>) : null;
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    userId: asString(row.userId),
    userName: asString(user.name, "Unknown"),
    status: mapSignupStatus(row.status),
    participationType: mapParticipation(row.participationType),
    role: row.role == null ? null : mapCharacterRole(row.role),
    isBackup: asBoolean(row.isBackup),
    lootbuddyMode: row.lootbuddyMode == null ? null : mapLootbuddyMode(row.lootbuddyMode),
    lootbuddyVerification:
      row.lootbuddyVerification == null ? null : mapLootbuddyVerification(row.lootbuddyVerification),
    character: character ? mapCharacter(character) : null,
  };
}

function mapRoster(row: Record<string, unknown>): RosterRecord {
  const publisher = row.publishedBy ? (row.publishedBy as Record<string, unknown>) : null;
  const entries = Array.isArray(row.entries) ? row.entries : [];
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    state: mapRosterState(row.state),
    version: asNumber(row.version, 1),
    publishedAt: asStringOrNull(row.publishedAt),
    publishedById: asStringOrNull(row.publishedById),
    publishedByName: publisher ? asString(publisher.name) : null,
    selectedSignupIds: entries
      .filter((entry) => asBoolean((entry as Record<string, unknown>).selected, true))
      .map((entry) => asString((entry as Record<string, unknown>).signupId)),
  };
}

type TxOrm = typeof orm;

export const rosterRepository = {
  async findByRunId(runId: string): Promise<RosterRecord | null> {
    const row = await orm.RunRoster
      .where({ runId })
      .include("entries")
      .include("publishedBy")
      .first();
    return row ? mapRoster(row as Record<string, unknown>) : null;
  },

  async listSignups(runId: string): Promise<RosterSignupRow[]> {
    const rows = await orm.RunSignup
      .where({ runId })
      .include("user")
      .include("character", (character) => character.include("boosterAccess").include("lockouts"))
      .orderBy((signup) => signup.createdAt.asc())
      .all();
    return rows.map((row) => mapSignupRow(row as Record<string, unknown>));
  },

  async ensure(runId: string): Promise<RosterRecord> {
    const existing = await this.findByRunId(runId);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    try {
      await orm.RunRoster.create({
        id: crypto.randomUUID(),
        runId,
        state: "DRAFT",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      const raced = await this.findByRunId(runId);
      if (raced) {
        return raced;
      }
      throw error;
    }
    const created = await this.findByRunId(runId);
    if (!created) {
      throw new DomainError("NOT_FOUND", "Roster could not be created.");
    }
    return created;
  },

  async assertVersion(roster: RosterRecord, expectedVersion: number) {
    if (roster.version !== expectedVersion) {
      throw new DomainError(
        "ROSTER_ALREADY_CHANGED",
        "This roster changed since you loaded it. Refresh and try again.",
      );
    }
  },

  async replaceSelectedSignupIds(rosterId: string, expectedVersion: number, signupIds: string[]) {
    const roster = await orm.RunRoster.where({ id: rosterId }).include("entries").first();
    if (!roster) {
      throw new DomainError("NOT_FOUND", "Roster was not found.");
    }
    const mapped = mapRoster(roster as Record<string, unknown>);
    await this.assertVersion(mapped, expectedVersion);

    const current = new Set(mapped.selectedSignupIds);
    const next = new Set(signupIds);
    const now = new Date().toISOString();

    for (const signupId of current) {
      if (!next.has(signupId)) {
        await orm.RunRosterEntry.where({ rosterId, signupId }).delete();
      }
    }
    for (const signupId of next) {
      if (!current.has(signupId)) {
        await orm.RunRosterEntry.create({
          id: crypto.randomUUID(),
          rosterId,
          signupId,
          selected: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await orm.RunRoster.where({ id: rosterId }).update({
      version: mapped.version + 1,
      updatedAt: now,
    });
  },

  async setSignupSelected(input: {
    rosterId: string;
    expectedVersion: number;
    signupId: string;
    selected: boolean;
    replaceSignupIds: string[];
  }) {
    const roster = await this.findByRunIdFromId(input.rosterId);
    await this.assertVersion(roster, input.expectedVersion);
    const now = new Date().toISOString();

    for (const signupId of input.replaceSignupIds) {
      if (signupId !== input.signupId) {
        await orm.RunRosterEntry.where({ rosterId: input.rosterId, signupId }).delete();
      }
    }

    const existing = await orm.RunRosterEntry.where({ rosterId: input.rosterId, signupId: input.signupId }).first();
    if (input.selected && !existing) {
      await orm.RunRosterEntry.create({
        id: crypto.randomUUID(),
        rosterId: input.rosterId,
        signupId: input.signupId,
        selected: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!input.selected && existing) {
      await orm.RunRosterEntry.where({ id: asString((existing as Record<string, unknown>).id) }).delete();
    }

    await orm.RunRoster.where({ id: input.rosterId }).update({
      version: roster.version + 1,
      updatedAt: now,
    });
  },

  async findByRunIdFromId(rosterId: string): Promise<RosterRecord> {
    const row = await orm.RunRoster.where({ id: rosterId }).include("entries").include("publishedBy").first();
    if (!row) {
      throw new DomainError("NOT_FOUND", "Roster was not found.");
    }
    return mapRoster(row as Record<string, unknown>);
  },

  /**
   * Publication is one transaction: signup statuses, run status, roster metadata.
   * A thrown DomainError rolls the whole write back.
   */
  async publishAtomic(input: {
    runId: string;
    rosterId: string;
    expectedVersion: number;
    selectedSignupIds: string[];
    notSelectedSignupIds: string[];
    runStatus: RunStatus;
    fromStatus: RunStatus;
    publisherId: string;
  }) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const roster = await txOrm.RunRoster.where({ id: input.rosterId }).include("entries").first();
      if (!roster) {
        throw new DomainError("NOT_FOUND", "Roster was not found.");
      }
      const mapped = mapRoster(roster as Record<string, unknown>);
      if (mapped.version !== input.expectedVersion) {
        throw new DomainError(
          "ROSTER_ALREADY_CHANGED",
          "This roster changed since you loaded it. Refresh and try again.",
        );
      }

      const now = new Date().toISOString();
      for (const signupId of input.selectedSignupIds) {
        await txOrm.RunSignup.where({ id: signupId }).update({ status: "SELECTED" });
      }
      for (const signupId of input.notSelectedSignupIds) {
        await txOrm.RunSignup.where({ id: signupId }).update({ status: "NOT_SELECTED" });
      }
      if (input.fromStatus === "OPEN") {
        await txOrm.Run.where({ id: input.runId }).update({ status: "ROSTERING" });
      }
      if (input.fromStatus === "OPEN" || input.fromStatus === "ROSTERING") {
        await txOrm.Run.where({ id: input.runId }).update({ status: input.runStatus });
      }
      await txOrm.RunRoster.where({ id: input.rosterId }).update({
        state: "PUBLISHED",
        version: mapped.version + 1,
        publishedAt: now,
        publishedById: input.publisherId,
        updatedAt: now,
      });
      await txOrm.ActivityEvent.create({
        id: crypto.randomUUID(),
        userId: input.publisherId,
        type: mapped.publishedAt ? "ROSTER_UPDATED" : "ROSTER_PUBLISHED",
        message: mapped.publishedAt ? "Updated a published roster." : "Published a roster.",
        occurredAt: now,
      });
    });
  },
};
