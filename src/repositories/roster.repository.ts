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
import { mapExternalBoosters, type ExternalBooster, type ExternalBoosterInput } from "@/lib/external-booster";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import { mapOfferedRoles, queryReservationConflicts } from "@/repositories/signup.repository";
import {
  rosterRemovedSourceKey,
  rosterSelectedSourceKey,
  rosterSwappedSourceKey,
  rosterWithdrawnSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import {
  resolveDiscordDelivery,
  rosterRemovedWebNotification,
  rosterSelectedWebNotification,
  rosterSwappedWebNotification,
  rosterWithdrawnWebNotification,
  type NotificationAssignmentInput,
} from "@/services/notification-content";
import { quietHoursDeliveryContextFromUserRow } from "@/services/notification-delivery-context";

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
  /** Informational WCL profile id — never a schedule or eligibility gate. */
  warcraftLogsId: string | null;
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
  /** Mutable saved draft assignment on the selected RunRosterEntry — null unless draft-selected as a BOOSTER. */
  selectedRole: CharacterRole | null;
  /** Live published BOOSTER role (null unless status is SELECTED and participation is BOOSTER). */
  publishedRole: CharacterRole | null;
  isBackup: boolean;
  /** Own Class snapshot for a characterless Lootbuddy row; null for BOOSTER and for legacy Character-backed Lootbuddy rows (fall back to character.wowClass for those). */
  lootbuddyClass: WowClass | null;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyVerification: LootbuddyVerification | null;
  character: RosterCharacterSnapshot | null;
  /** Reason a picked player gave when withdrawing; null otherwise. */
  withdrawReason: string | null;
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
  /** Unregistered boosters the Raid Lead added by hand (see lib/external-booster.ts). */
  externalBoosters: ExternalBooster[];
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
    warcraftLogsId: asStringOrNull(row.warcraftLogsId),
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
    publishedRole: row.publishedRole == null ? null : mapCharacterRole(row.publishedRole),
    isBackup: asBoolean(row.isBackup),
    lootbuddyClass: row.lootbuddyClass == null ? null : mapWowClass(row.lootbuddyClass),
    lootbuddyMode: row.lootbuddyMode == null ? null : mapLootbuddyMode(row.lootbuddyMode),
    lootbuddyVerification:
      row.lootbuddyVerification == null ? null : mapLootbuddyVerification(row.lootbuddyVerification),
    character: character ? mapCharacter(character) : null,
    withdrawReason: asStringOrNull(row.withdrawReason),
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
    externalBoosters: mapExternalBoosters(row.externalBoosters),
  };
}

type TxOrm = typeof orm;

