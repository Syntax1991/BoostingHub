import type { CharacterRole, RaidDifficulty, RunLootType, RunStatus, WowClass } from "@/models/enums";
import {
  buildClosedDiscordRunChannelName,
  buildDiscordRunChannelName,
} from "@/lib/discord-channel-name";
import { CLASS_LABELS } from "@/lib/labels";
import { formatTargetRaidLockoutLabel } from "@/lib/raid-lockout-label";
import { attackTypeForSpecialization } from "@/lib/wow-specializations";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { rosterRepository, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository, type RunListRecord } from "@/repositories/run.repository";
import { runStartSnapshotRepository } from "@/repositories/run-start-snapshot.repository";
import { projectRunContentLockouts } from "@/lib/run-content-lockouts";
import { lockoutService } from "@/services/lockout.service";
import { isSignupWindowOpen } from "@/services/run-state";
import { isActiveSignupOffer } from "@/services/signup-state";

/**
 * Where a Run's dedicated Discord channel belongs, decided once here and
 * carried through every sync work item — the bot never reproduces this
 * calendar logic itself, it only reconciles Discord to whatever target the
 * Service already computed (see channel-reconciliation.ts).
 *
 * CURRENT and NEXT are not separate Discord categories — Discord channels
 * cannot contain child channels, so both weeks share the one active Run
 * category and are visually separated by ordering around two marker
 * channels (`#current-id`/`#next-id`). ARCHIVE is a real, separate category.
 *
 * App archival (`Run.archivedAt`) always wins over week classification.
 * Otherwise: CURRENT/NEXT map directly from `classifyRunWeek`; PAST and
 * FUTURE both resolve to ARCHIVE — a holding placement that keeps the
 * CURRENT/NEXT sections strictly limited to Runs actually in those weeks
 * while never deleting/recreating the same already-provisioned channel (see
 * docs/features/discord-bot.md § weekly raid-ID sections).
 */
export type DiscordRunChannelTarget = "CURRENT" | "NEXT" | "ARCHIVE";

function resolveDiscordTarget(
  run: { scheduledStartAt: string; archivedAt: string | null },
  now: Date,
): DiscordRunChannelTarget {
  if (run.archivedAt) return "ARCHIVE";
  const { bucket } = classifyRunWeek({ scheduledStartAt: run.scheduledStartAt, now });
  if (bucket === "CURRENT") return "CURRENT";
  if (bucket === "NEXT") return "NEXT";
  return "ARCHIVE";
}

export type SignupEmbedMember = {
  signupId: string;
  userId: string;
  userName: string;
  /** Discord handle for plain `@username` lines (never a guild nickname mention). */
  discordUsername: string | null;
  discordUserId: string | null;
  characterName: string | null;
  characterRealm: string | null;
  wowClass: WowClass | null;
};

export type SignupEmbedRoleMembers = {
  tanks: SignupEmbedMember[];
  healers: SignupEmbedMember[];
  dps: SignupEmbedMember[];
  lootbuddies: SignupEmbedMember[];
};

export type SignupEmbedRoleStatus = {
  signed: number;
  picked: number;
  target: number;
};

export type SignupEmbedLootbuddyStatus = {
  signed: number;
  picked: number;
};

export type SignupEmbedData = {
  runId: string;
  runTitle: string;
  /** Display alias — same as `productLabel`. */
  raidName: string;
  /** Commercial / classified product label (e.g. Season 2 Bundle). */
  productLabel: string;
  /** Ordered content summary — per-raid segments (e.g. Nymrissa 1/1 · VA 8/8). Kept for sync/signature; not shown on the signup embed. */
  contentSummary: string;
  /** Compact title coverage from persisted contents (e.g. `8/8`, Bundle `9/9`). */
  titleCoverage: string;
  /** Raid Lead display name (always set). */
  raidLeadName: string;
  /** Discord snowflake for the Raid Lead, when their account is linked. */
  raidLeadDiscordUserId: string | null;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  runStatus: RunStatus;
  signupWindowOpen: boolean;
  /**
   * Distinct Users with an active (PENDING or SELECTED) offer — never a row
   * count, never WITHDRAWN/NOT_SELECTED, and never the sum of per-role signed.
   */
  uniqueSignupCount: number;
  /**
   * Per-role volunteered (signed) vs authoritative roster (picked) counts.
   * Counts are derived from `members` so they cannot drift from the lists.
   */
  roleStatus: {
    tank: SignupEmbedRoleStatus;
    healer: SignupEmbedRoleStatus;
    dps: SignupEmbedRoleStatus;
    lootbuddy: SignupEmbedLootbuddyStatus;
  };
  /**
   * Participants behind those counts. Signed is offered-role projection
   * (multi-role boosters appear in every offered role). Picked is one
   * authoritative role (draft selectedRole or publishedRole).
   */
  members: {
    signed: SignupEmbedRoleMembers;
    picked: SignupEmbedRoleMembers;
  };
};

