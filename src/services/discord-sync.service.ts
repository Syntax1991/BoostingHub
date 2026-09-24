import type { CharacterRole, NotificationType, RaidDifficulty, RunLootType, RunStatus, WowClass } from "@/models/enums";
import {
  buildClosedDiscordRunChannelName,
  buildDiscordRunChannelName,
  effectiveRaidLeadChannelName,
  formatRunVoiceChannelName,
} from "@/lib/discord-channel-name";
import { CLASS_LABELS } from "@/lib/labels";
import { formatTargetRaidLockoutLabel } from "@/lib/raid-lockout-label";
import { attackTypeForSpecialization, defaultDpsAttackTypeForClass } from "@/lib/wow-specializations";
import type { ExternalBooster } from "@/lib/external-booster";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { runDiscordAnnouncementRepository } from "@/repositories/run-discord-announcement.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { rosterRepository, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository, type RunListRecord } from "@/repositories/run.repository";
import { runStartSnapshotRepository } from "@/repositories/run-start-snapshot.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { projectRunContentLockouts } from "@/lib/run-content-lockouts";
import { lockoutService } from "@/services/lockout.service";
import { isSignupWindowOpen } from "@/services/run-state";
import { isActiveSignupOffer } from "@/services/signup-state";
import { parseRescheduleHrefTimestamps } from "@/services/notification-content";

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
  /** Ordered content summary — per-raid segments (e.g. Tide 1/1 · VA 8/8). Kept for sync/signature; not shown on the signup embed. */
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
   * Participants behind those counts. Signups is offered-role projection for
   * Users not yet on the roster (multi-role boosters appear in every offered
   * role). Roster (`picked`) is one authoritative role (draft selectedRole or
   * publishedRole); rostered Users are omitted from Signups.
   */
  members: {
    signed: SignupEmbedRoleMembers;
    picked: SignupEmbedRoleMembers;
  };
  /** When true, first channel provision pings Tank/Healer/DPS Discord roles. */
  discordRolePing: boolean;
};

