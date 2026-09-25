import type { BotEnv } from "@/discord-bot/env";
import type { SupportTicketStatus, SupportTicketType } from "@/models/enums";

/** Bot-facing Support ticket DTO (never contains the transcript body). */
export type BotSupportTicket = {
  id: string;
  number: number;
  type: SupportTicketType;
  status: SupportTicketStatus;
  creatorDiscordUserId: string;
  creatorDisplayName: string;
  subject: string;
  description: string;
  reference: string | null;
  reportedDiscordUserId: string | null;
  reportedBoosterLabel: string | null;
  channelId: string | null;
  channelName: string | null;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
  closedByDiscordUserId: string | null;
  archiveMessageId: string | null;
  lastError: string | null;
};

export type BotSupportTicketPanel = { channelId: string; messageId: string; lastSignature: string | null };

export class BotApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BotApiError";
    this.status = status;
    this.code = code;
  }
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/**
 * The bot's only channel to BoostingHub. Every call carries the bot service
 * token; per-User calls additionally carry the acting Discord member's own
 * id — never a BoostingHub userId the bot invents itself.
 */
export class BotApiClient {
  constructor(private readonly env: Pick<BotEnv, "apiBaseUrl" | "botApiToken">) {}

  private async request<T>(path: string, init: RequestInit & { discordUserId?: string } = {}): Promise<T> {
    const method = init.method ?? "GET";
    const url = `${this.env.apiBaseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.env.botApiToken}`);
    if (init.discordUserId) {
      headers.set("x-discord-user-id", init.discordUserId);
    }
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    // Never logs the token or any header value — only method/url/status, which
    // is what's needed to diagnose a transport failure (e.g. the API base URL
    // pointing at a dead port, or a dev-server hot-reload rejecting mid-request).
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (error) {
      console.error(`[bot-api-client] transport error calling ${method} ${url}`, error);
      throw error;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const bodyText = await response.text().catch(() => "<unreadable body>");
      console.error(
        `[bot-api-client] non-JSON response from ${method} ${url}: status=${response.status} content-type=${contentType || "<none>"} body=${bodyText.slice(0, 500)}`,
      );
      throw new Error(`Bot API returned a non-JSON response (status ${response.status}).`);
    }

    let envelope: ApiEnvelope<T>;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch (error) {
      console.error(`[bot-api-client] failed to parse JSON from ${method} ${url}: status=${response.status}`, error);
      throw error;
    }