export type RosterEmbedMember = {
  userId: string;
  userName: string;
  discordUserId: string | null;
  characterName: string;
  characterRealm: string;
};

export type RosterEmbedData = {
  runId: string;
  runTitle: string;
  raidName: string;
  productLabel: string;
  contentSummary: string;
  difficulty: RaidDifficulty;
  publishedAt: string;
  version: number;
  /**
   * Tank/Healer targets come from the Run's real desired counts. DPS has no
   * melee/ranged split target in the current Run schema (desiredDpsCount is
   * one combined number) — melee/ranged DPS groups are reported without a
   * denominator rather than inventing one.
   */
  targets: { tanks: number; healers: number };
  groups: {
    tanks: RosterEmbedMember[];
    healers: RosterEmbedMember[];
    meleeDps: RosterEmbedMember[];
    rangedDps: RosterEmbedMember[];
    lootbuddies: RosterEmbedMember[];
  };
  totalSelected: number;
};

/**
 * existingChannelId/existingMessageId let the bot edit its own prior post;
 * both are null when nothing has been posted for this Run yet.
 * existingRunChannelId/desiredChannelName drive per-Run channel provisioning
 * (bot-side DISCORD_RUN_CATEGORY_ID) — desiredChannelName is always computed
 * so a schedule/difficulty/raid-lead change is reflected as a rename even
 * when a bot instance is running in legacy single-channel mode and ignores it.
 */
/**
 * Reconciliation for a Run's EXISTING dedicated Discord channel — name,
 * parent category, and (for CURRENT/NEXT) its section ordering — fully
 * independent of signup/roster message state. `existingRunChannelId` is
 * always non-null: this item means "this Run already owns a channel; keep
 * its live Discord state correct," never
 * "provision a first channel." First-channel provisioning stays exclusively
 * gated behind the signup path's `isSignupWindowOpen` + week-bucket rule below.
 */
export type ChannelSyncWorkItem = {
  runId: string;
  existingRunChannelId: string;
  desiredChannelName: string;
  targetBucket: DiscordRunChannelTarget;
  /** Needed by the bot's CURRENT/NEXT section position reconciliation to order channels chronologically — never used for week classification itself, which already happened above. */
  scheduledStartAt: string;
  /** True only when `Run.archivedAt` is set — PAST/FUTURE ARCHIVE holding is false. */
  appArchived: boolean;
  /**
   * App-archive only: bot should post Discord log artifacts and/or persist HTML
   * for website download. False for schedule-based ARCHIVE holding and after
   * message ids + HTML are recorded.
   */
  archiveArtifactsNeeded: boolean;
  /** Already-posted Discord log message ids — when both set, bot skips re-send and only persists HTML. */
  archiveCloseMessageId: string | null;
  archiveTranscriptMessageId: string | null;
  /** Raid Lead display name — Ticket Owner on the archive log embed. */
  raidLeadName: string;
  /** Raid Lead Discord snowflake when linked — used for <@id> mention. */
  raidLeadDiscordUserId: string | null;
  /** Product / panel label for the archive log embed (e.g. raid product name). */
  panelName: string;
};

export type SignupSyncWorkItem = {
  runId: string;
  existingChannelId: string | null;
  existingMessageId: string | null;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  /** Where the Run's channel, if any, belongs — CURRENT, NEXT, or ARCHIVE. */
  targetBucket: DiscordRunChannelTarget;
  /** Carried so a same-pass first-channel create can join CURRENT/NEXT position reconciliation without re-classifying the week. */
  scheduledStartAt: string;
};
export type RosterSyncWorkItem = {
  runId: string;
  existingChannelId: string | null;
  existingMessageId: string | null;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  targetBucket: DiscordRunChannelTarget;
};

export type RunStartSyncWorkItem = {
  runId: string;
  existingChannelId: string | null;
  existingMessageId: string | null;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  targetBucket: DiscordRunChannelTarget;
};

export type RunStartEmbedMember = {
  signupId: string;
  userId: string;
  userName: string;
  discordUserId: string | null;
  characterName: string;
  characterRealm: string;
  /** WoW class enum when known — used for optional Discord class emoji mapping. */
  wowClass: WowClass | null;
  classLabel: string | null;
  /** Informational lockout label; not rendered in the compact Final Setup post. */
  saveLabel: string;
  participationType: "BOOSTER" | "LOOTBUDDY";
  /** The Raid Lead's assignment for this slot; null for LOOTBUDDY. */
  selectedRole: CharacterRole | null;
};

