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
  WowRegion,
} from "@/models/enums";
import type { BoosterQualificationMatch } from "@/models/records";
import {
  asBoolean,
  asNumber,
  asNumberOrNull,
  asString,
  asStringOrNull,
  mapCharacterRole,
  mapDifficulty,
  mapLootbuddyMode,
  mapLootbuddyVerification,
  mapParticipation,
  mapRegion,
  mapRosterState,
  mapSignupStatus,
  mapWowClass,
} from "@/lib/persistence";
import { DomainError } from "@/lib/errors";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import { mapOfferedRoles, queryReservationConflicts } from "@/repositories/signup.repository";

export type RosterCharacterSnapshot = {
  id: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: WowClass;
  specialization: string | null;
  primaryRole: CharacterRole;
  itemLevel: number | null;
  isActive: boolean;
  boosterQualifications: BoosterQualificationMatch[];
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
  discordUserId: string | null;
  status: SignupStatus;
  participationType: ParticipationType;
  /** Every role this BOOSTER offer volunteers for, TANK → HEALER → DPS. Always empty for LOOTBUDDY. */
  offeredRoles: CharacterRole[];
  /** The Raid Lead's assignment on the draft roster entry — null unless draft-selected as a BOOSTER. */
  selectedRole: CharacterRole | null;
  isBackup: boolean;
  /** Own Class snapshot for a characterless Lootbuddy row; null for BOOSTER and for legacy Character-backed Lootbuddy rows (fall back to character.wowClass for those). */
  lootbuddyClass: WowClass | null;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyVerification: LootbuddyVerification | null;
  character: RosterCharacterSnapshot | null;
};

/** One draft-selected roster slot: which signup, and the role the Raid Lead assigned it. */
export type RosterSelection = {
  signupId: string;
  selectedRole: CharacterRole | null;
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
  /** Same slots as `selectedSignupIds`, carrying each slot's assigned role. */
  selections: RosterSelection[];
};

function mapCharacter(row: Record<string, unknown>): RosterCharacterSnapshot {
  const lockouts = Array.isArray(row.lockouts) ? row.lockouts : [];
  return {
    id: asString(row.id),
    name: asString(row.name),
    realm: asString(row.realm),
    region: mapRegion(row.region),
    wowClass: mapWowClass(row.wowClass),
    specialization: asStringOrNull(row.specialization),
    primaryRole: mapCharacterRole(row.primaryRole),
    itemLevel: asNumberOrNull(row.itemLevel),
    isActive: asBoolean(row.isActive, true),
    // Hydrated from account-level BoosterQualification after signup load.
    boosterQualifications: [],
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
  const rosterEntries = Array.isArray(row.rosterEntries) ? (row.rosterEntries as Record<string, unknown>[]) : [];
  const selectedEntry = rosterEntries.find((entry) => asBoolean(entry.selected, true));
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    userId: asString(row.userId),
    userName: asString(user.name, "Unknown"),
    discordUserId: asStringOrNull(user.discordUserId),
    status: mapSignupStatus(row.status),
    participationType: mapParticipation(row.participationType),
    offeredRoles: mapOfferedRoles(row.offeredRoles),
    selectedRole:
      selectedEntry?.selectedRole == null ? null : mapCharacterRole(selectedEntry.selectedRole),
    isBackup: asBoolean(row.isBackup),
    lootbuddyClass: row.lootbuddyClass == null ? null : mapWowClass(row.lootbuddyClass),
    lootbuddyMode: row.lootbuddyMode == null ? null : mapLootbuddyMode(row.lootbuddyMode),
    lootbuddyVerification:
      row.lootbuddyVerification == null ? null : mapLootbuddyVerification(row.lootbuddyVerification),
    character: character ? mapCharacter(character) : null,
  };
}

async function withAccountBoosterQualifications(signups: RosterSignupRow[]): Promise<RosterSignupRow[]> {
  const userIds = [...new Set(signups.map((signup) => signup.userId))];
  if (userIds.length === 0) return signups;

  const rows = await boosterQualificationRepository.listByUserIds(userIds);
  const qualificationsByUser = new Map<string, BoosterQualificationMatch[]>();
  for (const row of rows) {
    const list = qualificationsByUser.get(row.userId) ?? [];
    list.push({ difficulty: row.difficulty, status: row.status });
    qualificationsByUser.set(row.userId, list);
  }

  return signups.map((signup) => {
    if (!signup.character) return signup;
    return {
      ...signup,
      character: {
        ...signup.character,
        boosterQualifications: qualificationsByUser.get(signup.userId) ?? [],
      },
    };
  });
}

