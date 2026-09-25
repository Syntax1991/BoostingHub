import { db, orm } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";
import type { ExternalBoosterInput } from "@/lib/external-booster";
import { ATTENDANCE_NOTE_MAX } from "@/services/run-state";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapAttendanceStatus,
  mapCharacterRole,
  mapParticipation,
  mapRegion,
  mapSignupStatus,
  mapWowClass,
} from "@/lib/persistence";
import { CLASS_LABELS } from "@/lib/labels";
import type {
  AttendanceStatus,
  CharacterRole,
  ParticipationType,
  WowClass,
  WowRegion,
} from "@/models/enums";
import {
  raidInviteSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import {
  raidInviteWebNotification,
  resolveDiscordDelivery,
  type NotificationAssignmentInput,
} from "@/services/notification-content";
import { quietHoursDeliveryContextFromUserRow } from "@/services/notification-delivery-context";
import { hasUnpublishedRosterChanges } from "@/services/roster-publish-state";
import { lockRosterInTx } from "@/repositories/roster.repository";

export type AttendanceRecord = {
  id: string;
  runId: string;
  rosterEntryId: string;
  status: AttendanceStatus;
  note: string | null;
  markedAt: string | null;
  markedById: string | null;
  markedByName: string | null;
  signupId: string;
  userId: string;
  userName: string;
  characterId: string | null;
  characterName: string;
  characterRealm: string;
  characterRegion: WowRegion | null;
  wowClass: WowClass | null;
  /** The Raid Lead's assigned BOOSTER role, read from the roster entry this attendance row snapshots. */
  selectedRole: CharacterRole | null;
  participationType: ParticipationType;
  isBackup: boolean;
};

type TxOrm = typeof orm;

function mapAttendance(row: Record<string, unknown>): AttendanceRecord {
  const entry = (row.rosterEntry as Record<string, unknown> | undefined) ?? {};
  const signup = (entry.signup as Record<string, unknown> | undefined) ?? {};
  const user = (signup.user as Record<string, unknown> | undefined) ?? {};
  const character = signup.character as Record<string, unknown> | undefined;
  const marker = row.markedBy as Record<string, unknown> | undefined;
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    rosterEntryId: asString(row.rosterEntryId),
    status: mapAttendanceStatus(row.status),
    note: asStringOrNull(row.note),
    markedAt: asStringOrNull(row.markedAt),
    markedById: asStringOrNull(row.markedById),
    markedByName: marker ? asString(marker.name) : null,
    signupId: asString(signup.id),
    userId: asString(signup.userId),
    userName: asString(user.name),
    characterId: asStringOrNull(signup.characterId),
    characterName: character
      ? asString(character.name, "Unknown character")
      : signup.lootbuddyClass != null
        ? CLASS_LABELS[mapWowClass(signup.lootbuddyClass)]
        : "Lootbuddy",
    characterRealm: character ? asString(character.realm) : "",
    characterRegion: character ? mapRegion(character.region) : null,
    wowClass: character
      ? mapWowClass(character.wowClass)
      : signup.lootbuddyClass == null
        ? null
        : mapWowClass(signup.lootbuddyClass),
    selectedRole:
      // Prefer the published snapshot when present so Start/Attendance never
      // leak a later replacement-draft mutation. After Start, publishedRole is
      // frozen (no republish) and the roster entry was synced from it.
      signup.publishedRole == null
        ? entry.selectedRole == null
          ? null
          : mapCharacterRole(entry.selectedRole)
        : mapCharacterRole(signup.publishedRole),
    participationType: mapParticipation(signup.participationType),
    isBackup: asBoolean(signup.isBackup),
  };
}

