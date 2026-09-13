import { db, orm } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";
import {
  asBoolean,
  asString,
  asStringOrNull,
  mapAttendanceStatus,
  mapCharacterRole,
  mapParticipation,
  mapRegion,
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
  role: CharacterRole | null;
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
    role: signup.role == null ? null : mapCharacterRole(signup.role),
    participationType: mapParticipation(signup.participationType),
    isBackup: asBoolean(signup.isBackup),
  };
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

  async startRunWithAttendance(runId: string) {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const run = await txOrm.Run.where({ id: runId }).first();
      if (!run || asString((run as Record<string, unknown>).status) !== "PUBLISHED") {
        throw new DomainError("RUN_NOT_PUBLISHED", "Only a published run can be started.");
      }
      const roster = await txOrm.RunRoster.where({ runId }).first();
      const rosterRow = roster as Record<string, unknown> | undefined;
      if (!rosterRow || !asStringOrNull(rosterRow.publishedAt)) {
        throw new DomainError(
          "RUN_CANNOT_START",
          "A published roster with at least one selected participant is required.",
        );
      }
      const existing = await txOrm.RunAttendance.where({ runId }).select("id").all();
      if (existing.length > 0) {
        throw new DomainError("RUN_ALREADY_STARTED", "This run already has attendance records.");
      }
      const selected = await txOrm.RunSignup.where({ runId, status: "SELECTED" }).select("id").all();
      if (selected.length === 0) {
        throw new DomainError(
          "RUN_CANNOT_START",
          "A published roster with at least one selected participant is required.",
        );
      }
      const now = new Date().toISOString();
      const rosterId = asString(rosterRow.id);
      for (const signup of selected) {
        const signupId = asString((signup as Record<string, unknown>).id);
        const existing = await txOrm.RunRosterEntry.where({ rosterId, signupId }).first();
        let rosterEntryId = existing ? asString((existing as Record<string, unknown>).id) : "";
        if (!rosterEntryId) {
          rosterEntryId = crypto.randomUUID();
          await txOrm.RunRosterEntry.create({
            id: rosterEntryId,
            rosterId,
            signupId,
            selected: true,
            createdAt: now,
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
      await txOrm.Run.where({ id: runId }).update({
        status: "IN_PROGRESS",
        signupsOpen: false,
        updatedAt: now,
      });
    });
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
