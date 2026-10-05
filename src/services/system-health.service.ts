import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageCharacterOperations } from "@/auth/authorization";
import { isBlizzardConfigured } from "@/lib/blizzard/config";
import { isWarcraftLogsConfigured } from "@/lib/warcraft-logs/config";
import {
  deriveProviderHealth,
  SYSTEM_HEALTH_PROVIDER_LABELS,
  SYSTEM_HEALTH_PROVIDER_ORDER,
  type SystemHealthState,
} from "@/lib/system-health";
import type { IntegrationEventStatus, IntegrationProvider } from "@/models/enums";
import {
  integrationEventRepository,
  type IntegrationEventRecord,
} from "@/repositories/integration-event.repository";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_PER_PROVIDER = 20;
const EVENT_PAGE_DEFAULT = 25;
const EVENT_PAGE_MAX = 100;

export type SystemHealthDeepLink = {
  href: string;
  label: string;
};

export type BlizzardHealthExtras = {
  lastScheduledPass: {
    status: IntegrationEventStatus;
    createdAt: string;
    durationMs: number | null;
    succeeded: number | null;
    failed: number | null;
    rateLimited: number | null;
    backoffSkipped: number | null;
    totalCandidates: number | null;
  } | null;
  characterOpsLinks: SystemHealthDeepLink[];
};

export type BackupHealthExtras = {
  configured: boolean;
  retentionDays: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastSuccessSizeBytes: number | null;
  lastSuccessfulAgeHours: number | null;
  listValidated: boolean | null;
  /** Explicit restore verification only — never inferred from dump existence. */
  lastRestoreVerificationAt: string | null;
};

export type SystemHealthProviderCard = {
  provider: IntegrationProvider;
  label: string;
  state: SystemHealthState;
  configured: boolean;
  recentEventCount: number;
  blizzard?: BlizzardHealthExtras;
  backup?: BackupHealthExtras;
};

export type SystemHealthPage = {
  providers: SystemHealthProviderCard[];
  events: IntegrationEventRecord[];
  filters: {
    provider: IntegrationProvider | null;
    status: IntegrationEventStatus | null;
    operation: string | null;
    limit: number;
    offset: number;
  };
};

function isDiscordBotConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
}