export const rosterRepository = {
  async findByRunId(runId: string): Promise<RosterRecord | null> {
    const row = await orm.RunRoster
      .where({ runId })
      .include("entries")
      .include("externalBoosters")
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
      /**
       * Save Roster: tell players about the saved selection right away
       * (see notifyRosterSelectionChangesInTx). Omitted when seeding a draft.
       */
      notify?: { runId: string; runTitle: string };
      /**
       * Save Roster: the full set of external boosters, replacing the saved
       * ones. Omitted (undefined) leaves them untouched, e.g. when seeding.
       */
      externalBoosters?: ExternalBoosterInput[];
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

      if (options?.externalBoosters) {
        await replaceExternalBoostersInTx(txOrm, rosterId, options.externalBoosters);
      }

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
          excludeRunId: options.targetRunId,
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

      if (options?.notify) {
        await notifyRosterSelectionChangesInTx(txOrm, {
          runId: options.notify.runId,
          runTitle: options.notify.runTitle,
          version: mapped.version + 1,
          selections,
          now,
        });
      }
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

      // Race-safety net for NEW draft selection only. Already-selected Characters
      // that later become conflicted stay on the roster until publish revalidates.
      if (input.selected) {
        const signupRow = await txOrm.RunSignup.where({ id: input.signupId }).first();
        if (!signupRow) {
          throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
        }
        const status = mapSignupStatus((signupRow as Record<string, unknown>).status);
        if (status === "WITHDRAWN") {
          throw new DomainError("SIGNUP_WITHDRAWN", "Withdrawn signups cannot be selected.");
        }
      }

      for (const signupId of input.replaceSignupIds) {
        if (signupId !== input.signupId) {
          await txOrm.RunRosterEntry.where({ rosterId: input.rosterId, signupId }).delete();
        }
      }

      const existing = await txOrm.RunRosterEntry.where({ rosterId: input.rosterId, signupId: input.signupId }).first();
      if (input.selected && input.characterId && !existing) {
        const conflicts = await queryReservationConflicts(txOrm, {
          characterIds: [input.characterId],
          excludeRunId: input.targetRunId,
          scheduledStartAt: input.scheduledStartAt,
        });
        if (conflicts.length > 0) {
          throw new DomainError(
            "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
            `That character was just selected for ${conflicts[0].runTitle}. Please try again.`,
          );
        }
      }

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
   * Drop draft roster slots for withdrawn/deleted signups and bump affected
   * roster versions so managers refresh. Idempotent when no entries exist.
   */
  async clearDraftSelectionsForSignupIds(signupIds: readonly string[]): Promise<void> {
    const uniqueIds = [...new Set(signupIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return;
    }
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const bumpedRosterIds = new Set<string>();
      for (const signupId of uniqueIds) {
        const entries = await txOrm.RunRosterEntry.where({ signupId }).all();
        for (const entry of entries) {
          const row = entry as Record<string, unknown>;
          const rosterId = asString(row.rosterId);
          await txOrm.RunRosterEntry.where({ id: asString(row.id) }).delete();
          bumpedRosterIds.add(rosterId);
        }
      }
      for (const rosterId of bumpedRosterIds) {
        const roster = await txOrm.RunRoster.where({ id: rosterId }).first();
        if (!roster) continue;
        await txOrm.RunRoster.where({ id: rosterId }).update({
          version: asNumber((roster as Record<string, unknown>).version, 1) + 1,
          updatedAt: now,
        });
      }
    });
  },

  /**
   * Replaces the roster's external boosters on their own (the Run header's
   * External Boosters dialog) and bumps the roster version once, so the
   * Discord roster / Final Setup posts refresh. Optimistic on `expectedVersion`.
   */
  async replaceExternalBoosters(rosterId: string, expectedVersion: number, boosters: ExternalBoosterInput[]) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const roster = await txOrm.RunRoster.where({ id: rosterId }).first();
      if (!roster) {
        throw new DomainError("NOT_FOUND", "Roster was not found.");
      }
      const version = asNumber((roster as Record<string, unknown>).version, 1);
      if (version !== expectedVersion) {
        throw new DomainError(
          "ROSTER_ALREADY_CHANGED",
          "This roster changed since you loaded it. Refresh and try again.",
        );
      }
      await replaceExternalBoostersInTx(txOrm, rosterId, boosters);
      await txOrm.RunRoster.where({ id: rosterId }).update({
        version: version + 1,
        updatedAt: new Date().toISOString(),
      });
    });
  },

  /**
   * A picked player (published SELECTED or in the saved draft) withdraws with
   * a reason, in one transaction:
   * - the signup becomes WITHDRAWN (published role cleared, reason stored)
   * - its roster entry is removed, freeing the slot
   * - the roster version is bumped, so the Discord signup/roster posts refresh
   * - the Run's Raid Lead gets a ROSTER_WITHDRAWN notification (web + DM)
   *
   * The caller has already checked ownership, run status and that the signup
   * is picked; this re-checks the signup is still active inside the transaction.
   */
  async withdrawPickedSignupAtomic(input: {
    runId: string;
    runTitle: string;
    signupId: string;
    reason: string;
    raidLeadId: string;
    playerName: string;
    characterLabel: string | null;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const signup = (await txOrm.RunSignup.where({ id: input.signupId }).first()) as Record<string, unknown> | null;
      if (!signup) {
        throw new DomainError("NOT_FOUND", "Signup was not found.", 404);
      }
      const status = mapSignupStatus(signup.status);
      if (status === "WITHDRAWN" || status === "NOT_SELECTED") {
        throw new DomainError("INVALID_STATE_TRANSITION", "This signup is no longer on the roster.");
      }

      const now = new Date().toISOString();
      await txOrm.RunSignup.where({ id: input.signupId }).update({
        status: "WITHDRAWN",
        publishedRole: null,
        withdrawReason: input.reason,
        updatedAt: now,
      });

      const roster = (await txOrm.RunRoster.where({ runId: input.runId }).first()) as Record<string, unknown> | null;
      let version = 1;
      if (roster) {
        const rosterId = asString(roster.id);
        const entries = await txOrm.RunRosterEntry.where({ rosterId, signupId: input.signupId }).all();
        for (const entry of entries as Array<Record<string, unknown>>) {
          await txOrm.RunRosterEntry.where({ id: asString(entry.id) }).delete();
        }
        version = asNumber(roster.version, 1) + 1;
        await txOrm.RunRoster.where({ id: rosterId }).update({ version, updatedAt: now });
      }

      await txOrm.ActivityEvent.create({
        id: crypto.randomUUID(),
        userId: asString(signup.userId),
        type: "SIGNUP_WITHDRAWN",
        message: `${input.playerName} withdrew from the roster for ${input.runTitle}.`,
        occurredAt: now,
      });

      // A Raid Lead withdrawing their own slot needs no notification.
      if (input.raidLeadId === asString(signup.userId)) return;

      const leadRow = (await txOrm.User.where({ id: input.raidLeadId }).first()) as Record<string, unknown> | null;
      const { quietHours, timeZone } = quietHoursDeliveryContextFromUserRow(leadRow);
      const delivery = resolveDiscordDelivery({
        discordDmEnabled: leadRow ? leadRow.discordDmEnabled !== false : true,
        // No per-event toggle: a Raid Lead always wants to know their roster lost a player.
        eventDmEnabled: true,
        discordUserId: leadRow ? asStringOrNull(leadRow.discordUserId) : null,
        quietHours,
        timeZone,
      });
      const copy = rosterWithdrawnWebNotification({
        runId: input.runId,
        runTitle: input.runTitle,
        playerName: input.playerName,
        characterLabel: input.characterLabel,
        reason: input.reason,
      });
      await userNotificationRepository.createInTx(txOrm, {
        userId: input.raidLeadId,
        type: "ROSTER_WITHDRAWN",
        runId: input.runId,
        signupId: input.signupId,
        sourceKey: rosterWithdrawnSourceKey(input.runId, version, input.signupId),
        title: copy.title,
        message: copy.message,
        href: copy.href,
        discordDeliveryStatus: delivery.status,
        discordUserId: delivery.discordUserId,
        discordDeliverAfter: delivery.discordDeliverAfter,
        createdAt: now,
      });
    });
  },

  /**
   * Publication is one transaction: signup statuses + publishedRole snapshot,
   * run status, and roster metadata. A thrown DomainError rolls the whole write back.
   */
  async publishAtomic(input: {
    runId: string;
    rosterId: string;
    expectedVersion: number;
    /** Draft selections being published — each BOOSTER carries its assigned role. */
    selectedSelections: Array<{ signupId: string; selectedRole: CharacterRole | null }>;
    /** Characters behind selectedSelections — re-verified for cross-Run reservation immediately before publish. */
    selectedCharacterIds: string[];
    scheduledStartAt: string;
    notSelectedSignupIds: string[];
    runStatus: RunStatus;
    fromStatus: RunStatus;
    publisherId: string;
    /** Display title for ROSTER_SELECTED web/DM copy. */
    runTitle: string;
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
          excludeRunId: input.runId,
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
      const nextVersion = mapped.version + 1;
      // Before the status writes below: legacy signups without roster
      // notifications fall back to their current SELECTED status.
      await notifyRosterSelectionChangesInTx(txOrm, {
        runId: input.runId,
        runTitle: input.runTitle,
        version: nextVersion,
        selections: input.selectedSelections,
        now,
      });
      for (const selection of input.selectedSelections) {
        await txOrm.RunSignup.where({ id: selection.signupId }).update({
          status: "SELECTED",
          publishedRole: selection.selectedRole,
        });
      }
      for (const signupId of input.notSelectedSignupIds) {
        await txOrm.RunSignup.where({ id: signupId }).update({
          status: "NOT_SELECTED",
          publishedRole: null,
        });
      }
      if (input.fromStatus === "OPEN") {
        await txOrm.Run.where({ id: input.runId }).update({ status: "ROSTERING" });
      }
      if (input.fromStatus === "OPEN" || input.fromStatus === "ROSTERING") {
        await txOrm.Run.where({ id: input.runId }).update({ status: input.runStatus });
      }
      await txOrm.RunRoster.where({ id: input.rosterId }).update({
        state: "PUBLISHED",
        version: nextVersion,
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


/** Replaces the full external booster set of a roster, keeping the listed order. */
async function replaceExternalBoostersInTx(
  txOrm: TxOrm,
  rosterId: string,
  boosters: readonly ExternalBoosterInput[],
): Promise<void> {
  const saved = await txOrm.RunExternalBooster.where({ rosterId }).all();
  for (const row of saved as Array<Record<string, unknown>>) {
    await txOrm.RunExternalBooster.where({ id: asString(row.id) }).delete();
  }
  // One millisecond apart so the saved order is the order they were listed in.
  const base = Date.now();
  for (const [index, booster] of boosters.entries()) {
    const createdAt = new Date(base + index).toISOString();
    await txOrm.RunExternalBooster.create({
      id: crypto.randomUUID(),
      rosterId,
      name: booster.name,
      wowClass: booster.wowClass,
      participationType: booster.participationType ?? "BOOSTER",
      role: (booster.participationType ?? "BOOSTER") === "LOOTBUDDY" ? null : booster.role,
      createdAt,
      updatedAt: createdAt,
    });
  }
}

type RosterNotificationSelection = { signupId: string; selectedRole: CharacterRole | null };

/**
 * Roster notifications (web + Discord DM) follow what each signup was last
 * told — its latest ROSTER_SELECTED / ROSTER_REMOVED — not its signup status.
 * Save Roster and Publish both call this, so a player hears "selected" once
 * (on whichever comes first) and "removed" once when a later save or publish
 * drops them. Signups with no roster notification yet (published before this
 * rule existed) fall back to their SELECTED status. Withdrawn signups are
 * never told they were removed.
 */
async function notifyRosterSelectionChangesInTx(
  txOrm: TxOrm,
  input: {
    runId: string;
    runTitle: string;
    /** Roster version this change produces — part of each notification's idempotency key. */
    version: number;
    selections: RosterNotificationSelection[];
    now: string;
  },
): Promise<void> {
  const lastBySignupId = new Map<string, { version: number; selected: boolean }>();
  const notifications = await txOrm.UserNotification.where({ runId: input.runId }).all();
  for (const row of notifications as Array<Record<string, unknown>>) {
    const type = asString(row.type);
    const signupId = asStringOrNull(row.signupId);
    if (!signupId || (type !== "ROSTER_SELECTED" && type !== "ROSTER_REMOVED")) continue;
    // sourceKey is `roster-{selected|removed}:<runId>:<version>:<signupId>`; the
    // strictly increasing roster version orders them without relying on timestamps.
    const version = Number(asString(row.sourceKey).split(":")[2]);
    const previous = lastBySignupId.get(signupId);
    if (!previous || version > previous.version) {
      lastBySignupId.set(signupId, { version, selected: type === "ROSTER_SELECTED" });
    }
  }

  const signups = await txOrm.RunSignup.where({ runId: input.runId }).all();
  const statusBySignupId = new Map(
    (signups as Array<Record<string, unknown>>).map((row) => [asString(row.id), asString(row.status)]),
  );
  const signupById = new Map(
    (signups as Array<Record<string, unknown>>).map((row) => [
      asString(row.id),
      { userId: asString(row.userId), participationType: asString(row.participationType) },
    ]),
  );
  const isNotifiedSelected = (signupId: string) =>
    lastBySignupId.get(signupId)?.selected ?? statusBySignupId.get(signupId) === "SELECTED";

  const selectedIds = new Set(input.selections.map((selection) => selection.signupId));
  const isLeaving = (signupId: string) =>
    !selectedIds.has(signupId) && isNotifiedSelected(signupId) && statusBySignupId.get(signupId) !== "WITHDRAWN";
  // A player holds at most one booster slot. A booster signup that leaves while
  // another booster signup of the same player joins is a character swap: the
  // player gets one "Roster Update" for the new character, and the old one's
  // removal is only recorded (read, no DM) to keep this state.
  const boosterUsersLeaving = new Set(
    [...statusBySignupId.keys()]
      .filter((signupId) => isLeaving(signupId) && signupById.get(signupId)?.participationType === "BOOSTER")
      .map((signupId) => signupById.get(signupId)!.userId),
  );
  const boosterUsersStillSelected = new Set(
    input.selections
      .map((selection) => signupById.get(selection.signupId))
      .filter((signup) => signup?.participationType === "BOOSTER")
      .map((signup) => signup!.userId),
  );
  for (const selection of input.selections) {
    if (!isNotifiedSelected(selection.signupId)) {
      const signup = signupById.get(selection.signupId);
      const swap = signup?.participationType === "BOOSTER" && boosterUsersLeaving.has(signup.userId);
      await createRosterSelectedNotificationInTx(txOrm, { ...input, selection, swap });
    }
  }
  for (const signupId of statusBySignupId.keys()) {
    if (selectedIds.has(signupId) || !isNotifiedSelected(signupId)) continue;
    if (statusBySignupId.get(signupId) === "WITHDRAWN") continue;
    const signup = signupById.get(signupId);
    const swapped = signup?.participationType === "BOOSTER" && boosterUsersStillSelected.has(signup.userId);
    await createRosterRemovedNotificationInTx(txOrm, { ...input, signupId, silent: swapped });
  }
}

async function createRosterSelectedNotificationInTx(
  txOrm: TxOrm,
  input: {
    runId: string;
    runTitle: string;
    version: number;
    now: string;
    selection: RosterNotificationSelection;
    /** Character swap of a player already in the roster — rendered as "Roster Update". */
    swap?: boolean;
  },
): Promise<void> {
  const signup = (await txOrm.RunSignup.where({ id: input.selection.signupId })
    .include("character")
    .include("user")
    .first()) as Record<string, unknown> | null;
  if (!signup) return;

  const userId = asString(signup.userId);
  let userRow = (signup.user as Record<string, unknown> | undefined) ?? null;
  if (!userRow) {
    userRow = ((await txOrm.User.where({ id: userId }).first()) as Record<string, unknown> | null) ?? null;
  }
  const discordDmEnabled = userRow ? userRow.discordDmEnabled !== false : true;
  const eventDmEnabled = userRow ? userRow.dmRosterSelectedEnabled !== false : true;
  const discordUserId = userRow ? asStringOrNull(userRow.discordUserId) : null;

  const participationType = mapParticipation(signup.participationType);
  const character = signup.character ? (signup.character as Record<string, unknown>) : null;
  const assignment: NotificationAssignmentInput = {
    participationType,
    publishedRole: input.selection.selectedRole,
    characterName: character ? asStringOrNull(character.name) : null,
    characterRealm: character ? asStringOrNull(character.realm) : null,
    wowClass:
      participationType === "LOOTBUDDY"
        ? signup.lootbuddyClass != null
          ? mapWowClass(signup.lootbuddyClass)
          : character
            ? mapWowClass(character.wowClass)
            : null
        : character
          ? mapWowClass(character.wowClass)
          : null,
  };
  const copy = (input.swap ? rosterSwappedWebNotification : rosterSelectedWebNotification)({
    runId: input.runId,
    runTitle: input.runTitle,
    assignment,
  });
  const { quietHours, timeZone } = quietHoursDeliveryContextFromUserRow(userRow);
  const discordDmDelivery = resolveDiscordDelivery({
    discordDmEnabled,
    eventDmEnabled,
    discordUserId,
    quietHours,
    timeZone,
  });
  await userNotificationRepository.createInTx(txOrm, {
    userId,
    type: "ROSTER_SELECTED",
    runId: input.runId,
    signupId: input.selection.signupId,
    sourceKey: (input.swap ? rosterSwappedSourceKey : rosterSelectedSourceKey)(
      input.runId,
      input.version,
      input.selection.signupId,
    ),
    title: copy.title,
    message: copy.message,
    href: copy.href,
    discordDeliveryStatus: discordDmDelivery.status,
    discordUserId: discordDmDelivery.discordUserId,
    discordDeliverAfter: discordDmDelivery.discordDeliverAfter,
    createdAt: input.now,
  });
}

async function createRosterRemovedNotificationInTx(
  txOrm: TxOrm,
  input: {
    runId: string;
    runTitle: string;
    version: number;
    now: string;
    signupId: string;
    /** Record only: no Discord DM and already read (a character swap, not a removal). */
    silent?: boolean;
  },
): Promise<void> {
  const signup = (await txOrm.RunSignup.where({ id: input.signupId })
    .include("character")
    .include("user")
    .first()) as Record<string, unknown> | null;
  if (!signup) return;

  const userId = asString(signup.userId);
  let userRow = (signup.user as Record<string, unknown> | undefined) ?? null;
  if (!userRow) {
    userRow = ((await txOrm.User.where({ id: userId }).first()) as Record<string, unknown> | null) ?? null;
  }
  const discordDmEnabled = userRow ? userRow.discordDmEnabled !== false : true;
  const eventDmEnabled = userRow ? userRow.dmRosterRemovedEnabled !== false : true;
  const discordUserId = userRow ? asStringOrNull(userRow.discordUserId) : null;
  const character = signup.character ? (signup.character as Record<string, unknown>) : null;
  const characterLabel = character
    ? `${asString(character.name)}${asStringOrNull(character.realm) ? `-${asString(character.realm)}` : ""}`
    : null;
  const copy = rosterRemovedWebNotification({
    runId: input.runId,
    runTitle: input.runTitle,
    characterLabel,
  });
  const { quietHours, timeZone } = quietHoursDeliveryContextFromUserRow(userRow);
  const discordDmDelivery = resolveDiscordDelivery({
    discordDmEnabled,
    eventDmEnabled,
    discordUserId,
    quietHours,
    timeZone,
  });
  await userNotificationRepository.createInTx(txOrm, {
    userId,
    type: "ROSTER_REMOVED",
    runId: input.runId,
    signupId: input.signupId,
    sourceKey: rosterRemovedSourceKey(input.runId, input.version, input.signupId),
    title: copy.title,
    message: copy.message,
    href: copy.href,
    discordDeliveryStatus: input.silent ? "SKIPPED" : discordDmDelivery.status,
    discordUserId: input.silent ? null : discordDmDelivery.discordUserId,
    discordDeliverAfter: input.silent ? null : discordDmDelivery.discordDeliverAfter,
    readAt: input.silent ? input.now : null,
    createdAt: input.now,
  });
}
