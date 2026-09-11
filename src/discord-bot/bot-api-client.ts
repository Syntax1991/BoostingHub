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

  listSyncWork() {
    return this.request<{
      signups: Array<{
        runId: string;
        existingChannelId: string | null;
        existingMessageId: string | null;
        existingRunChannelId: string | null;
        desiredChannelName: string;
        archived: boolean;
        embed: unknown;
      }>;
      roster: Array<{
        runId: string;
        existingChannelId: string | null;
        existingMessageId: string | null;
        existingRunChannelId: string | null;
        desiredChannelName: string;
        archived: boolean;
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
