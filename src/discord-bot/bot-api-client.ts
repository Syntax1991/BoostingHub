import type { BotEnv } from "@/discord-bot/env";

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
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.env.botApiToken}`);
    if (init.discordUserId) {
      headers.set("x-discord-user-id", init.discordUserId);
    }
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(`${this.env.apiBaseUrl}${path}`, { ...init, headers });
    const envelope = (await response.json()) as ApiEnvelope<T>;
    if (!envelope.ok) {
      throw new BotApiError(response.status, envelope.code, envelope.message);
    }
    return envelope.data;
  }

  listSyncWork() {
    return this.request<{
      signups: Array<{
        runId: string;
        existingChannelId: string | null;
        existingMessageId: string | null;
        existingRunChannelId: string | null;
        desiredChannelName: string;
        embed: unknown;
      }>;
      roster: Array<{
        runId: string;
        existingChannelId: string | null;
        existingMessageId: string | null;
        existingRunChannelId: string | null;
        desiredChannelName: string;
      }>;
    }>("/api/bot/discord/sync");
  }

  getRosterEmbedData(runId: string) {
    return this.request<unknown>(`/api/bot/runs/${runId}/roster`);
  }

  recordDiscordState(
    runId: string,
    input:
      | { kind: "channel"; channelId: string }
      | { kind: "signup" | "roster"; channelId: string; messageId: string },
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
    input: {
      participationType: "BOOSTER" | "LOOTBUDDY";
      offers: Array<{ characterId: string; role?: string }>;
      lootbuddyMode?: string;
      lootbuddyVerification?: string;
    },
  ) {
    return this.request<{ created: number; reactivated: number; withdrawn: number; kept: number }>(
      `/api/bot/runs/${runId}/signup`,
      { method: "PUT", discordUserId, body: JSON.stringify(input) },
    );
  }

  cancelSignup(runId: string, discordUserId: string) {
    return this.request<{ withdrawn: number }>(`/api/bot/runs/${runId}/signup/cancel`, {
      method: "POST",
      discordUserId,
    });
  }

  getMySignups(discordUserId: string) {
    return this.request<unknown>("/api/bot/my-signups", { discordUserId });
  }
}