export type RunStartEmbedData = {
  runId: string;
  runTitle: string;
  raidName: string;
  productLabel: string;
  contentSummary: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  scheduledStartAt: string;
  /** Desired composition from the Run — never inferred from selected counts. */
  targets: {
    tanks: number;
    healers: number;
    dps: number;
  };
  groups: {
    tanks: RunStartEmbedMember[];
    healers: RunStartEmbedMember[];
    dps: RunStartEmbedMember[];
    lootbuddies: RunStartEmbedMember[];
  };
  totalSelected: number;
};

function desiredChannelNameFor(run: {
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  raidLeadName: string;
  contentDisplay: { channelCoverage: string };
  archivedAt?: string | null;
}): string {
  const input = {
    scheduledStartAt: run.scheduledStartAt,
    difficulty: run.difficulty,
    lootType: run.lootType,
    coverage: run.contentDisplay.channelCoverage,
    raidLeadName: run.raidLeadName,
  };
  if (run.archivedAt) return buildClosedDiscordRunChannelName(input);
  return buildDiscordRunChannelName(input);
}

/**
 * The single normalized projection of a Run's rendered signup-embed content.
 * `getSignupEmbedData`, `listSyncWork`, and `recordSignupPost` all derive
 * from this one function so the rendered DTO and the change-detection
 * signature can never drift apart the way they previously did (a raid edit
 * changed `raidName`/`raidId` in the rendered embed but was invisible to the
 * old hand-maintained signature field list).
 */
function toSignupEmbedData(run: RunListRecord): SignupEmbedData {
  const active = run.signups.filter((signup) => isActiveSignupOffer(signup.status));
  const projection = buildSignupRoleProjection(run, active);

  const productLabel = run.contentDisplay.productLabel;
  return {
    runId: run.id,
    runTitle: run.title,
    raidName: productLabel,
    productLabel,
    contentSummary: run.contentDisplay.summary,
    titleCoverage: run.contentDisplay.titleCoverage,
    raidLeadName: run.raidLeadName,
    raidLeadDiscordUserId: run.raidLeadDiscordUserId,
    difficulty: run.difficulty,
    lootType: run.lootType,
    scheduledStartAt: run.scheduledStartAt,
    runStatus: run.status,
    signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
    uniqueSignupCount: new Set(active.map((signup) => signup.userId)).size,
    roleStatus: projection.roleStatus,
    members: projection.members,
  };
}

/**
 * OPEN / ROSTERING (and pre-publish): picked = saved draft selections.
 * PUBLISHED+: picked = live SELECTED signups + publishedRole (replacement drafts stay private).
 * Counts are length-derived from the same member lists rendered in the embed.
 */
