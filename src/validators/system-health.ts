import {
  INTEGRATION_EVENT_STATUSES,
  INTEGRATION_PROVIDERS,
  type IntegrationEventStatus,
  type IntegrationProvider,
} from "@/models/enums";

export type SystemHealthPageFilters = {
  provider: IntegrationProvider | null;
  status: IntegrationEventStatus | null;
  operation: string | null;
  limit: number;
  offset: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Invalid values fall back to "no filter" — never an error page. */
export function parseSystemHealthFilters(searchParams: RawParams): SystemHealthPageFilters {
  const limitRaw = Number(first(searchParams.limit) ?? "25");
  const offsetRaw = Number(first(searchParams.offset) ?? "0");
  return {
    provider: oneOf(first(searchParams.provider), INTEGRATION_PROVIDERS) ?? null,
    status: oneOf(first(searchParams.status), INTEGRATION_EVENT_STATUSES) ?? null,
    operation: first(searchParams.operation)?.trim() || null,
    limit: Number.isFinite(limitRaw) ? limitRaw : 25,
    offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
  };
}
