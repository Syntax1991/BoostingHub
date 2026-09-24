import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageRun, canManageRun } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/models/enums";
import { attendanceRepository, type AttendanceRecord } from "@/repositories/attendance.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { ATTENDANCE_NOTE_MAX } from "@/services/run-state";
import {
  externalBoosterInputError,
  normalizeExternalBoosterName,
  type ExternalBoosterInput,
} from "@/lib/external-booster";
import type { CharacterRole, ParticipationType, WowClass } from "@/models/enums";

/** Who can step in for a participant after Start: active signups of this Run that are not on the roster. */
export type ReplacementCandidate = {
  signupId: string;
  userName: string;
  characterName: string | null;
  wowClass: WowClass | null;
  participationType: ParticipationType;
  offeredRoles: CharacterRole[];
};

export type ReplacementInput =
  | { kind: "signup"; signupId: string }
  | ({ kind: "external" } & ExternalBoosterInput);

function noteValue(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function assertAttendanceStatus(status: string): AttendanceStatus {
  if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
    throw new DomainError("ATTENDANCE_INVALID_STATUS", "Choose a valid attendance status.");
  }
  return status as AttendanceStatus;
}

function toManagerRow(row: AttendanceRecord) {
  return {
    id: row.id,
    characterName: row.characterName,
    characterRealm: row.characterRealm,
    userName: row.userName,
    wowClass: row.wowClass,
    selectedRole: row.selectedRole,
    participationType: row.participationType,
    isBackup: row.isBackup,
    status: row.status,
    note: row.note,
    markedAt: row.markedAt,
    markedByName: row.markedByName,
  };
}

function toOwnRow(row: AttendanceRecord) {
  return {
    characterName: row.characterName,
    characterRealm: row.characterRealm,
    selectedRole: row.selectedRole,
    participationType: row.participationType,
    isBackup: row.isBackup,
    status: row.status,
  };
}

function summaryFrom(rows: AttendanceRecord[]) {
  const counts = {
    UNMARKED: 0,
    PRESENT: 0,
    LATE: 0,
    LEFT_EARLY: 0,
    NO_SHOW: 0,
    EXCUSED: 0,
    STANDBY: 0,
  };
  for (const row of rows) {
    counts[row.status] += 1;
  }
  return {
    total: rows.length,
    unmarked: counts.UNMARKED,
    counts,
  };
}