function isProviderConfigured(provider: IntegrationProvider): boolean {
  switch (provider) {
    case "BLIZZARD":
      return isBlizzardConfigured();
    case "WARCRAFT_LOGS":
      return isWarcraftLogsConfigured();
    case "DISCORD":
      return isDiscordBotConfigured();
    case "RAIDER_IO":
      // Local URL parser — always available in-app.
      return true;
    case "SYSTEM":
      return true;
    case "BACKUP":
      // Host backup exists in production; in-app config signal comes later.
      return true;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

function readMetaNumber(metadataJson: string | null, key: string): number | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function buildBlizzardExtras(recent: IntegrationEventRecord[]): BlizzardHealthExtras {
  const lastPass = recent.find((row) => row.operation === "SCHEDULED_SYNC_PASS") ?? null;
  return {
    lastScheduledPass: lastPass
      ? {
          status: lastPass.status,
          createdAt: lastPass.createdAt,
          durationMs: lastPass.durationMs,
          succeeded: readMetaNumber(lastPass.metadataJson, "succeeded"),
          failed: readMetaNumber(lastPass.metadataJson, "failed"),
          rateLimited: readMetaNumber(lastPass.metadataJson, "rateLimited"),
          backoffSkipped: readMetaNumber(lastPass.metadataJson, "backoffSkipped"),
          totalCandidates: readMetaNumber(lastPass.metadataJson, "totalCandidates"),
        }
      : null,
    characterOpsLinks: [
      { href: "/manage/characters?status=active&health=ERROR", label: "Characters in ERROR" },
      { href: "/manage/characters?status=active&health=STALE", label: "Stale Characters" },
      { href: "/manage/characters?status=active&health=NEVER_SYNCED", label: "Never synced" },
      { href: "/manage/characters?status=active&linkage=LINKED", label: "Linked Characters" },
    ],
  };
}

async function readBackupStatusFile(): Promise<Partial<BackupHealthExtras> | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(join(process.cwd(), "var", "backup-status.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      configured: parsed.configured !== false,
      retentionDays: typeof parsed.retentionDays === "number" ? parsed.retentionDays : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === "string" ? parsed.lastSuccessAt : null,
      lastFailureAt: typeof parsed.lastFailureAt === "string" ? parsed.lastFailureAt : null,
      lastSuccessSizeBytes:
        typeof parsed.lastSuccessSizeBytes === "number" ? parsed.lastSuccessSizeBytes : null,
      listValidated: typeof parsed.listValidated === "boolean" ? parsed.listValidated : null,
      lastRestoreVerificationAt:
        typeof parsed.lastRestoreVerificationAt === "string" ? parsed.lastRestoreVerificationAt : null,
    };
  } catch {
    return null;
  }
}

function buildBackupExtras(
  recent: IntegrationEventRecord[],
  fileStatus: Partial<BackupHealthExtras> | null,
): BackupHealthExtras {
  const lastSuccessEvent =
    recent.find((row) => row.operation === "DATABASE_BACKUP" && row.status === "SUCCESS") ?? null;
  const lastFailureEvent =
    recent.find((row) => row.operation === "DATABASE_BACKUP" && row.status === "ERROR") ?? null;
  const lastSuccessAt = fileStatus?.lastSuccessAt ?? lastSuccessEvent?.createdAt ?? null;
  const lastFailureAt = fileStatus?.lastFailureAt ?? lastFailureEvent?.createdAt ?? null;
  const lastSuccessSizeBytes =
    fileStatus?.lastSuccessSizeBytes ??
    (lastSuccessEvent ? readMetaNumber(lastSuccessEvent.metadataJson, "backupSizeBytes") : null);
  const retentionDays =
    fileStatus?.retentionDays ??
    (lastSuccessEvent ? readMetaNumber(lastSuccessEvent.metadataJson, "retentionDays") : null) ??
    (lastFailureEvent ? readMetaNumber(lastFailureEvent.metadataJson, "retentionDays") : null);
  let lastSuccessfulAgeHours: number | null = null;
  if (lastSuccessAt) {
    const ageMs = Date.now() - new Date(lastSuccessAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      lastSuccessfulAgeHours = Math.floor(ageMs / (60 * 60 * 1000));
    }
  }
  return {
    configured: fileStatus?.configured ?? true,
    retentionDays,
    lastSuccessAt,
    lastFailureAt,
    lastSuccessSizeBytes,
    lastSuccessfulAgeHours,
    listValidated: fileStatus?.listValidated ?? (lastSuccessEvent ? true : null),
    lastRestoreVerificationAt: fileStatus?.lastRestoreVerificationAt ?? null,
  };
}

export type SystemHealthFilters = {
  provider?: IntegrationProvider | null;
  status?: IntegrationEventStatus | null;
  operation?: string | null;
  limit?: number;
  offset?: number;
};

/**
 * ADMIN / OWNER System Health read model.
 * Provider instrumentation may still be sparse — cards may show UNKNOWN.
 */
export const systemHealthService = {
  async getPage(user: AuthenticatedUser, filters: SystemHealthFilters = {}): Promise<SystemHealthPage> {
    assertCanManageCharacterOperations(user);

    const limit = Math.min(Math.max(1, Math.floor(filters.limit ?? EVENT_PAGE_DEFAULT)), EVENT_PAGE_MAX);
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const createdAfter = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const backupFileStatus = await readBackupStatusFile();

    // Parallel bounded lookups — one capped query per provider (not sequential N+1).
    const providers: SystemHealthProviderCard[] = await Promise.all(
      SYSTEM_HEALTH_PROVIDER_ORDER.map(async (provider) => {
        const configured = isProviderConfigured(provider);
        const recent = configured
          ? await integrationEventRepository.listRecent({
              provider,
              createdAfter,
              limit: RECENT_PER_PROVIDER,
            })
          : [];
        const card: SystemHealthProviderCard = {
          provider,
          label: SYSTEM_HEALTH_PROVIDER_LABELS[provider],
          configured,
          recentEventCount: recent.length,
          state: deriveProviderHealth({
            provider,
            configured,
            recentStatuses: recent.map((row) => row.status),
          }),
        };
        if (provider === "BLIZZARD") {
          card.blizzard = buildBlizzardExtras(recent);
        }
        if (provider === "BACKUP") {
          card.backup = buildBackupExtras(recent, backupFileStatus);
        }
        return card;
      }),
    );

    const events = await integrationEventRepository.listRecent({
      provider: filters.provider ?? undefined,
      status: filters.status ?? undefined,
      operation: filters.operation?.trim() || undefined,
      limit,
      offset,
    });

    return {
      providers,
      events,
      filters: {
        provider: filters.provider ?? null,
        status: filters.status ?? null,
        operation: filters.operation?.trim() || null,
        limit,
        offset,
      },
    };
  },
};
