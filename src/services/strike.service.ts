import type { AuthenticatedUser } from "@/auth/authorization";
import { canManageRun, hasAdminAccess } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { activityRepository } from "@/repositories/activity.repository";
import { runRepository, type RunListRecord } from "@/repositories/run.repository";
import { userRepository } from "@/repositories/user.repository";
import { strikeRepository, type StrikeRecord } from "@/repositories/strike.repository";
import { STRIKE_NOTES_MAX, STRIKE_REASON_MAX, STRIKE_REVOKE_REASON_MAX } from "@/services/strike-state";

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function assertReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "A strike reason is required.");
  }
  if (trimmed.length > STRIKE_REASON_MAX) {
    throw new DomainError("VALIDATION_FAILED", `Strike reasons must be ${STRIKE_REASON_MAX} characters or fewer.`);
  }
  return trimmed;
}

function assertNotes(notes: string | null | undefined): string | null {
  const value = trimmedOrNull(notes);
  if (value && value.length > STRIKE_NOTES_MAX) {
    throw new DomainError("VALIDATION_FAILED", `Strike notes must be ${STRIKE_NOTES_MAX} characters or fewer.`);
  }
  return value;
}

function assertRevokedReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "A reason is required to revoke a strike.");
  }
  if (trimmed.length > STRIKE_REVOKE_REASON_MAX) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `Revoke reasons must be ${STRIKE_REVOKE_REASON_MAX} characters or fewer.`,
    );
  }
  return trimmed;
}

/** Real Run participation, from BoostingHub's own signup history — never Attendance (owned by Dawn Boosting). */
function assertUserAssociatedWithRun(userId: string, run: RunListRecord) {
  const associated = run.signups.some((signup) => signup.userId === userId);
  if (!associated) {
    throw new DomainError(
      "STRIKE_USER_NOT_ASSOCIATED",
      "That user has no signup history on this run.",
    );
  }
}

function toOwnRow(row: StrikeRecord) {
  return {
    id: row.id,
    reason: row.reason,
    runId: row.runId,
    runTitle: row.runTitle,
    status: row.status,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
  };
}

function toManagerRow(row: StrikeRecord) {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    reason: row.reason,
    notes: row.notes,
    runId: row.runId,
    runTitle: row.runTitle,
    status: row.status,
    createdById: row.createdById,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revokedById: row.revokedById,
    revokedByName: row.revokedByName,
    revokedReason: row.revokedReason,
  };
}

/**
 * Disciplinary history against a User. BoostingHub owns Users, Characters,
 * Booster Qualifications, Runs, Signups, Rosters, and this Strike history.
 * Attendance and payout/financial handling are an external, operational
 * concern (Dawn Boosting) and are intentionally not coupled here — nothing
 * in this service reads or writes Attendance. Every Strike is an explicit
 * staff action; nothing here is automatic.
 */