/** RAID_INVITE (web + DM) for one participant who is joining a started Run. */
async function createRaidInviteNotificationInTx(
  txOrm: TxOrm,
  input: { runId: string; productLabel: string; signupRow: Record<string, unknown>; now: string },
): Promise<void> {
  const { runId, productLabel, signupRow, now } = input;
  const signupId = asString(signupRow.id);
  const userId = asString(signupRow.userId);
  let userRow = (signupRow.user as Record<string, unknown> | undefined) ?? null;
  if (!userRow) {
    userRow = ((await txOrm.User.where({ id: userId }).first()) as Record<string, unknown> | null) ?? null;
  }
  const discordDmEnabled = userRow ? userRow.discordDmEnabled !== false : true;
  const eventDmEnabled = userRow ? userRow.dmRaidInviteEnabled !== false : true;
  const discordUserId = userRow ? asStringOrNull(userRow.discordUserId) : null;
  const participationType = mapParticipation(signupRow.participationType);
  const publishedRole =
    signupRow.publishedRole == null ? null : mapCharacterRole(signupRow.publishedRole);
  const character = signupRow.character ? (signupRow.character as Record<string, unknown>) : null;
  const assignment: NotificationAssignmentInput = {
    participationType,
    publishedRole,
    characterName: character ? asStringOrNull(character.name) : null,
    characterRealm: character ? asStringOrNull(character.realm) : null,
    wowClass:
      participationType === "LOOTBUDDY"
        ? signupRow.lootbuddyClass != null
          ? mapWowClass(signupRow.lootbuddyClass)
          : character
            ? mapWowClass(character.wowClass)
            : null
        : character
          ? mapWowClass(character.wowClass)
          : null,
  };
  const copy = raidInviteWebNotification({
    runId,
    productLabel,
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
    type: "RAID_INVITE",
    runId,
    signupId,
    sourceKey: raidInviteSourceKey(runId, signupId),
    title: copy.title,
    message: copy.message,
    href: copy.href,
    discordDeliveryStatus: discordDmDelivery.status,
    discordUserId: discordDmDelivery.discordUserId,
    discordDeliverAfter: discordDmDelivery.discordDeliverAfter,
    createdAt: now,
  });
}

function attendanceQuery() {
  return orm.RunAttendance
    .include("markedBy")
    .include("rosterEntry", (entry) =>
      entry.include("signup", (signup) => signup.include("user").include("character")),
    );
}