function buildSignupRoleProjection(
  run: RunListRecord,
  activeSignups: RunListRecord["signups"],
): Pick<SignupEmbedData, "roleStatus" | "members"> {
  const signedTanks = sortSignupEmbedMembers(
    activeSignups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.offeredRoles.includes("TANK"))
      .map(toSignupEmbedMember),
  );
  const signedHealers = sortSignupEmbedMembers(
    activeSignups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.offeredRoles.includes("HEALER"))
      .map(toSignupEmbedMember),
  );
  const signedDps = sortSignupEmbedMembers(
    activeSignups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.offeredRoles.includes("DPS"))
      .map(toSignupEmbedMember),
  );
  const signedLoot = sortSignupEmbedMembers(
    activeSignups.filter((signup) => signup.participationType === "LOOTBUDDY").map(toSignupEmbedMember),
  );

  const usePublishedPicks =
    run.status === "PUBLISHED" || run.status === "IN_PROGRESS" || run.status === "COMPLETED";
  const byId = new Map(run.signups.map((signup) => [signup.id, signup]));
  const pickedRows: RunListRecord["signups"] = [];

  if (usePublishedPicks) {
    for (const signup of run.signups) {
      if (signup.status !== "SELECTED") continue;
      pickedRows.push(signup);
    }
  } else {
    for (const selection of run.roster?.selections ?? []) {
      if (!selection.selected) continue;
      const signup = byId.get(selection.signupId);
      if (!signup || !isActiveSignupOffer(signup.status)) continue;
      pickedRows.push({
        ...signup,
        // Draft picks use selectedRole as the authoritative display role.
        publishedRole: selection.selectedRole,
      });
    }
  }

  const pickedTanks = sortSignupEmbedMembers(
    pickedRows
      .filter((signup) => signup.participationType === "BOOSTER" && signup.publishedRole === "TANK")
      .map(toSignupEmbedMember),
  );
  const pickedHealers = sortSignupEmbedMembers(
    pickedRows
      .filter((signup) => signup.participationType === "BOOSTER" && signup.publishedRole === "HEALER")
      .map(toSignupEmbedMember),
  );
  const pickedDps = sortSignupEmbedMembers(
    pickedRows
      .filter((signup) => signup.participationType === "BOOSTER" && signup.publishedRole === "DPS")
      .map(toSignupEmbedMember),
  );
  const pickedLoot = sortSignupEmbedMembers(
    pickedRows.filter((signup) => signup.participationType === "LOOTBUDDY").map(toSignupEmbedMember),
  );

  const members = {
    signed: {
      tanks: signedTanks,
      healers: signedHealers,
      dps: signedDps,
      lootbuddies: signedLoot,
    },
    picked: {
      tanks: pickedTanks,
      healers: pickedHealers,
      dps: pickedDps,
      lootbuddies: pickedLoot,
    },
  };

  return {
    members,
    roleStatus: {
      tank: {
        signed: members.signed.tanks.length,
        picked: members.picked.tanks.length,
        target: run.desiredTankCount,
      },
      healer: {
        signed: members.signed.healers.length,
        picked: members.picked.healers.length,
        target: run.desiredHealerCount,
      },
      dps: {
        signed: members.signed.dps.length,
        picked: members.picked.dps.length,
        target: run.desiredDpsCount,
      },
      lootbuddy: {
        signed: members.signed.lootbuddies.length,
        picked: members.picked.lootbuddies.length,
      },
    },
  };
}

function toSignupEmbedMember(signup: RunListRecord["signups"][number]): SignupEmbedMember {
  const wowClass =
    signup.participationType === "LOOTBUDDY"
      ? (signup.lootbuddyClass ?? signup.character?.wowClass ?? null)
      : (signup.character?.wowClass ?? null);
  return {
    signupId: signup.id,
    userId: signup.userId,
    userName: signup.userName,
    discordUsername: signup.discordUsername,
    discordUserId: signup.discordUserId,
    characterName: signup.character?.name ?? null,
    characterRealm: signup.character?.realm ?? null,
    wowClass,
  };
}

function sortSignupEmbedMembers(members: SignupEmbedMember[]): SignupEmbedMember[] {
  return [...members].sort((a, b) => {
    const nameCmp = (a.characterName ?? "").localeCompare(b.characterName ?? "");
    if (nameCmp !== 0) return nameCmp;
    const realmCmp = (a.characterRealm ?? "").localeCompare(b.characterRealm ?? "");
    if (realmCmp !== 0) return realmCmp;
    const userCmp = a.userName.localeCompare(b.userName);
    if (userCmp !== 0) return userCmp;
    return a.signupId.localeCompare(b.signupId);
  });
}

/**
 * Deterministic signature built FROM the normalized `SignupEmbedData` —
 * every field that can change the rendered embed content is a property on
 * `data`, so a future embed field only needs to be added to `SignupEmbedData`
 * and this function picks it up automatically. `channelName` and
 * `targetBucket` are folded in on top (not part of the rendered embed
 * content itself, but still real sync signals: a rename, an Archive/Restore,
 * or a weekly CURRENT/NEXT rollover) — they must never be the ONLY thing
 * standing in for a content change.
 */
function buildSignupEmbedSignature(
  data: SignupEmbedData,
  extra: {
    channelName: string;
    targetBucket: DiscordRunChannelTarget;
    /** Guild class-emoji markup fingerprint from the bot — omit only in tests. */
    classEmojiFingerprint?: string;
  },
): string {
  return JSON.stringify({
    runTitle: data.runTitle,
    productLabel: data.productLabel,
    contentSummary: data.contentSummary,
    titleCoverage: data.titleCoverage,
    raidLeadName: data.raidLeadName,
    raidLeadDiscordUserId: data.raidLeadDiscordUserId,
    difficulty: data.difficulty,
    lootType: data.lootType,
    scheduledStartAt: data.scheduledStartAt,
    runStatus: data.runStatus,
    signupWindowOpen: data.signupWindowOpen,
    uniqueSignupCount: data.uniqueSignupCount,
    roleStatus: data.roleStatus,
    members: data.members,
    channelName: extra.channelName,
    targetBucket: extra.targetBucket,
    classEmojiFingerprint: extra.classEmojiFingerprint ?? "",
    // Bump when participant line / summary-field rendering changes without
    // member-data changes so existing posts refresh (Content→Raid Lead, role emojis).
    participantLineFormat: "mention-v2-raidlead",
  });
}