export const strikeService = {
  /**
   * ADMIN may create a Strike with or without a Run. RAID_LEAD may only
   * create a Run-linked Strike for a Run they manage, and only for a User
   * who actually has signup history there (BoostingHub's own Run
   * participation data) — never a global disciplinary grant.
   */
  async create(
    actor: AuthenticatedUser,
    input: {
      userId: string;
      runId?: string;
      reason: string;
      notes?: string | null;
    },
  ): Promise<StrikeRecord> {
    if (!hasAdminAccess(actor.accountRole) && actor.accountRole !== "RAID_LEAD") {
      throw new DomainError("STRIKE_NOT_MANAGEABLE", "You cannot create strikes.", 403);
    }

    const targetUserId = input.userId;
    const targetRunId = input.runId ?? null;

    const targetUser = await userRepository.findById(targetUserId);
    if (!targetUser) {
      throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    }

    let run: RunListRecord | null = null;
    if (targetRunId) {
      run = await runRepository.findById(targetRunId);
      if (!run) {
        throw new DomainError("NOT_FOUND", "Run was not found.", 404);
      }
    }

    if (hasAdminAccess(actor.accountRole)) {
      if (run) {
        assertUserAssociatedWithRun(targetUserId, run);
      }
    } else {
      // RAID_LEAD path: a Run is mandatory, must be one they manage, and the
      // target must have real signup history on it.
      if (!run) {
        throw new DomainError(
          "STRIKE_RUN_REQUIRED",
          "A raid lead may only create a strike linked to a run they manage.",
        );
      }
      if (!canManageRun(actor, run)) {
        throw new DomainError("STRIKE_NOT_MANAGEABLE", "You cannot create strikes for this run.", 403);
      }
      assertUserAssociatedWithRun(targetUserId, run);
    }

    const reason = assertReason(input.reason);
    const notes = assertNotes(input.notes);

    const created = await strikeRepository.create({
      id: crypto.randomUUID(),
      userId: targetUserId,
      runId: targetRunId,
      reason,
      notes,
      createdById: actor.id,
    });

    await activityRepository.create({
      userId: actor.id,
      type: "STRIKE_ADDED",
      message: `Added a strike to ${targetUser.name}${run ? ` for ${run.title}` : ""}. targetUserId=${targetUserId} strikeId=${created.id}`,
    });

    return created;
  },

  /** ADMIN-only correction. RAID_LEAD may never revoke, including a strike they created. */
  async revoke(actor: AuthenticatedUser, strikeId: string, revokedReason: string): Promise<StrikeRecord> {
    if (!hasAdminAccess(actor.accountRole)) {
      throw new DomainError("STRIKE_REVOKE_FORBIDDEN", "Only an admin can revoke a strike.", 403);
    }
    const strike = await strikeRepository.findById(strikeId);
    if (!strike) {
      throw new DomainError("STRIKE_NOT_FOUND", "Strike was not found.", 404);
    }
    if (strike.status === "REVOKED") {
      throw new DomainError("STRIKE_ALREADY_REVOKED", "This strike is already revoked.");
    }
    const reason = assertRevokedReason(revokedReason);
    await strikeRepository.revoke(strike.id, {
      revokedAt: new Date().toISOString(),
      revokedById: actor.id,
      revokedReason: reason,
    });
    const updated = await strikeRepository.findById(strikeId);
    if (!updated) {
      throw new DomainError("STRIKE_NOT_FOUND", "Strike was not found.", 404);
    }
    await activityRepository.create({
      userId: actor.id,
      type: "STRIKE_REVOKED",
      message: `Revoked a strike for ${strike.userName}. targetUserId=${strike.userId} strikeId=${strike.id}`,
    });
    return updated;
  },

  /** A User's own complete Strike history (active and revoked). Internal notes are never included. */
  async listOwn(user: AuthenticatedUser) {
    const rows = await strikeRepository.listByUserId(user.id);
    return rows.map(toOwnRow);
  },

  /** Full detail for management. actor.id === userId covers ADMIN's own history too. */
  async listForUser(actor: AuthenticatedUser, userId: string) {
    if (actor.id !== userId && !hasAdminAccess(actor.accountRole)) {
      throw new DomainError("NOT_AUTHORIZED", "You cannot view this user's strike history.", 403);
    }
    const rows = await strikeRepository.listByUserId(userId);
    return rows.map(toManagerRow);
  },

  /** Manager view scoped to one run: RAID_LEAD sees only runs they manage. */
  async listForRun(actor: AuthenticatedUser, runId: string) {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    if (!canManageRun(actor, run)) {
      throw new DomainError("STRIKE_NOT_MANAGEABLE", "You cannot view strikes for this run.", 403);
    }
    const rows = await strikeRepository.listByRunId(runId);
    return rows.map(toManagerRow);
  },
};

export type OwnStrikeRow = ReturnType<typeof toOwnRow>;
export type ManagerStrikeRow = ReturnType<typeof toManagerRow>;