export const attendanceRepository = {
  async listByRunId(runId: string): Promise<AttendanceRecord[]> {
    const rows = await attendanceQuery().where({ runId }).all();
    return rows.map((row) => mapAttendance(row as Record<string, unknown>));
  },

  async findById(id: string): Promise<AttendanceRecord | null> {
    const row = await attendanceQuery().where({ id }).first();
    return row ? mapAttendance(row as Record<string, unknown>) : null;
  },

  async countByRunId(runId: string): Promise<number> {
    const rows = await orm.RunAttendance.where({ runId }).select("id").all();
    return rows.length;
  },

  async countUnmarked(runId: string): Promise<number> {
    const rows = await orm.RunAttendance.where({ runId, status: "UNMARKED" }).select("id").all();
    return rows.length;
  },

  /**
   * Batched attendance totals / unmarked counts for Manage Runs handoffs.
   * One query for all run ids; empty input → empty Map.
   */
  async summarizeByRunIds(
    runIds: string[],
  ): Promise<Map<string, { total: number; unmarkedCount: number }>> {
    const summary = new Map<string, { total: number; unmarkedCount: number }>();
    if (runIds.length === 0) {
      return summary;
    }
    const uniqueIds = [...new Set(runIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return summary;
    }
    const rows = await orm.RunAttendance.where((attendance) => attendance.runId.in(uniqueIds))
      .select("runId", "status")
      .all();
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      const runId = asString(record.runId);
      const current = summary.get(runId) ?? { total: 0, unmarkedCount: 0 };
      current.total += 1;
      if (mapAttendanceStatus(record.status) === "UNMARKED") {
        current.unmarkedCount += 1;
      }
      summary.set(runId, current);
    }
    return summary;
  },

  async updateStatus(
    id: string,
    fields: {
      status: AttendanceStatus;
      note: string | null;
      markedAt: string | null;
      markedById: string | null;
    },
  ) {
    await orm.RunAttendance.where({ id }).update({
      status: fields.status,
      note: fields.note,
      markedAt: fields.markedAt,
      markedById: fields.markedById,
      updatedAt: new Date().toISOString(),
    });
  },

  async markAllUnmarkedPresent(runId: string, markedById: string): Promise<number> {
    const now = new Date().toISOString();
    const unmarked = await orm.RunAttendance.where({ runId, status: "UNMARKED" }).select("id").all();
    for (const row of unmarked) {
      await orm.RunAttendance.where({ id: asString((row as Record<string, unknown>).id) }).update({
        status: "PRESENT",
        markedAt: now,
        markedById,
        updatedAt: now,
      });
    }
    return unmarked.length;
  },

  async startRunWithAttendance(
    runId: string,
    input: {
      startedById: string;
    },
  ) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      // Start is the roster lock point. Take the roster lock before reading
      // anything (the same order every roster write uses): a concurrent Save /
      // Publish / Add Player either committed before this and is included, or
      // waits and then fails because the Run is IN_PROGRESS.
      const rosterLookup = (await txOrm.RunRoster.where({ runId }).select("id").first()) as Record<string, unknown> | null;
      const lockedRoster = rosterLookup ? await lockRosterInTx(txOrm, asString(rosterLookup.id)) : null;
      const run = await txOrm.Run.where({ id: runId }).first();
      if (!run || asString((run as Record<string, unknown>).status) !== "PUBLISHED") {
        throw new DomainError("RUN_NOT_PUBLISHED", "Only a published run can be started.");
      }
      const existingSnapshot = await txOrm.RunStartSnapshot.where({ runId }).first();
      if (existingSnapshot) {
        throw new DomainError("RUN_ALREADY_STARTED", "This run has already started.");
      }
      if (!lockedRoster || !lockedRoster.publishedAt) {
        throw new DomainError(
          "RUN_CANNOT_START",
          "A published roster with at least one selected participant is required.",
        );
      }
      const rosterRow = { id: lockedRoster.id };
      // Start snapshots the published roster; a saved replacement that was
      // never re-published would silently be left out, so refuse instead.
      const runSignups = (await txOrm.RunSignup.where({ runId })
        .select("id", "status", "participationType", "publishedRole")
        .all()) as Array<Record<string, unknown>>;
      if (
        hasUnpublishedRosterChanges({
          publishedAt: lockedRoster.publishedAt,
          version: lockedRoster.version,
          draft: lockedRoster.selections,
          signups: runSignups.map((row) => ({
            id: asString(row.id),
            status: mapSignupStatus(row.status),
            participationType: mapParticipation(row.participationType),
            publishedRole: row.publishedRole == null ? null : mapCharacterRole(row.publishedRole),
          })),
        })
      ) {
        throw new DomainError(
          "ROSTER_UNPUBLISHED_CHANGES",
          "Roster has unpublished changes. Update the roster before starting the Run.",
        );
      }
      const existing = await txOrm.RunAttendance.where({ runId }).select("id").all();
      if (existing.length > 0) {
        throw new DomainError("RUN_ALREADY_STARTED", "This run already has attendance records.");
      }
      const selected = await txOrm.RunSignup
        .where({ runId, status: "SELECTED" })
        .include("offeredRoles")
        .include("character")
        .include("user")
        .all();
      if (selected.length === 0) {
        throw new DomainError(
          "RUN_CANNOT_START",
          "A published roster with at least one selected participant is required.",
        );
      }
      const now = new Date().toISOString();
      const rosterId = asString(rosterRow.id);
      const runRow = run as Record<string, unknown>;
      const productLabel = asStringOrNull(runRow.title)?.trim() || "Run";
      for (const signup of selected) {
        const signupRow = signup as Record<string, unknown>;
        const signupId = asString(signupRow.id);
        const participationType = mapParticipation(signupRow.participationType);
        const publishedRole =
          signupRow.publishedRole == null ? null : mapCharacterRole(signupRow.publishedRole);

        // A PUBLISHED Run starts from the published roster. BOOSTER slots must
        // already carry publishedRole — never guess from a mutable draft role.
        if (participationType === "BOOSTER" && !publishedRole) {
          throw new DomainError(
            "RUN_CANNOT_START",
            "A selected booster is missing its published role. Republish the roster before starting.",
          );
        }

        const existingEntry = await txOrm.RunRosterEntry.where({ rosterId, signupId }).first();
        let rosterEntryId = existingEntry ? asString((existingEntry as Record<string, unknown>).id) : "";
        if (!rosterEntryId) {
          rosterEntryId = crypto.randomUUID();
          await txOrm.RunRosterEntry.create({
            id: rosterEntryId,
            rosterId,
            signupId,
            selected: true,
            // Freeze the published role onto the entry attendance joins.
            selectedRole: publishedRole,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          // Align any replacement-draft mutation back to the published role so
          // Attendance's roster-entry join matches what was actually published.
          await txOrm.RunRosterEntry.where({ id: rosterEntryId }).update({
            selected: true,
            selectedRole: publishedRole,
            updatedAt: now,
          });
        }
        await txOrm.RunAttendance.create({
          id: crypto.randomUUID(),
          runId,
          rosterEntryId,
          status: "UNMARKED",
          createdAt: now,
          updatedAt: now,
        });
      }
      await txOrm.RunStartSnapshot.create({
        id: crypto.randomUUID(),
        runId,
        startedAt: now,
        startedById: input.startedById,
        createdAt: now,
        updatedAt: now,
      });
      await txOrm.Run.where({ id: runId }).update({
        status: "IN_PROGRESS",
        signupsOpen: false,
        updatedAt: now,
      });

      for (const signup of selected) {
        await createRaidInviteNotificationInTx(txOrm, {
          runId,
          productLabel,
          signupRow: signup as Record<string, unknown>,
          now,
        });
      }
    });
  },

  /**
   * Replaces a participant of a started Run (e.g. a no-show), in one transaction:
   * - the original attendance row becomes NO_SHOW (0 cut) with a "Replaced by" note,
   *   and the original signup leaves the live roster (NOT_SELECTED)
   * - a registered replacement (a PENDING / NOT_SELECTED signup of this Run with
   *   the same participation type) becomes SELECTED in the original's role and
   *   gets its own PRESENT attendance row (full cut) plus a Raid Invite
   * - an external replacement is added to the roster as an external booster
   *   (Final Setup only — no account, so no attendance or payout)
   * - the roster version is bumped so the Discord roster and Final Setup
   *   posts are edited
   */
  async replaceParticipantAtomic(input: {
    runId: string;
    attendanceId: string;
    managerId: string;
    replacement: { kind: "signup"; signupId: string } | ({ kind: "external" } & ExternalBoosterInput);
  }): Promise<{ replacementName: string }> {
    return db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const run = (await txOrm.Run.where({ id: input.runId }).first()) as Record<string, unknown> | null;
      if (!run || asString(run.status) !== "IN_PROGRESS") {
        throw new DomainError("ATTENDANCE_NOT_MANAGEABLE", "Participants can only be replaced while the run is in progress.");
      }
      const original = (await txOrm.RunAttendance.where({ id: input.attendanceId })
        .include("rosterEntry", (entry) => entry.include("signup", (signup) => signup.include("user").include("character")))
        .first()) as Record<string, unknown> | null;
      if (!original || asString(original.runId) !== input.runId) {
        throw new DomainError("ATTENDANCE_NOT_FOUND", "Attendance was not found.", 404);
      }
      const originalRecord = mapAttendance(original);
      const roster = (await txOrm.RunRoster.where({ runId: input.runId }).first()) as Record<string, unknown> | null;
      if (!roster) {
        throw new DomainError("NOT_FOUND", "Roster was not found.", 404);
      }
      const rosterId = asString(roster.id);
      const now = new Date().toISOString();
      const role = originalRecord.participationType === "BOOSTER" ? originalRecord.selectedRole : null;

      let replacementName: string;
      if (input.replacement.kind === "signup") {
        const replacementSignupId = input.replacement.signupId;
        const signup = (await txOrm.RunSignup.where({ id: replacementSignupId })
          .include("user")
          .include("character")
          .first()) as Record<string, unknown> | null;
        if (!signup || asString(signup.runId) !== input.runId) {
          throw new DomainError("NOT_FOUND", "The replacement signup was not found on this run.", 404);
        }
        const status = asString(signup.status);
        if (status !== "PENDING" && status !== "NOT_SELECTED") {
          throw new DomainError("INVALID_ROSTER_SELECTION", "Only a pending or not-selected signup can step in.");
        }
        if (mapParticipation(signup.participationType) !== originalRecord.participationType) {
          throw new DomainError(
            "INVALID_ROSTER_SELECTION",
            originalRecord.participationType === "BOOSTER"
              ? "A booster slot can only be filled by a booster signup."
              : "A lootbuddy slot can only be filled by a lootbuddy signup.",
          );
        }
        const replacementUserId = asString(signup.userId);
        if (originalRecord.participationType === "BOOSTER") {
          const attending = (await this.listByRunIdInTx(txOrm, input.runId)).some(
            (row) =>
              row.userId === replacementUserId &&
              row.participationType === "BOOSTER" &&
              row.status !== "NO_SHOW" &&
              row.status !== "EXCUSED",
          );
          if (attending) {
            throw new DomainError("INVALID_ROSTER_SELECTION", "That player already holds a booster slot in this run.");
          }
        }

        await txOrm.RunSignup.where({ id: replacementSignupId }).update({
          status: "SELECTED",
          publishedRole: role,
          updatedAt: now,
        });
        const existingEntry = (await txOrm.RunRosterEntry.where({ rosterId, signupId: replacementSignupId }).first()) as
          | Record<string, unknown>
          | null;
        let rosterEntryId = existingEntry ? asString(existingEntry.id) : "";
        if (existingEntry) {
          await txOrm.RunRosterEntry.where({ id: rosterEntryId }).update({ selected: true, selectedRole: role, updatedAt: now });
        } else {
          rosterEntryId = crypto.randomUUID();
          await txOrm.RunRosterEntry.create({
            id: rosterEntryId,
            rosterId,
            signupId: replacementSignupId,
            selected: true,
            selectedRole: role,
            createdAt: now,
            updatedAt: now,
          });
        }
        const existingAttendance = await txOrm.RunAttendance.where({ rosterEntryId }).first();
        if (existingAttendance) {
          throw new DomainError("INVALID_ROSTER_SELECTION", "That signup already has an attendance row.");
        }
        const user = (signup.user as Record<string, unknown> | undefined) ?? {};
        const character = signup.character as Record<string, unknown> | undefined;
        replacementName = character ? `${asString(user.name)} (${asString(character.name)})` : asString(user.name);
        await txOrm.RunAttendance.create({
          id: crypto.randomUUID(),
          runId: input.runId,
          rosterEntryId,
          // Stepping in counts as attending: a full cut unless the Raid Lead changes it.
          status: "PRESENT",
          note: `Replacement for ${originalRecord.userName}`.slice(0, ATTENDANCE_NOTE_MAX),
          markedAt: now,
          markedById: input.managerId,
          createdAt: now,
          updatedAt: now,
        });
        await createRaidInviteNotificationInTx(txOrm, {
          runId: input.runId,
          productLabel: asStringOrNull(run.title)?.trim() || "Run",
          signupRow: { ...signup, publishedRole: role },
          now,
        });
      } else {
        const { name, wowClass } = input.replacement;
        // An external steps into the same kind of slot: booster in the original's role, or lootbuddy.
        const participationType = originalRecord.participationType;
        await txOrm.RunExternalBooster.create({
          id: crypto.randomUUID(),
          rosterId,
          name,
          wowClass,
          participationType,
          role: participationType === "LOOTBUDDY" ? null : input.replacement.role,
          createdAt: now,
          updatedAt: now,
        });
        replacementName = `@${name} (external)`;
      }

      await txOrm.RunAttendance.where({ id: input.attendanceId }).update({
        status: "NO_SHOW",
        note: `Replaced by ${replacementName}`.slice(0, ATTENDANCE_NOTE_MAX),
        markedAt: now,
        markedById: input.managerId,
        updatedAt: now,
      });
      if (originalRecord.signupId) {
        await txOrm.RunSignup.where({ id: originalRecord.signupId }).update({
          status: "NOT_SELECTED",
          publishedRole: null,
          updatedAt: now,
        });
      }

      const previousVersion = asNumber(roster.version, 1);
      await txOrm.RunRoster.where({ id: rosterId }).update({ version: previousVersion + 1, updatedAt: now });
      // A Final Setup posted before this column existed has no baseline yet;
      // anchor it to the pre-replacement version so the post gets edited.
      const post = (await txOrm.RunDiscordPost.where({ runId: input.runId }).first()) as Record<string, unknown> | null;
      if (post && asStringOrNull(post.startMessageId) && post.lastStartRosterVersion == null) {
        await txOrm.RunDiscordPost.where({ runId: input.runId }).update({
          lastStartRosterVersion: previousVersion,
          updatedAt: now,
        });
      }

      await txOrm.ActivityEvent.create({
        id: crypto.randomUUID(),
        userId: input.managerId,
        type: "PARTICIPANT_REPLACED",
        message: `Replaced ${originalRecord.userName} with ${replacementName}.`,
        occurredAt: now,
      });
      return { replacementName };
    });
  },

  async listByRunIdInTx(txOrm: TxOrm, runId: string): Promise<AttendanceRecord[]> {
    const rows = await txOrm.RunAttendance.where({ runId })
      .include("markedBy")
      .include("rosterEntry", (entry) => entry.include("signup", (signup) => signup.include("user").include("character")))
      .all();
    return rows.map((row) => mapAttendance(row as Record<string, unknown>));
  },

  async completeRunIfAttendanceComplete(runId: string) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const run = await txOrm.Run.where({ id: runId }).first();
      if (!run || asString((run as Record<string, unknown>).status) !== "IN_PROGRESS") {
        throw new DomainError("RUN_CANNOT_COMPLETE", "Only an in-progress run can be completed.");
      }
      const unmarked = await txOrm.RunAttendance.where({ runId, status: "UNMARKED" }).select("id").all();
      if (unmarked.length > 0) {
        throw new DomainError(
          "ATTENDANCE_INCOMPLETE",
          `Mark attendance for all rostered participants before completing the run. ${unmarked.length} unmarked remain.`,
        );
      }
      const total = await txOrm.RunAttendance.where({ runId }).select("id").all();
      if (total.length === 0) {
        throw new DomainError("RUN_CANNOT_COMPLETE", "This run has no attendance records.");
      }
      const now = new Date().toISOString();
      await txOrm.Run.where({ id: runId }).update({
        status: "COMPLETED",
        signupsOpen: false,
        updatedAt: now,
      });
      const after = await txOrm.RunAttendance.where({ runId, status: "UNMARKED" }).select("id").all();
      if (after.length > 0) {
        throw new DomainError(
          "ATTENDANCE_INCOMPLETE",
          `Mark attendance for all rostered participants before completing the run. ${after.length} unmarked remain.`,
        );
      }
    });
  },
};