    if (!envelope.ok) {
      throw new BotApiError(response.status, envelope.code, envelope.message);
    }
    return envelope.data;
  }

  listSyncWork(classEmojiFingerprint = "") {
    return this.request<{
      /** Temporary per-Run voice channels; optional so an older API response is tolerated. */
      voiceChannels?: Array<{
        runId: string;
        existingVoiceChannelId: string | null;
        desiredVoiceChannelName: string;
        action: "PROVISION" | "RECONCILE" | "RETIRE_IF_EMPTY";
      }>;
      channels: Array<{
        runId: string;
        existingRunChannelId: string;
        desiredChannelName: string;
        targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
        scheduledStartAt: string;
        retireChannel: boolean;
        pendingLifecycleAnnouncements: boolean;
        archiveArtifactsNeeded: boolean;
        archiveCloseMessageId: string | null;
        archiveTranscriptMessageId: string | null;
        raidLeadName: string;
        raidLeadDiscordUserId: string | null;
        panelName: string;
      }>;
      signups: Array<{
        runId: string;
        existingChannelId: string | null;
        existingMessageId: string | null;
        existingRunChannelId: string | null;
        desiredChannelName: string;
        targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
        scheduledStartAt: string;
        allowChannelCreate: boolean;
        announceOnCreate?: boolean;
        embed: unknown;
      }>;
      roster: Array<{
        runId: string;
        existingChannelId: string | null;
        existingMessageId: string | null;
        existingRunChannelId: string | null;
        desiredChannelName: string;
        targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
      }>;
      start: Array<{
        runId: string;
        existingChannelId: string | null;
        existingMessageId: string | null;
        existingRunChannelId: string | null;
        desiredChannelName: string;
        targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
      }>;
      raidInvites: Array<{
        runId: string;
        signupId: string;
        discordUserId: string;
        runChannelId: string | null;
        productLabel: string;
        scheduledStartAt: string;
        difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
        lootType: "SAVED" | "UNSAVED" | "VIP";
        participationType: "BOOSTER" | "LOOTBUDDY";
        selectedRole: "TANK" | "HEALER" | "DPS" | null;
        characterName: string | null;
        wowClass:
          | "DEATH_KNIGHT"
          | "DEMON_HUNTER"
          | "DRUID"
          | "EVOKER"
          | "HUNTER"
          | "MAGE"
          | "MONK"
          | "PALADIN"
          | "PRIEST"
          | "ROGUE"
          | "SHAMAN"
          | "WARLOCK"
          | "WARRIOR"
          | null;
      }>;
      notificationDms: Array<{
        notificationId: string;
        type:
          | "ROSTER_SELECTED"
          | "RAID_INVITE"
          | "RUN_CANCELLED"
          | "RUN_RESCHEDULED"
          | "ROSTER_REMOVED"
          | "ROSTER_WITHDRAWN";
        discordUserId: string;
        /** ROSTER_SELECTED for a character swap ("Roster Update"); optional for an older API. */
        rosterUpdate?: boolean;
        /** ROSTER_WITHDRAWN only; optional for an older API. */
        withdrawal?: {
          playerName: string;
          characterLabel: string | null;
          reason: string;
          rosterUrl: string | null;
        } | null;
        runId: string;
        signupId: string | null;
        runChannelId: string | null;
        /** Persisted Run voice channel at delivery time; optional for an older API. */
        voiceChannelId?: string | null;
        productLabel: string;
        scheduledStartAt: string;
        previousScheduledStartAt: string | null;
        difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
        lootType: "SAVED" | "UNSAVED" | "VIP";
        participationType: "BOOSTER" | "LOOTBUDDY" | null;
        selectedRole: "TANK" | "HEALER" | "DPS" | null;
        characterName: string | null;
        wowClass:
          | "DEATH_KNIGHT"
          | "DEMON_HUNTER"
          | "DRUID"
          | "EVOKER"
          | "HUNTER"
          | "MAGE"
          | "MONK"
          | "PALADIN"
          | "PRIEST"
          | "ROGUE"
          | "SHAMAN"
          | "WARLOCK"
          | "WARRIOR"
          | null;
      }>;
      runAnnouncements: Array<{
        announcementId: string;
        runId: string;
        type: "RUN_RESCHEDULED" | "RUN_CANCELLED";
        runChannelId: string | null;
        previousScheduledStartAt: string | null;
        scheduledStartAt: string;
        productLabel: string;
        difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
        lootType: "SAVED" | "UNSAVED" | "VIP";
      }>;
    }>("/api/bot/discord/sync", {
      headers: classEmojiFingerprint
        ? { "x-class-emoji-fingerprint": classEmojiFingerprint }
        : undefined,
    });
  }

  getRosterEmbedData(runId: string) {
    return this.request<unknown>(`/api/bot/runs/${runId}/roster`);
  }

  getRunStartEmbedData(runId: string) {
    return this.request<unknown>(`/api/bot/runs/${runId}/start`);
  }

  recordDiscordState(
    runId: string,
    input:
      | { kind: "channel"; channelId: string }
      | { kind: "clear-channel" }
      | { kind: "channel-gone"; channelId: string }
      | { kind: "voice-channel" | "clear-voice-channel"; channelId: string }
      | {
          kind: "signup";
          channelId: string;
          messageId: string;
          classEmojiFingerprint?: string;
        }
      | { kind: "roster" | "start"; channelId: string; messageId: string }
      | {
          kind: "archive-artifacts";
          closeMessageId: string;
          transcriptMessageId: string;
          transcriptHtml: string;
          transcriptFilename: string;
        }
      | { kind: "raid-invite"; signupId: string }
      | {
          kind: "notification-dm";
          notificationId: string;
          result: "SENT" | "FAILED_PERMANENT";
        }
      | {
          kind: "run-announcement";
          announcementId: string;
          result: "SENT" | "SKIPPED" | "FAILED_PERMANENT";
        },
  ) {
    return this.request<{ recorded: true }>(`/api/bot/runs/${runId}/discord-state`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  getSignupOptions(runId: string, discordUserId: string) {
    return this.request<unknown>(`/api/bot/runs/${runId}/signup-options`, { discordUserId });
  }

  setCharacterOffers(
    runId: string,
    discordUserId: string,
    input: { offers: Array<{ characterId: string; offeredRoles: string[] }> },
  ) {
    return this.request<{ created: number; reactivated: number; withdrawn: number; kept: number }>(
      `/api/bot/runs/${runId}/signup`,
      { method: "PUT", discordUserId, body: JSON.stringify(input) },
    );
  }

  setLootbuddies(
    runId: string,
    discordUserId: string,
    input: {
      lootbuddies: Array<{ signupId?: string; wowClass: string; mode: string; verification?: string }>;
    },
  ) {
    return this.request<{ created: number; updated: number; withdrawn: number }>(
      `/api/bot/runs/${runId}/lootbuddies`,
      { method: "PUT", discordUserId, body: JSON.stringify(input) },
    );
  }

  /** Throws WITHDRAW_REASON_REQUIRED when the User is picked and no reason was given. */
  cancelSignup(runId: string, discordUserId: string, reason?: string) {
    return this.request<{ withdrawn: number }>(`/api/bot/runs/${runId}/signup/cancel`, {
      method: "POST",
      discordUserId,
      ...(reason === undefined ? {} : { body: JSON.stringify({ reason }) }),
    });
  }

  getMySignups(discordUserId: string) {
    return this.request<unknown>("/api/bot/my-signups", { discordUserId });
  }

  reserveTicket(input: {
    type: SupportTicketType;
    creatorDiscordUserId: string;
    creatorDisplayName: string;
    subject: string;
    description: string;
    reference: string | null;
    booster: string | null;
  }) {
    return this.request<{ outcome: "RESERVED" | "EXISTING"; ticket: BotSupportTicket }>("/api/bot/tickets", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getTicket(ticketId: string) {
    return this.request<BotSupportTicket>(`/api/bot/tickets/${encodeURIComponent(ticketId)}`);
  }

  private ticketAction<T = BotSupportTicket>(ticketId: string, action: string, body: unknown = {}) {
    return this.request<T>(`/api/bot/tickets/${encodeURIComponent(ticketId)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  activateTicket(ticketId: string, input: { channelId: string; channelName: string }) {
    return this.ticketAction(ticketId, "activate", input);
  }

  abortTicketOpening(ticketId: string, reason: string) {
    return this.ticketAction(ticketId, "abort-opening", { reason });
  }

  beginTicketClose(ticketId: string, closedByDiscordUserId: string) {
    return this.ticketAction<{ acquired: boolean; ticket: BotSupportTicket }>(ticketId, "begin-close", {
      closedByDiscordUserId,
    });
  }

  recordTicketTranscript(
    ticketId: string,
    input: { transcriptHtml: string; transcriptFilename: string; messageCount: number; truncated: boolean },
  ) {
    return this.ticketAction(ticketId, "transcript", input);
  }

  recordTicketArchive(ticketId: string, archiveMessageId: string) {
    return this.ticketAction(ticketId, "archive", { archiveMessageId });
  }

  finalizeTicketClose(ticketId: string) {
    return this.ticketAction(ticketId, "finalize-close");
  }

  recordTicketCloseFailure(ticketId: string, stage: "TRANSCRIPT" | "ARCHIVE" | "DELETE", message: string) {
    return this.ticketAction(ticketId, "close-failed", { stage, message: message.slice(0, 500) || "unknown" });
  }

  markTicketChannelMissing(ticketId: string, channelId: string) {
    return this.ticketAction(ticketId, "channel-missing", { channelId });
  }

  listTicketsPendingChannelDelete() {
    return this.request<BotSupportTicket[]>("/api/bot/tickets/pending-deletes");
  }

  getTicketPanel() {
    return this.request<BotSupportTicketPanel | null>("/api/bot/ticket-panel");
  }

  recordTicketPanel(input: { channelId: string; messageId: string; lastSignature: string }) {
    return this.request<BotSupportTicketPanel>("/api/bot/ticket-panel", { method: "PUT", body: JSON.stringify(input) });
  }
}