/** A characterless Lootbuddy has no Character to name — its own Class snapshot stands in for display; legacy Character-backed Lootbuddy rows still show their Character. */
function toMember(row: RosterSignupRow): RosterEmbedMember {
  const lootbuddyClassLabel = row.lootbuddyClass ? CLASS_LABELS[row.lootbuddyClass] : null;
  return {
    userId: row.userId,
    userName: row.userName,
    discordUserId: row.discordUserId,
    characterName: row.character?.name ?? lootbuddyClassLabel ?? "Unknown character",
    characterRealm: row.character?.realm ?? "",
  };
}

/** Published projections group by the snapshotted publishedRole — a hybrid appears in exactly one section. */
function boosterByRole(selected: RosterSignupRow[], role: CharacterRole): RosterSignupRow[] {
  return selected.filter((row) => row.participationType === "BOOSTER" && row.publishedRole === role);
}

function shortSaveLabel(kind: ReturnType<typeof formatTargetRaidLockoutLabel>["kind"]): string {
  if (kind === "unsaved") return "Unsaved";
  if (kind === "saved") return "Saved";
  if (kind === "fully_saved") return "Fully saved";
  return "Unknown";
}

function compareStartMembers(a: RunStartEmbedMember, b: RunStartEmbedMember): number {
  const byName = a.characterName.localeCompare(b.characterName, "en");
  if (byName !== 0) return byName;
  return a.userName.localeCompare(b.userName, "en");
}

function toStartMember(
  row: RosterSignupRow,
  run: {
    contents: RunListRecord["contents"];
    difficulty: RaidDifficulty;
    scheduledStartAt: string;
    lootType: RunLootType;
  },
): RunStartEmbedMember {
  const lootbuddyClass: WowClass | null = row.lootbuddyClass ?? row.character?.wowClass ?? null;
  const classLabel = row.participationType === "BOOSTER"
    ? row.character
      ? CLASS_LABELS[row.character.wowClass]
      : null
    : lootbuddyClass
      ? CLASS_LABELS[lootbuddyClass]
      : null;

  let saveLabel = "Unknown";
  if (row.participationType === "BOOSTER" && row.character) {
    const resetIdentifier = lockoutService.getResetIdentifierForRun(
      row.character.region,
      run.scheduledStartAt,
    );
    const contentSaves = projectRunContentLockouts({
      contents: run.contents,
      difficulty: run.difficulty,
      lootType: run.lootType,
      findSave: (content) => {
        const matchingLockout = lockoutService.findExactLockout(row.character!.lockouts, {
          raidId: content.raidId,
          difficulty: run.difficulty,
          resetIdentifier,
        });
        return matchingLockout
          ? lockoutService.toRaidSaveInfo(matchingLockout, content.totalBossCount)
          : null;
      },
    });
    saveLabel =
      contentSaves.length === 0
        ? "Unknown"
        : contentSaves.map((entry) => shortSaveLabel(entry.label.kind)).join(" · ");
  }

  return {
    signupId: row.id,
    userId: row.userId,
    userName: row.userName,
    discordUserId: row.discordUserId,
    characterName:
      row.character?.name ??
      (row.lootbuddyClass ? CLASS_LABELS[row.lootbuddyClass] : null) ??
      "Unknown character",
    characterRealm: row.character?.realm ?? "",
    wowClass:
      row.participationType === "BOOSTER"
        ? (row.character?.wowClass ?? null)
        : lootbuddyClass,
    classLabel,
    saveLabel,
    participationType: row.participationType,
    selectedRole: row.publishedRole,
  };
}

/**
 * Presentation-only integration state for the Discord bot. Never a second
 * source of truth: every DTO here is re-derived from the same Run/Signup/
 * Roster data the Web UI reads, and `RunDiscordPost` only remembers which
 * Discord message already represents that data.
 */
