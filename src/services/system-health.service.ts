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

export type SystemHealthProviderCard = {
  provider: IntegrationProvider;
  label: string;
  state: SystemHealthState;
  configured: boolean;
  recentEventCount: number;
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
        return {
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