export type RosterEmbedMember = {
  userId: string;
  userName: string;
  discordUserId: string | null;
  characterName: string;
  characterRealm: string;
  /** WoW class for Discord class emoji — null when unknown. */
  wowClass: WowClass | null;
  /** Hand-added unregistered booster — rendered as `@name <class>`. */
  external?: boolean;
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
  /**
   * True when the Run channel should be retired (transcript + delete):
   * app-archived (`Run.archivedAt`), COMPLETED, or CANCELLED.
   * Schedule-based PAST/FUTURE ARCHIVE holding stays false.
   * False while PENDING RunDiscordAnnouncement rows exist for this Run
   * (cancellation message must post before transcript/delete).
   */
  retireChannel: boolean;
  /**
   * True when retirement is desired but blocked by PENDING lifecycle
   * announcements — bot must not delete the channel this pass.
   */
  pendingLifecycleAnnouncements: boolean;
  /**
   * Retirement path: bot should post Discord log artifacts and/or persist HTML
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

/**
 * Temporary per-Run GuildVoice channel lifecycle, independent of the text
 * channel lane (`channels`) and its CURRENT/NEXT ordering.
 * - PROVISION: IN_PROGRESS, start snapshot exists, no voice channel yet
 * - RECONCILE: IN_PROGRESS with a voice channel — keep it, even when empty
 * - RETIRE_IF_EMPTY: COMPLETED / CANCELLED / app-archived (or otherwise no
 *   longer IN_PROGRESS) — delete only once nobody is connected
 */
export type DiscordRunVoiceChannelAction = "PROVISION" | "RECONCILE" | "RETIRE_IF_EMPTY";

export type DiscordRunVoiceChannelWorkItem = {
  runId: string;
  existingVoiceChannelId: string | null;
  /** `Raid with <effective Raid Lead>` — never Run.title or the Start Run actor. */
  desiredVoiceChannelName: string;
  action: DiscordRunVoiceChannelAction;
};

/**
 * Pure lifecycle decision for a Run's voice channel. First creation only for an
 * IN_PROGRESS, non-archived Run with a start snapshot — never retroactively for
 * a Run that already ended before the bot observed it.
 */
export function planRunVoiceChannel(input: {
  status: RunStatus;
  archivedAt: string | null;
  voiceChannelId: string | null;
  hasStartSnapshot: boolean;
}): DiscordRunVoiceChannelAction | null {
  const running = input.status === "IN_PROGRESS" && !input.archivedAt;
  if (input.voiceChannelId) return running ? "RECONCILE" : "RETIRE_IF_EMPTY";
  if (running && input.hasStartSnapshot) return "PROVISION";
  return null;
}

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
  /**
   * True only while the signup window is open on CURRENT/NEXT. Continuity
   * edits for CANCELLED/COMPLETED (or ARCHIVE-held) Runs must never create a
   * replacement channel — that re-fires Raidboost Announce role pings.
   */
  allowChannelCreate: boolean;
  /**
   * False once this Run's signup post has gone out (`signupPostedAt`). A
   * channel recreated after the first one was deleted must not repeat the
   * Raidboost Announce role pings.
   */
  announceOnCreate: boolean;
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

/** Apex-style Raid Invite DM — kept for bot/API backward compatibility; listSyncWork returns []. */
export type RaidInviteWorkItem = {
  runId: string;
  signupId: string;
  discordUserId: string;
  /** Persisted RunDiscordPost.runChannelId — null when the Run has no dedicated channel yet. */
  runChannelId: string | null;
  productLabel: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  participationType: "BOOSTER" | "LOOTBUDDY";
  selectedRole: CharacterRole | null;
  characterName: string | null;
  wowClass: WowClass | null;
};

/** Unified Discord DM work from pending UserNotification rows. */
export type NotificationDmWorkItem = {
  notificationId: string;
  type: NotificationType;
  discordUserId: string;
  runId: string;
  signupId: string | null;
  runChannelId: string | null;
  /**
   * Current persisted RunDiscordPost.voiceChannelId, read when the DM is due
   * (so a Quiet-Hours-delayed invite never links a voice channel already
   * deleted). The bot prefers its same-pass value. Rendered as a mention by
   * the Discord renderer only — never stored in UserNotification.message.
   */
  voiceChannelId: string | null;
  productLabel: string;
  scheduledStartAt: string;
  /** Set for RUN_RESCHEDULED — previous schedule before this revision. */
  previousScheduledStartAt: string | null;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  participationType: "BOOSTER" | "LOOTBUDDY" | null;
  selectedRole: CharacterRole | null;
  characterName: string | null;
  wowClass: WowClass | null;
};

/** Shared Run-channel lifecycle announcement (not a User DM). */
export type RunAnnouncementWorkItem = {
  announcementId: string;
  runId: string;
  type: "RUN_RESCHEDULED" | "RUN_CANCELLED";
  /** Dedicated Run channel when present — null means bot should mark SKIPPED. */
  runChannelId: string | null;
  previousScheduledStartAt: string | null;
  scheduledStartAt: string;
  productLabel: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
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
  /** Assigned Run Raid Lead's effective display name (Run channel nickname, else name) for the LFG footer. */
  raidLeadDisplayName: string;
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
  raidLeadDiscordRunChannelNickname?: string | null;
  contentDisplay: { channelCoverage: string };
  status?: RunStatus;
  archivedAt?: string | null;
}): string {
  const input = {
    scheduledStartAt: run.scheduledStartAt,
    difficulty: run.difficulty,
    lootType: run.lootType,
    coverage: run.contentDisplay.channelCoverage,
    raidLeadChannelName: effectiveRaidLeadChannelName({
      raidLeadName: run.raidLeadName,
      discordRunChannelNickname: run.raidLeadDiscordRunChannelNickname,
    }),
  };
  if (shouldRetireDiscordChannel(run)) return buildClosedDiscordRunChannelName(input);
  return buildDiscordRunChannelName(input);
}