export const discordSyncService = {
  /**
   * `channels`: every Run that already owns a dedicated Discord channel,
   * for independent name/category reconciliation — completely unconditional
   * on message dirtiness, Run status, or archive state (see
   * `ChannelSyncWorkItem`). `signups`/`roster`: Runs whose posted (or
   * not-yet-posted) Discord message no longer matches current BoostingHub
   * state.
   *
   * The *first* signup post for a Run only happens while signup is actually
   * available (`isSignupWindowOpen` — OPEN or ROSTERING with `signupsOpen`
   * true) AND the Run's schedule currently classifies CURRENT or NEXT — never
   * merely because the Run left DRAFT, and never for a Run scheduled too far
   * out (FUTURE): a Run the bot only sees for the first time after it already
   * reached PUBLISHED/COMPLETED/CANCELLED (e.g. the bot was offline through
   * its whole signup phase) must not get a brand-new "Signups: 0" post for a
   * phase that's already over, and a Run scheduled weeks ahead must not get
   * Discord infrastructure before its raid-ID week is even CURRENT/NEXT.
   * Once a post exists, later updates are unconditional regardless of week
   * bucket — the same message keeps reflecting the Run's real state
   * (including signups closing, or the Run rolling PAST/into ARCHIVE
   * holding) all the way through completion, which is deliberate
   * informational continuity, not a re-trigger of the creation gate.
   */
  async listSyncWork(
    now: Date = new Date(),
    options: { classEmojiFingerprint?: string } = {},
  ): Promise<{
    channels: ChannelSyncWorkItem[];
    signups: SignupSyncWorkItem[];
    roster: RosterSyncWorkItem[];
    start: RunStartSyncWorkItem[];
  }> {
    const runs = await runRepository.listManaged();
    const channels: ChannelSyncWorkItem[] = [];
    const signups: SignupSyncWorkItem[] = [];
    const roster: RosterSyncWorkItem[] = [];
    const start: RunStartSyncWorkItem[] = [];
    const classEmojiFingerprint = options.classEmojiFingerprint ?? "";

    for (const run of runs) {
      const post = await runDiscordPostRepository.findByRunId(run.id);
      const targetBucket = resolveDiscordTarget(run, now);

      // Channel reconciliation is fully independent of message state and of
      // Run status/archive-ness itself — any Run that already owns a
      // dedicated Discord channel must keep having that channel's name,
      // parent category, and CURRENT/NEXT section position checked on every
      // poll, regardless of DRAFT status or whether a signup/roster message
      // currently needs updating. This never provisions a first channel
      // (existingRunChannelId is only ever set once the signup path below
      // has already created one).
      if (post?.runChannelId) {
        const appArchived = Boolean(run.archivedAt);
        const archiveDiscordPosted = Boolean(
          post.archiveCloseMessageId && post.archiveTranscriptMessageId,
        );
        const archiveArtifactsNeeded =
          appArchived && (!archiveDiscordPosted || !post.archiveTranscriptHtml);
        channels.push({
          runId: run.id,
          existingRunChannelId: post.runChannelId,
          desiredChannelName: desiredChannelNameFor(run),
          targetBucket,
          scheduledStartAt: run.scheduledStartAt,
          appArchived,
          archiveArtifactsNeeded,
          archiveCloseMessageId: post.archiveCloseMessageId,
          archiveTranscriptMessageId: post.archiveTranscriptMessageId,
          raidLeadName: run.raidLeadName,
          raidLeadDiscordUserId: run.raidLeadDiscordUserId,
          panelName: run.contentDisplay.productLabel,
        });
      }

      if (run.status === "DRAFT") continue;

      const hasExistingSignupPost = Boolean(post?.signupMessageId);
      // A brand-new channel/message may only be created for a Run whose week
      // is actually CURRENT or NEXT — PAST and FUTURE both resolve to
      // ARCHIVE above, so gating on `targetBucket !== "ARCHIVE"` here blocks
      // first provisioning for both without duplicating the week logic.
      const eligibleForFirstProvisioning = isSignupWindowOpen(run.status, run.signupsOpen) && targetBucket !== "ARCHIVE";
      if (hasExistingSignupPost || eligibleForFirstProvisioning) {
        const signature = buildSignupEmbedSignature(toSignupEmbedData(run), {
          channelName: desiredChannelNameFor(run),
          targetBucket,
          classEmojiFingerprint,
        });
        if (!hasExistingSignupPost || post!.lastSignupSignature !== signature) {
          signups.push({
            runId: run.id,
            existingChannelId: post?.signupChannelId ?? null,
            existingMessageId: post?.signupMessageId ?? null,
            existingRunChannelId: post?.runChannelId ?? null,
            desiredChannelName: desiredChannelNameFor(run),
            targetBucket,
            scheduledStartAt: run.scheduledStartAt,
          });
        }
      }

      // A roster post reuses the Run's own channel — it never provisions one.
      // A Run whose roster was published without the bot ever having a
      // Discord presence for its signup phase (seeded/historical data, or
      // the bot being offline through the whole signup window) has nowhere
      // to legitimately post a roster embed, matching the same rule that
      // blocks a retroactive first signup post for a phase that's over.
      //
      // Sync detection here is keyed only on `roster.version`, unlike the
      // signup embed's full content signature above — this is safe, not a
      // gap: publishing a roster always advances `run.status` to PUBLISHED
      // (see roster.service.ts publishRoster), and every field rendered in
      // `RosterEmbedData` (runTitle, raidName, difficulty — see
      // `getRosterEmbedData` below) is gated by `canEditIdentityFields`
      // (DRAFT/OPEN only) or `canEditPlanningFields` (DRAFT/OPEN/ROSTERING
      // only) in run-state.ts, neither of which ever includes PUBLISHED (or
      // any later status). So none of those fields can legally change for as
      // long as a published roster (and thus a roster post) exists — the
      // only way `RosterEmbedData` content changes is a re-publish, which is
      // exactly what bumps `roster.version`.
      const hasAnyDiscordPresence = Boolean(post?.runChannelId) || Boolean(post?.signupChannelId);
      if (run.roster?.publishedAt && hasAnyDiscordPresence) {
        if (!post?.rosterMessageId || post.lastRosterVersion !== run.roster.version) {
          roster.push({
            runId: run.id,
            existingChannelId: post?.rosterChannelId ?? null,
            existingMessageId: post?.rosterMessageId ?? null,
            existingRunChannelId: post?.runChannelId ?? null,
            desiredChannelName: desiredChannelNameFor(run),
            targetBucket,
          });
        }
      }

      // Operational Run Start post: only after IN_PROGRESS+ with an immutable
      // start snapshot, and only into an already-provisioned dedicated channel.
      // Never creates a first channel. Immutable content → post once (message
      // id presence is the only dirtiness signal).
      const started = run.status === "IN_PROGRESS" || run.status === "COMPLETED";
      const dedicatedChannelId = post?.runChannelId ?? post?.signupChannelId ?? null;
      if (started && dedicatedChannelId && !post?.startMessageId) {
        const snapshot = await runStartSnapshotRepository.findByRunId(run.id);
        if (snapshot) {
          start.push({
            runId: run.id,
            existingChannelId: post?.startChannelId ?? null,
            existingMessageId: post?.startMessageId ?? null,
            existingRunChannelId: post?.runChannelId ?? null,
            desiredChannelName: desiredChannelNameFor(run),
            targetBucket,
          });
        }
      }
    }

    return { channels, signups, roster, start };
  },

  async getSignupEmbedData(runId: string): Promise<SignupEmbedData | null> {
    const run = await runRepository.findById(runId);
    if (!run) return null;
    return toSignupEmbedData(run);
  },

  /** Null when the Run has no published roster yet — there is nothing to post. */
  async getRosterEmbedData(runId: string): Promise<RosterEmbedData | null> {
    const run = await runRepository.findById(runId);
    if (!run || !run.roster?.publishedAt) return null;

    const rows = await rosterRepository.listSignups(runId);
    const selected = rows.filter((row) => row.status === "SELECTED");
    const dps = boosterByRole(selected, "DPS");
    const rangedDps = dps.filter(
      (row) => attackTypeForSpecialization(row.character?.wowClass ?? "WARRIOR", row.character?.specialization ?? null) === "RANGED",
    );
    const rangedIds = new Set(rangedDps.map((row) => row.id));
    const meleeDps = dps.filter((row) => !rangedIds.has(row.id));

    return {
      runId: run.id,
      runTitle: run.title,
      raidName: run.contentDisplay.productLabel,
      productLabel: run.contentDisplay.productLabel,
      contentSummary: run.contentDisplay.summary,
      difficulty: run.difficulty,
      publishedAt: run.roster.publishedAt,
      version: run.roster.version,
      targets: { tanks: run.desiredTankCount, healers: run.desiredHealerCount },
      groups: {
        tanks: boosterByRole(selected, "TANK").map(toMember),
        healers: boosterByRole(selected, "HEALER").map(toMember),
        meleeDps: meleeDps.map(toMember),
        rangedDps: rangedDps.map(toMember),
        lootbuddies: selected.filter((row) => row.participationType === "LOOTBUDDY").map(toMember),
      },
      totalSelected: selected.length,
    };
  },

  /** Recorded immediately on channel creation, before any message is posted into it. */
  async recordRunChannel(input: { runId: string; channelId: string }): Promise<void> {
    await runDiscordPostRepository.recordRunChannel(input);
  },

  async recordSignupPost(
    input: { runId: string; channelId: string; messageId: string; classEmojiFingerprint?: string },
    now: Date = new Date(),
  ): Promise<void> {
    const run = await runRepository.findById(input.runId);
    if (!run) return;
    const signature = buildSignupEmbedSignature(toSignupEmbedData(run), {
      channelName: desiredChannelNameFor(run),
      targetBucket: resolveDiscordTarget(run, now),
      classEmojiFingerprint: input.classEmojiFingerprint ?? "",
    });
    await runDiscordPostRepository.recordSignupPost({
      runId: input.runId,
      signupChannelId: input.channelId,
      signupMessageId: input.messageId,
      lastSignupSignature: signature,
    });
  },

  async recordRosterPost(input: { runId: string; channelId: string; messageId: string }): Promise<void> {
    const run = await runRepository.findById(input.runId);
    if (!run?.roster) return;
    await runDiscordPostRepository.recordRosterPost({
      runId: input.runId,
      rosterChannelId: input.channelId,
      rosterMessageId: input.messageId,
      lastRosterVersion: run.roster.version,
    });
  },

  /**
   * Null when the Run has not started (no immutable snapshot) or has no
   * attendance-snapshotted participants. Source of truth is attendance
   * signup IDs joined to roster signup rows for Discord/class/lockout data.
   */
  async getRunStartEmbedData(runId: string): Promise<RunStartEmbedData | null> {
    const run = await runRepository.findById(runId);
    if (!run) return null;
    if (run.status !== "IN_PROGRESS" && run.status !== "COMPLETED") return null;

    const snapshot = await runStartSnapshotRepository.findByRunId(runId);
    if (!snapshot) return null;

    const attendance = await attendanceRepository.listByRunId(runId);
    if (attendance.length === 0) return null;

    const signupRows = await rosterRepository.listSignups(runId);
    const bySignupId = new Map(signupRows.map((row) => [row.id, row]));
    const members: RunStartEmbedMember[] = [];
    for (const row of attendance) {
      const signup = bySignupId.get(row.signupId);
      if (!signup) continue;
      members.push(toStartMember(signup, run));
    }

    const tanks = members.filter((m) => m.participationType === "BOOSTER" && m.selectedRole === "TANK").sort(compareStartMembers);
    const healers = members.filter((m) => m.participationType === "BOOSTER" && m.selectedRole === "HEALER").sort(compareStartMembers);
    const dps = members.filter((m) => m.participationType === "BOOSTER" && m.selectedRole === "DPS").sort(compareStartMembers);
    const lootbuddies = members.filter((m) => m.participationType === "LOOTBUDDY").sort(compareStartMembers);

    return {
      runId: run.id,
      runTitle: run.title,
      raidName: run.contentDisplay.productLabel,
      productLabel: run.contentDisplay.productLabel,
      contentSummary: run.contentDisplay.summary,
      difficulty: run.difficulty,
      lootType: run.lootType,
      scheduledStartAt: run.scheduledStartAt,
      targets: {
        tanks: run.desiredTankCount,
        healers: run.desiredHealerCount,
        dps: run.desiredDpsCount,
      },
      groups: { tanks, healers, dps, lootbuddies },
      totalSelected: members.length,
    };
  },

  async recordStartPost(input: { runId: string; channelId: string; messageId: string }): Promise<void> {
    await runDiscordPostRepository.recordStartPost({
      runId: input.runId,
      startChannelId: input.channelId,
      startMessageId: input.messageId,
    });
  },

  async recordArchiveArtifacts(input: {
    runId: string;
    closeMessageId: string;
    transcriptMessageId: string;
    transcriptHtml: string;
    transcriptFilename: string;
  }): Promise<void> {
    await runDiscordPostRepository.recordArchiveArtifacts({
      runId: input.runId,
      archiveCloseMessageId: input.closeMessageId,
      archiveTranscriptMessageId: input.transcriptMessageId,
      archiveTranscriptHtml: input.transcriptHtml,
      archiveTranscriptFilename: input.transcriptFilename,
    });
  },

  /** Website download payload — managers only; never returned on bot sync. */
  async getArchiveTranscriptForDownload(runId: string): Promise<{
    html: string;
    filename: string;
  } | null> {
    const post = await runDiscordPostRepository.findByRunId(runId);
    if (!post?.archiveTranscriptHtml) return null;
    return {
      html: post.archiveTranscriptHtml,
      filename: post.archiveTranscriptFilename ?? "transcript.html",
    };
  },

  async clearArchiveArtifacts(runId: string): Promise<void> {
    await runDiscordPostRepository.clearArchiveArtifacts(runId);
  },

  async clearRunChannel(runId: string): Promise<void> {
    await runDiscordPostRepository.clearRunChannel(runId);
  },
};