async function loadManagedRun(user: AuthenticatedUser, runId: string) {
  const run = await runRepository.findById(runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  assertCanManageRun(user, run);
  return run;
}

/**
 * Attendance querying, mutation, and completeness. Run start/complete live in RunService
 * and call this service for snapshot/completeness coordination.
 */
export const attendanceService = {
  async listPublishedSelectedSignupIds(runId: string) {
    const roster = await rosterRepository.findByRunId(runId);
    if (!roster?.publishedAt) {
      return [];
    }
    const signups = await rosterRepository.listSignups(runId);
    return signups.filter((signup) => signup.status === "SELECTED").map((signup) => signup.id);
  },

  async snapshotSelectedRoster(
    runId: string,
    input: {
      startedById: string;
    },
  ) {
    await attendanceRepository.startRunWithAttendance(runId, input);
  },

  async completeIfFullyMarked(runId: string) {
    await attendanceRepository.completeRunIfAttendanceComplete(runId);
  },

  async getManagerAttendance(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    const rows = await attendanceRepository.listByRunId(runId);
    const canMutate = run.status === "IN_PROGRESS";
    const signups = canMutate ? await rosterRepository.listSignups(runId) : [];
    const replacementCandidates: ReplacementCandidate[] = signups
      .filter((signup) => signup.status === "PENDING" || signup.status === "NOT_SELECTED")
      .filter((signup) => !rows.some((row) => row.signupId === signup.id))
      .map((signup) => ({
        signupId: signup.id,
        userName: signup.userName,
        characterName: signup.character?.name ?? null,
        wowClass: signup.character?.wowClass ?? signup.lootbuddyClass ?? null,
        participationType: signup.participationType,
        offeredRoles: signup.offeredRoles,
      }));
    return {
      runStatus: run.status,
      started: rows.length > 0,
      canMutate,
      summary: summaryFrom(rows),
      rows: rows.map(toManagerRow),
      replacementCandidates,
      /** Hand-added boosters in the raid (Final Setup only — no attendance or payout). */
      externalBoosters: run.roster?.externalBoosters ?? [],
    };
  },

  /**
   * Swaps a participant of a started Run (typically a no-show) for another
   * signup of this Run or an external booster. The original is marked NO_SHOW
   * (no cut); a registered replacement gets its own PRESENT row (full cut) and
   * a Raid Invite. See attendanceRepository.replaceParticipantAtomic.
   */
  async replaceParticipant(user: AuthenticatedUser, input: { attendanceId: string; replacement: ReplacementInput }) {
    const row = await attendanceRepository.findById(input.attendanceId);
    if (!row) {
      throw new DomainError("ATTENDANCE_NOT_FOUND", "Attendance was not found.", 404);
    }
    const run = await runRepository.findById(row.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    if (!canManageRun(user, run)) {
      throw new DomainError("ATTENDANCE_NOT_MANAGEABLE", "You cannot manage attendance for this run.", 403);
    }
    if (run.status !== "IN_PROGRESS") {
      throw new DomainError("ATTENDANCE_NOT_MANAGEABLE", "Participants can only be replaced while the run is in progress.");
    }

    let replacement = input.replacement;
    if (replacement.kind === "external") {
      // The external takes the same kind of slot: a booster in the original's role, or a lootbuddy.
      replacement = { ...replacement, participationType: row.participationType };
      const invalid = externalBoosterInputError(replacement);
      if (invalid) throw new DomainError("INVALID_ROSTER_SELECTION", invalid);
      replacement = { ...replacement, name: normalizeExternalBoosterName(replacement.name) };
    }

    const result = await attendanceRepository.replaceParticipantAtomic({
      runId: row.runId,
      attendanceId: row.id,
      managerId: user.id,
      replacement,
    });
    return { runId: row.runId, replacementName: result.replacementName };
  },

  async getOwnAttendance(user: AuthenticatedUser, runId: string) {
    const rows = await attendanceRepository.listByRunId(runId);
    const own = rows.filter((row) => row.userId === user.id);
    return own.map(toOwnRow);
  },

  async setStatus(
    user: AuthenticatedUser,
    input: { attendanceId: string; status: string; note?: string | null },
  ) {
    const row = await attendanceRepository.findById(input.attendanceId);
    if (!row) {
      throw new DomainError("ATTENDANCE_NOT_FOUND", "Attendance was not found.", 404);
    }
    const run = await runRepository.findById(row.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    if (!canManageRun(user, run)) {
      throw new DomainError("ATTENDANCE_NOT_MANAGEABLE", "You cannot manage attendance for this run.", 403);
    }
    if (run.status !== "IN_PROGRESS") {
      throw new DomainError("ATTENDANCE_NOT_MANAGEABLE", "Attendance can only be updated while the run is in progress.");
    }
    const status = assertAttendanceStatus(input.status);
    const note = input.note === undefined ? row.note : noteValue(input.note);
    if (note && note.length > ATTENDANCE_NOTE_MAX) {
      throw new DomainError("VALIDATION_FAILED", `Attendance notes must be ${ATTENDANCE_NOTE_MAX} characters or fewer.`);
    }
    const now = new Date().toISOString();
    await attendanceRepository.updateStatus(row.id, {
      status,
      note,
      markedAt: status === "UNMARKED" ? null : now,
      markedById: status === "UNMARKED" ? null : user.id,
    });
    return { runId: row.runId };
  },

  async markAllUnmarkedPresent(user: AuthenticatedUser, runId: string) {
    const run = await loadManagedRun(user, runId);
    if (run.status !== "IN_PROGRESS") {
      throw new DomainError("ATTENDANCE_NOT_MANAGEABLE", "Attendance can only be updated while the run is in progress.");
    }
    return attendanceRepository.markAllUnmarkedPresent(runId, user.id);
  },
};

export type ManagerAttendanceView = Awaited<ReturnType<typeof attendanceService.getManagerAttendance>>;
export type OwnAttendanceView = Awaited<ReturnType<typeof attendanceService.getOwnAttendance>>;