/** App archive, completed, or cancelled — Discord channel is transcribed then deleted.
 * Terminal Runs must not get a new channel after retirement (`clear-channel`). */
function shouldRetireDiscordChannel(run: { status?: string; archivedAt?: string | null }): boolean {
  if (run.archivedAt) return true;
  return run.status === "COMPLETED" || run.status === "CANCELLED";
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
    discordRolePing: run.discordRolePing,
  };
}

/**
 * OPEN / ROSTERING (and pre-publish): roster = saved draft selections.
 * PUBLISHED+: roster = live SELECTED signups + publishedRole (replacement drafts stay private).
 * Users already on the roster are omitted from the Signups lists so they appear once.
 * Counts are length-derived from the same member lists rendered in the embed.
 */
function buildSignupRoleProjection(
  run: RunListRecord,
  activeSignups: RunListRecord["signups"],
): Pick<SignupEmbedData, "roleStatus" | "members"> {
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

  const externals = run.roster?.externalBoosters ?? [];
  const pickedExternal = (role: CharacterRole) =>
    externals.filter((booster) => booster.role === role).map(externalSignupEmbedMember);

  const rosteredUserIds = new Set(pickedRows.map((signup) => signup.userId));
  const waitingSignups = activeSignups.filter((signup) => !rosteredUserIds.has(signup.userId));

  const signedTanks = sortSignupEmbedMembers(
    waitingSignups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.offeredRoles.includes("TANK"))
      .map(toSignupEmbedMember),
  );
  const signedHealers = sortSignupEmbedMembers(
    waitingSignups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.offeredRoles.includes("HEALER"))
      .map(toSignupEmbedMember),
  );
  const signedDps = sortSignupEmbedMembers(
    waitingSignups
      .filter((signup) => signup.participationType === "BOOSTER" && signup.offeredRoles.includes("DPS"))
      .map(toSignupEmbedMember),
  );
  const signedLoot = sortSignupEmbedMembers(
    waitingSignups.filter((signup) => signup.participationType === "LOOTBUDDY").map(toSignupEmbedMember),
  );

  // External boosters are listed after the registered picks, in the order they were added.
  const pickedTanks = [
    ...sortSignupEmbedMembers(
      pickedRows
        .filter((signup) => signup.participationType === "BOOSTER" && signup.publishedRole === "TANK")
        .map(toSignupEmbedMember),
    ),
    ...pickedExternal("TANK"),
  ];
  const pickedHealers = [
    ...sortSignupEmbedMembers(
      pickedRows
        .filter((signup) => signup.participationType === "BOOSTER" && signup.publishedRole === "HEALER")
        .map(toSignupEmbedMember),
    ),
    ...pickedExternal("HEALER"),
  ];
  const pickedDps = [
    ...sortSignupEmbedMembers(
      pickedRows
        .filter((signup) => signup.participationType === "BOOSTER" && signup.publishedRole === "DPS")
        .map(toSignupEmbedMember),
    ),
    ...pickedExternal("DPS"),
  ];
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

  // "Signed" counts PEOPLE who can play the role, not characters: a User who
  // offers six healer characters is one available healer. The member lists
  // still carry every offered character for the Raid Lead.
  const distinctUsers = (list: SignupEmbedMember[]) => new Set(list.map((member) => member.userId)).size;

  return {
    members,
    roleStatus: {
      tank: {
        signed: distinctUsers(members.signed.tanks),
        picked: members.picked.tanks.length,
        target: run.desiredTankCount,
      },
      healer: {
        signed: distinctUsers(members.signed.healers),
        picked: members.picked.healers.length,
        target: run.desiredHealerCount,
      },
      dps: {
        signed: distinctUsers(members.signed.dps),
        picked: members.picked.dps.length,
        target: run.desiredDpsCount,
      },
      lootbuddy: {
        signed: distinctUsers(members.signed.lootbuddies),
        picked: members.picked.lootbuddies.length,
      },
    },
  };
}