function mapRoster(row: Record<string, unknown>): RosterRecord {
  const publisher = row.publishedBy ? (row.publishedBy as Record<string, unknown>) : null;
  const entries = Array.isArray(row.entries) ? (row.entries as Record<string, unknown>[]) : [];
  const selections: RosterSelection[] = entries
    .filter((entry) => asBoolean(entry.selected, true))
    .map((entry) => ({
      signupId: asString(entry.signupId),
      selectedRole: entry.selectedRole == null ? null : mapCharacterRole(entry.selectedRole),
    }));
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    state: mapRosterState(row.state),
    version: asNumber(row.version, 1),
    publishedAt: asStringOrNull(row.publishedAt),
    publishedById: asStringOrNull(row.publishedById),
    publishedByName: publisher ? asString(publisher.name) : null,
    selectedSignupIds: selections.map((selection) => selection.signupId),
    selections,
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

  /**
   * Live published roster participants: roster entries that are selected and whose
   * signup is currently SELECTED. Replacement draft flags are ignored.
   */
  async listPublishedSelectedEntries(runId: string): Promise<Array<{ id: string; signupId: string }>> {
    const row = await orm.RunRoster
      .where({ runId })
      .include("entries", (entry) => entry.include("signup"))
      .first();
    if (!row || !asStringOrNull((row as Record<string, unknown>).publishedAt)) {
      return [];
    }
    const entries = Array.isArray((row as Record<string, unknown>).entries)
      ? ((row as Record<string, unknown>).entries as Record<string, unknown>[])
      : [];
    return entries
      .map((entry) => {
        const signup = entry.signup as Record<string, unknown> | undefined;
        return {
          id: asString(entry.id),
          signupId: asString(entry.signupId),
          selected: asBoolean(entry.selected, true),
          signupStatus: signup ? mapSignupStatus(signup.status) : ("PENDING" as const),
        };
      })
      .filter((entry) => entry.selected && entry.signupStatus === "SELECTED")
      .map((entry) => ({ id: entry.id, signupId: entry.signupId }));
  },

  async listSignups(runId: string): Promise<RosterSignupRow[]> {
    const rows = await orm.RunSignup
      .where({ runId })
      .include("user")
      .include("character", (character) => character.include("lockouts"))
      .include("offeredRoles")
      .include("rosterEntries")
      .orderBy((signup) => signup.createdAt.asc())
      .all();
    const signups = rows.map((row) => mapSignupRow(row as Record<string, unknown>));
    return withAccountBoosterQualifications(signups);
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

  /**
   * Atomically replace the full draft selection set — including each slot's
   * assigned role — and bump version once. A slot that stays selected keeps
   * its existing entry row (and therefore its attendance/payout identity);
   * only its `selectedRole` is rewritten. Optional race-safety nets re-check
   * WITHDRAWN and cross-Run reservations inside the transaction (batch save
   * path). Seed/prepare callers may omit them.
   */
  async replaceSelectedSignupIds(
    rosterId: string,
    expectedVersion: number,
    selections: RosterSelection[],
    options?: {
      targetRunId?: string;
      scheduledStartAt?: string;
      selectedCharacterIds?: string[];
    },
  ) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const roster = await txOrm.RunRoster.where({ id: rosterId }).include("entries").first();
      if (!roster) {
        throw new DomainError("NOT_FOUND", "Roster was not found.");
      }
      const mapped = mapRoster(roster as Record<string, unknown>);
      await this.assertVersion(mapped, expectedVersion);

      const nextBySignupId = new Map(selections.map((selection) => [selection.signupId, selection]));
      const next = new Set(nextBySignupId.keys());
      const now = new Date().toISOString();

      for (const signupId of next) {
        const signupRow = await txOrm.RunSignup.where({ id: signupId }).first();
        if (!signupRow) {
          throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
        }
        const status = mapSignupStatus((signupRow as Record<string, unknown>).status);
        if (status === "WITHDRAWN") {
          throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
        }
      }

      if (
        options?.selectedCharacterIds &&
        options.selectedCharacterIds.length > 0 &&
        options.targetRunId &&
        options.scheduledStartAt
      ) {
        const conflicts = await queryReservationConflicts(txOrm, {
          characterIds: options.selectedCharacterIds,
          targetRunId: options.targetRunId,
          scheduledStartAt: options.scheduledStartAt,
        });
        if (conflicts.length > 0) {
          throw new DomainError(
            "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
            `That character was just selected for ${conflicts[0].runTitle}. Please try again.`,
          );
        }
      }

      const current = new Map(mapped.selections.map((selection) => [selection.signupId, selection]));
      for (const signupId of current.keys()) {
        if (!next.has(signupId)) {
          await txOrm.RunRosterEntry.where({ rosterId, signupId }).delete();
        }
      }
      for (const [signupId, selection] of nextBySignupId) {
        const existing = current.get(signupId);
        if (!existing) {
          await txOrm.RunRosterEntry.create({
            id: crypto.randomUUID(),
            rosterId,
            signupId,
            selected: true,
            selectedRole: selection.selectedRole,
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }
        if (existing.selectedRole !== selection.selectedRole) {
          await txOrm.RunRosterEntry.where({ rosterId, signupId }).update({
            selectedRole: selection.selectedRole,
            updatedAt: now,
          });
        }
      }

      await txOrm.RunRoster.where({ id: rosterId }).update({
        version: mapped.version + 1,
        updatedAt: now,
      });
    });
  },

  /**
   * Selection is revalidated transactionally, not trusted from the caller's
   * earlier read: immediately before writing, the signup is re-fetched fresh
   * and rejected if it became WITHDRAWN since the caller loaded its view (a
   * User could have withdrawn the offer between the raid lead's page load and
   * their click). RunRoster.version alone does not close that gap — it only
   * detects a second roster mutation, not a signup mutation.
   */
  async setSignupSelected(input: {
    rosterId: string;
    expectedVersion: number;
    signupId: string;
    selected: boolean;
    /** The role assigned to this slot; always null for LOOTBUDDY and when deselecting. */
    selectedRole: CharacterRole | null;
    replaceSignupIds: string[];
    /** Null when the signup's Character was deleted — no reservation is possible for it. */
    characterId: string | null;
    targetRunId: string;
    scheduledStartAt: string;
  }) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const rosterRow = await txOrm.RunRoster.where({ id: input.rosterId }).include("entries").include("publishedBy").first();
      if (!rosterRow) {
        throw new DomainError("NOT_FOUND", "Roster was not found.");
      }
      const roster = mapRoster(rosterRow as Record<string, unknown>);
      await this.assertVersion(roster, input.expectedVersion);
      const now = new Date().toISOString();

      if (input.selected) {
        const signupRow = await txOrm.RunSignup.where({ id: input.signupId }).first();
        if (!signupRow) {
          throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
        }
        const status = mapSignupStatus((signupRow as Record<string, unknown>).status);
        if (status === "WITHDRAWN") {
          throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
        }

        // Race-safety net: the caller already checked cross-Run reservation
        // before opening this transaction, but another raid lead could have
        // reserved the same Character elsewhere in between.
        if (input.characterId) {
          const conflicts = await queryReservationConflicts(txOrm, {
            characterIds: [input.characterId],
            targetRunId: input.targetRunId,
            scheduledStartAt: input.scheduledStartAt,
          });
          if (conflicts.length > 0) {
            throw new DomainError(
              "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
              `That character was just selected for ${conflicts[0].runTitle}. Please try again.`,
            );
          }
        }
      }

      for (const signupId of input.replaceSignupIds) {
        if (signupId !== input.signupId) {
          await txOrm.RunRosterEntry.where({ rosterId: input.rosterId, signupId }).delete();
        }
      }

      const existing = await txOrm.RunRosterEntry.where({ rosterId: input.rosterId, signupId: input.signupId }).first();
      if (input.selected && !existing) {
        await txOrm.RunRosterEntry.create({
          id: crypto.randomUUID(),
          rosterId: input.rosterId,
          signupId: input.signupId,
          selected: true,
          selectedRole: input.selectedRole,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (input.selected && existing) {
        await txOrm.RunRosterEntry.where({ id: asString((existing as Record<string, unknown>).id) }).update({
          selectedRole: input.selectedRole,
          updatedAt: now,
        });
      }
      if (!input.selected && existing) {
        await txOrm.RunRosterEntry.where({ id: asString((existing as Record<string, unknown>).id) }).delete();
      }

      await txOrm.RunRoster.where({ id: input.rosterId }).update({
        version: roster.version + 1,
        updatedAt: now,
      });
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
    /** Characters behind selectedSignupIds — re-verified for cross-Run reservation immediately before publish. */
    selectedCharacterIds: string[];
    scheduledStartAt: string;
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

      // Race-safety net: the caller already checked cross-Run reservation
      // before opening this transaction, but another Run could have reserved
      // one of these Characters in between.
      if (input.selectedCharacterIds.length > 0) {
        const conflicts = await queryReservationConflicts(txOrm, {
          characterIds: input.selectedCharacterIds,
          targetRunId: input.runId,
          scheduledStartAt: input.scheduledStartAt,
        });
        if (conflicts.length > 0) {
          throw new DomainError(
            "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
            "One or more selected characters were just reserved for another run at the same time. Refresh and try again.",
          );
        }
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
