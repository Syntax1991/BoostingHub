import {
  isDiscordCannotDmError,
  isDiscordPermissionError,
  isDiscordUnknownChannelError,
  isDiscordUnknownMessageError,
} from "@/discord-bot/discord-api-errors";
import { integrationEventService } from "@/services/integration-event.service";
import type { IntegrationEventStatus } from "@/models/enums";

export type DiscordSyncPassTelemetry = {
  warningCount: number;
  errorCount: number;
};

export function createDiscordSyncPassTelemetry(): DiscordSyncPassTelemetry {
  return { warningCount: 0, errorCount: 0 };
}

export function extractDiscordApiCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return null;
}

export function isDiscordRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const named = (error as { name?: unknown }).name;
  if (named === "RateLimitError" || named === "TimeoutError") return true;
  const status = (error as { status?: unknown; httpStatus?: unknown }).status
    ?? (error as { httpStatus?: unknown }).httpStatus;
  return status === 429;
}

/**
 * Classify Discord REST/gateway failures for IntegrationEvent telemetry.
 * 10008 stays WARNING (message-missing / replacement path) — never treat as DOWN alone.
 * Permission failures are ERROR and must not imply message-identity replacement.
 */
export function classifyDiscordTelemetryError(error: unknown): {
  errorCode: string;
  status: "WARNING" | "ERROR";
  discordCode: number | null;
  httpStatus: number | null;
} {
  const discordCode = extractDiscordApiCode(error);
  if (isDiscordUnknownMessageError(error)) {
    return { errorCode: "DISCORD_UNKNOWN_MESSAGE", status: "WARNING", discordCode: discordCode ?? 10008, httpStatus: 404 };
  }
  if (isDiscordUnknownChannelError(error)) {
    return { errorCode: "DISCORD_UNKNOWN_CHANNEL", status: "WARNING", discordCode: discordCode ?? 10003, httpStatus: 404 };
  }
  if (isDiscordCannotDmError(error)) {
    return { errorCode: "DISCORD_CANNOT_DM", status: "WARNING", discordCode: discordCode ?? 50007, httpStatus: 403 };
  }
  if (isDiscordPermissionError(error)) {
    return {
      errorCode: "DISCORD_MISSING_PERMISSIONS",
      status: "ERROR",
      discordCode: discordCode ?? 50013,
      httpStatus: 403,
    };
  }
  if (isDiscordRateLimitError(error)) {
    return { errorCode: "DISCORD_RATE_LIMITED", status: "WARNING", discordCode, httpStatus: 429 };
  }
  if (discordCode != null) {
    return { errorCode: `DISCORD_${discordCode}`, status: "ERROR", discordCode, httpStatus: null };
  }
  return { errorCode: "DISCORD_SYNC_FAILURE", status: "ERROR", discordCode: null, httpStatus: null };
}

/** Best-effort lane failure event. Never throws into Discord sync control flow. */
export async function recordDiscordLaneFailure(
  pass: DiscordSyncPassTelemetry | null,
  input: {
    operation: string;
    error: unknown;
    messageKind?: string | null;
    channelKind?: string | null;
    entityId?: string | null;
  },
): Promise<void> {
  const classified = classifyDiscordTelemetryError(input.error);
  if (pass) {
    if (classified.status === "WARNING") pass.warningCount += 1;
    else pass.errorCount += 1;
  }
  try {
    await integrationEventService.recordFailure({
      provider: "DISCORD",
      operation: input.operation,
      status: classified.status,
      errorCode: classified.errorCode,
      httpStatus: classified.httpStatus,
      entityType: input.entityId ? "Run" : null,
      entityId: input.entityId ?? null,
      metadata: {
        discordCode: classified.discordCode,
        messageKind: input.messageKind ?? null,
        channelKind: input.channelKind ?? null,
      },
    });
  } catch {
    // Telemetry must not break Discord sync.
  }
}

export function discordSyncPassStatus(pass: DiscordSyncPassTelemetry): IntegrationEventStatus {
  if (pass.errorCount > 0) return "ERROR";
  if (pass.warningCount > 0) return "WARNING";
  return "SUCCESS";
}

export async function recordDiscordSyncPass(
  pass: DiscordSyncPassTelemetry,
  durationMs: number,
): Promise<void> {
  try {
    await integrationEventService.record({
      provider: "DISCORD",
      operation: "SYNC_ONCE",
      status: discordSyncPassStatus(pass),
      durationMs,
      metadata: {
        failed: pass.errorCount,
        skipped: pass.warningCount,
      },
    });
  } catch {
    // Telemetry must not break Discord sync.
  }
}

export async function recordDiscordBotReady(durationMs?: number | null): Promise<void> {
  try {
    await integrationEventService.record({
      provider: "DISCORD",
      operation: "BOT_READY",
      status: "SUCCESS",
      durationMs: durationMs ?? null,
      metadata: { configured: true },
    });
  } catch {
    // Telemetry must not break Discord startup.
  }
}