/** Rendered as `@name <class>` — no Discord id, so never a real ping. */
function externalSignupEmbedMember(booster: ExternalBooster): SignupEmbedMember {
  return {
    signupId: `external:${booster.id}`,
    userId: `external:${booster.id}`,
    userName: booster.name,
    discordUsername: booster.name,
    discordUserId: null,
    characterName: null,
    characterRealm: null,
    wowClass: booster.wowClass,
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
    // member-data changes so existing posts refresh (Content→Raid Lead, role emojis,
    // multi-char mention grouping, description content summary).
    participantLineFormat: "mention-v4-content-summary",
  });
}

/** A characterless Lootbuddy has no Character to name — its own Class snapshot stands in for display; legacy Character-backed Lootbuddy rows still show their Character. */
function externalRosterEmbedMember(booster: ExternalBooster): RosterEmbedMember {
  return {
    userId: `external:${booster.id}`,
    userName: booster.name,
    discordUserId: null,
    characterName: booster.name,
    characterRealm: "",
    wowClass: booster.wowClass,
    external: true,
  };
}

/** Final Setup row for a hand-added booster: `@name <class>`, no lockout data. */
function externalStartMember(booster: ExternalBooster): RunStartEmbedMember {
  return {
    signupId: `external:${booster.id}`,
    userId: `external:${booster.id}`,
    userName: booster.name,
    discordUserId: null,
    characterName: booster.name,
    characterRealm: "",
    wowClass: booster.wowClass,
    classLabel: CLASS_LABELS[booster.wowClass],
    saveLabel: "External",
    participationType: "BOOSTER",
    selectedRole: booster.role,
  };
}

function toMember(row: RosterSignupRow): RosterEmbedMember {
  const lootbuddyClassLabel = row.lootbuddyClass ? CLASS_LABELS[row.lootbuddyClass] : null;
  const wowClass =
    row.participationType === "BOOSTER"
      ? (row.character?.wowClass ?? null)
      : (row.lootbuddyClass ?? row.character?.wowClass ?? null);
  return {
    userId: row.userId,
    userName: row.userName,
    discordUserId: row.discordUserId,
    characterName: row.character?.name ?? lootbuddyClassLabel ?? "Unknown character",
    characterRealm: row.character?.realm ?? "",
    wowClass,
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

async function buildPendingNotificationDms(): Promise<NotificationDmWorkItem[]> {
  const pendingNotificationRows = await userNotificationRepository.listPendingDiscordDmNotifications(50);
  const notificationDmWorkItems: NotificationDmWorkItem[] = [];

  for (const notification of pendingNotificationRows) {
    if (!notification.discordUserId || !notification.runId) continue;

    const run = await runRepository.findById(notification.runId);
    if (!run || run.archivedAt) continue;

    const post = await runDiscordPostRepository.findByRunId(run.id);
    const base = {
      notificationId: notification.id,
      type: notification.type,
      discordUserId: notification.discordUserId,
      runId: run.id,
      runChannelId: post?.runChannelId ?? null,
      voiceChannelId: post?.voiceChannelId ?? null,
      productLabel: run.contentDisplay.productLabel,
      scheduledStartAt: run.scheduledStartAt,
      previousScheduledStartAt: null as string | null,
      difficulty: run.difficulty,
      lootType: run.lootType,
      participationType: null as NotificationDmWorkItem["participationType"],
      selectedRole: null as CharacterRole | null,
      characterName: null as string | null,
      wowClass: null as WowClass | null,
      signupId: notification.signupId,
    };

    if (notification.type === "RUN_CANCELLED") {
      notificationDmWorkItems.push(base);
      continue;
    }

    if (notification.type === "RUN_RESCHEDULED") {
      const parsed = parseRescheduleHrefTimestamps(notification.href);
      notificationDmWorkItems.push({
        ...base,
        previousScheduledStartAt: parsed.previousScheduledStartAt,
        scheduledStartAt: parsed.nextScheduledStartAt ?? run.scheduledStartAt,
      });
      continue;
    }

    if (
      notification.type !== "ROSTER_SELECTED" &&
      notification.type !== "RAID_INVITE" &&
      notification.type !== "ROSTER_REMOVED"
    ) {
      continue;
    }

    if (!notification.signupId) continue;
    const signupRows = await rosterRepository.listSignups(run.id);
    const signupRow = signupRows.find((signup) => signup.id === notification.signupId);
    if (!signupRow && notification.type !== "ROSTER_REMOVED") continue;

    const wowClass = signupRow
      ? signupRow.participationType === "BOOSTER"
        ? (signupRow.character?.wowClass ?? null)
        : (signupRow.lootbuddyClass ?? signupRow.character?.wowClass ?? null)
      : null;

    notificationDmWorkItems.push({
      ...base,
      signupId: notification.signupId,
      participationType: signupRow?.participationType ?? null,
      selectedRole: signupRow?.publishedRole ?? null,
      characterName: signupRow?.character?.name ?? null,
      wowClass,
    });
  }

  return notificationDmWorkItems;
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
    /** Temporary per-Run voice channels — separate from `channels` (text) and its ordering. */
    voiceChannels: DiscordRunVoiceChannelWorkItem[];
    signups: SignupSyncWorkItem[];
    roster: RosterSyncWorkItem[];
    start: RunStartSyncWorkItem[];
    /** Always empty — Raid Invite DMs come from notificationDms (PENDING UserNotification). */
    raidInvites: RaidInviteWorkItem[];
    notificationDms: NotificationDmWorkItem[];
    /** PENDING RunDiscordAnnouncement rows (channel lifecycle), createdAt ASC. */
    runAnnouncements: RunAnnouncementWorkItem[];
  }> {
    const runs = await runRepository.listManaged();
    const channels: ChannelSyncWorkItem[] = [];
    const voiceChannels: DiscordRunVoiceChannelWorkItem[] = [];
    const signups: SignupSyncWorkItem[] = [];
    const roster: RosterSyncWorkItem[] = [];
    const start: RunStartSyncWorkItem[] = [];
    const raidInvites: RaidInviteWorkItem[] = [];
    const classEmojiFingerprint = options.classEmojiFingerprint ?? "";

    const pendingAnnouncements = await runDiscordAnnouncementRepository.listPending(50);
    const pendingAnnouncementRunIds = new Set(pendingAnnouncements.map((row) => row.runId));

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
        // CANCELLED/COMPLETED/app-archived Runs are eligible to retire, but
        // PENDING RunDiscordAnnouncement rows must finish first — otherwise
        // the channel can be deleted before RUN_CANCELLED / RUN_RESCHEDULED
        // posts land. Wire field names (`retireChannel`, …) are stable JSON.
        const runEligibleForRetirement = shouldRetireDiscordChannel(run);
        const hasPendingLifecycleAnnouncements = pendingAnnouncementRunIds.has(run.id);
        const shouldRetireChannelNow = runEligibleForRetirement && !hasPendingLifecycleAnnouncements;
        const archiveDiscordPosted = Boolean(
          post.archiveCloseMessageId && post.archiveTranscriptMessageId,
        );
        const archiveArtifactsNeeded =
          shouldRetireChannelNow && (!archiveDiscordPosted || !post.archiveTranscriptHtml);
        channels.push({
          runId: run.id,
          existingRunChannelId: post.runChannelId,
          desiredChannelName: desiredChannelNameFor(run),
          targetBucket,
          scheduledStartAt: run.scheduledStartAt,
          retireChannel: shouldRetireChannelNow,
          pendingLifecycleAnnouncements: hasPendingLifecycleAnnouncements,
          archiveArtifactsNeeded,
          archiveCloseMessageId: post.archiveCloseMessageId,
          archiveTranscriptMessageId: post.archiveTranscriptMessageId,
          raidLeadName: run.raidLeadName,
          raidLeadDiscordUserId: run.raidLeadDiscordUserId,
          panelName: run.contentDisplay.productLabel,
        });
      }

      // Voice lifecycle is Run-level infrastructure: derived from Run state only,
      // never from notification recipients or their DM preferences.
      const voiceChannelId = post?.voiceChannelId ?? null;
      const needsSnapshotCheck = !voiceChannelId && run.status === "IN_PROGRESS" && !run.archivedAt;
      const voiceAction = planRunVoiceChannel({
        status: run.status,
        archivedAt: run.archivedAt,
        voiceChannelId,
        hasStartSnapshot: needsSnapshotCheck ? Boolean(await runStartSnapshotRepository.findByRunId(run.id)) : false,
      });
      if (voiceAction) {
        voiceChannels.push({
          runId: run.id,
          existingVoiceChannelId: voiceChannelId,
          desiredVoiceChannelName: formatRunVoiceChannelName(
            effectiveRaidLeadChannelName({
              raidLeadName: run.raidLeadName,
              discordRunChannelNickname: run.raidLeadDiscordRunChannelNickname,
            }),
          ),
          action: voiceAction,
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
            // Prefer dedicated run channel; fall back to signup channel so a
            // cleared runChannelId after archive (or older rows) does not look
            // like "never provisioned" while a live channel still exists.
            existingRunChannelId: post?.runChannelId ?? post?.signupChannelId ?? null,
            desiredChannelName: desiredChannelNameFor(run),
            targetBucket,
            scheduledStartAt: run.scheduledStartAt,
            allowChannelCreate: eligibleForFirstProvisioning,
            announceOnCreate: !post?.signupPostedAt,
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
      // Same fallback as the signup lane: the lane must target the channel
      // its gate is based on, so a deleted channel is confirmed (and
      // cleared) rather than skipped without evidence on every poll.
      const dedicatedChannelId = post?.runChannelId ?? post?.signupChannelId ?? null;
      if (run.roster?.publishedAt && dedicatedChannelId) {
        if (!post?.rosterMessageId || post.lastRosterVersion !== run.roster.version) {
          roster.push({
            runId: run.id,
            existingChannelId: post?.rosterChannelId ?? null,
            existingMessageId: post?.rosterMessageId ?? null,
            existingRunChannelId: dedicatedChannelId,
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
      if (started && dedicatedChannelId && !post?.startMessageId) {
        const snapshot = await runStartSnapshotRepository.findByRunId(run.id);
        if (snapshot) {
          start.push({
            runId: run.id,
            existingChannelId: post?.startChannelId ?? null,
            existingMessageId: post?.startMessageId ?? null,
            existingRunChannelId: dedicatedChannelId,
            desiredChannelName: desiredChannelNameFor(run),
            targetBucket,
          });
        }
      }
    }

    const notificationDms = await buildPendingNotificationDms();

    const runChannelByRunId = new Map<string, string | null>();
    for (const announcement of pendingAnnouncements) {
      if (!runChannelByRunId.has(announcement.runId)) {
        const post = await runDiscordPostRepository.findByRunId(announcement.runId);
        runChannelByRunId.set(announcement.runId, post?.runChannelId ?? null);
      }
    }
    const runAnnouncements: RunAnnouncementWorkItem[] = pendingAnnouncements.map((row) => ({
      announcementId: row.id,
      runId: row.runId,
      type: row.type,
      runChannelId: runChannelByRunId.get(row.runId) ?? null,
      previousScheduledStartAt: row.previousScheduledStartAt,
      scheduledStartAt: row.scheduledStartAt,
      productLabel: row.productLabel,
      difficulty: row.difficulty,
      lootType: row.lootType,
    }));

    return { channels, voiceChannels, signups, roster, start, raidInvites, notificationDms, runAnnouncements };
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
    const externals = run.roster.externalBoosters;
    const externalMembers = (predicate: (booster: ExternalBooster) => boolean) =>
      externals.filter(predicate).map(externalRosterEmbedMember);
    const externalDpsRanged = (booster: ExternalBooster) =>
      booster.role === "DPS" && defaultDpsAttackTypeForClass(booster.wowClass) === "RANGED";

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
        tanks: [...boosterByRole(selected, "TANK").map(toMember), ...externalMembers((b) => b.role === "TANK")],
        healers: [...boosterByRole(selected, "HEALER").map(toMember), ...externalMembers((b) => b.role === "HEALER")],
        meleeDps: [
          ...meleeDps.map(toMember),
          ...externalMembers((b) => b.role === "DPS" && !externalDpsRanged(b)),
        ],
        rangedDps: [...rangedDps.map(toMember), ...externalMembers(externalDpsRanged)],
        lootbuddies: selected.filter((row) => row.participationType === "LOOTBUDDY").map(toMember),
      },
      totalSelected: selected.length + externals.length,
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
      // Keep dedicated-channel identity aligned with the channel we just
      // posted into — otherwise a later signature bump with a cleared
      // runChannelId looks like first provision and re-creates + re-pings.
      runChannelId: input.channelId,
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
    // Hand-added external boosters have no attendance row; they join from the roster.
    for (const booster of run.roster?.externalBoosters ?? []) {
      members.push(externalStartMember(booster));
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
      // The assigned Raid Lead, never the user who clicked Start Run.
      raidLeadDisplayName: effectiveRaidLeadChannelName({
        raidLeadName: run.raidLeadName,
        discordRunChannelNickname: run.raidLeadDiscordRunChannelNickname,
      }),
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

  /**
   * The bot confirmed via Discord Unknown Channel (10003) that `channelId` is
   * deleted and it was not allowed to provision a replacement. Clearing the
   * identity that lives in that channel makes listSyncWork stop generating
   * signup/roster/start work that can only re-fetch the dead id every poll.
   */
  /** Bot created the Run's temporary voice channel. */
  async recordRunVoiceChannel(input: { runId: string; channelId: string }): Promise<void> {
    await runDiscordPostRepository.recordRunVoiceChannel(input);
  },

  /** Bot deleted the voice channel, or Discord confirmed it is gone (exact-match clear). */
  async clearRunVoiceChannel(input: { runId: string; channelId: string }): Promise<void> {
    await runDiscordPostRepository.clearRunVoiceChannel(input);
  },

  async recordRunChannelGone(input: { runId: string; channelId: string }): Promise<void> {
    await runDiscordPostRepository.clearDeletedChannelIdentity(input.runId, input.channelId);
  },

  async recordRaidInviteSent(input: { runId: string; signupId: string }): Promise<void> {
    await runDiscordPostRepository.recordRaidInviteSent(input);
  },

  /**
   * Records Discord DM delivery for a PENDING UserNotification.
   * RAID_INVITE successes also append the legacy raidInviteSentSignupIds list.
   */
  async recordNotificationDmDelivery(input: {
    notificationId: string;
    result: "SENT" | "FAILED_PERMANENT";
  }): Promise<void> {
    const notification = await userNotificationRepository.findById(input.notificationId);
    await userNotificationRepository.updateDiscordDelivery(input.notificationId, input.result);
    if (
      input.result === "SENT" &&
      notification?.type === "RAID_INVITE" &&
      notification.runId &&
      notification.signupId
    ) {
      await runDiscordPostRepository.recordRaidInviteSent({
        runId: notification.runId,
        signupId: notification.signupId,
      });
    }
  },

  /**
   * Records delivery outcome for a PENDING RunDiscordAnnouncement (channel post).
   */
  async recordRunAnnouncementDelivery(input: {
    announcementId: string;
    result: "SENT" | "SKIPPED" | "FAILED_PERMANENT";
  }): Promise<void> {
    await runDiscordAnnouncementRepository.updateStatus(input.announcementId, input.result, {
      sentAt: input.result === "SENT" ? new Date().toISOString() : null,
    });
  },
};
