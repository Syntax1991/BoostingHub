import { z } from "zod";
import { WOW_CLASSES, WOW_REGIONS, type WowClass, type WowRegion } from "@/models/enums";
import type { CharacterLinkageState, CharacterSyncHealth } from "@/lib/blizzard/sync-health";
import { entityIdSchema } from "@/validators/ids";

export const adminCharacterSyncSchema = z.object({ characterId: entityIdSchema });

export const CHARACTER_OPERATIONS_SORTS = ["character", "owner", "last_success", "health"] as const;
export type CharacterOperationsSort = (typeof CHARACTER_OPERATIONS_SORTS)[number];

const LINKAGE_VALUES = ["LINKED", "NOT_LINKED", "NO_CONNECTION"] as const satisfies readonly CharacterLinkageState[];
const HEALTH_VALUES = ["HEALTHY", "STALE", "ERROR", "NEVER_SYNCED"] as const satisfies readonly CharacterSyncHealth[];

export type CharacterOperationsFilters = {
  /** Character name or realm. */
  query?: string;
  /** Owner name / Discord username (substring) or exact owner id. */
  owner?: string;
  wowClass?: WowClass;
  region?: WowRegion;
  status: "all" | "active" | "retired";
  linkage?: CharacterLinkageState;
  /** Matches only active LINKED Characters. */
  health?: CharacterSyncHealth;
  sort: CharacterOperationsSort;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Unknown/invalid values fall back to "no filter" — never an error page. */
export function parseCharacterOperationsFilters(searchParams: RawParams): CharacterOperationsFilters {
  const statusRaw = first(searchParams.status);
  return {
    query: first(searchParams.query)?.trim() || undefined,
    owner: first(searchParams.owner)?.trim() || undefined,
    wowClass: oneOf(first(searchParams.class), WOW_CLASSES),
    region: oneOf(first(searchParams.region), WOW_REGIONS),
    status: statusRaw === "active" || statusRaw === "retired" ? statusRaw : "all",
    linkage: oneOf(first(searchParams.linkage), LINKAGE_VALUES),
    health: oneOf(first(searchParams.health), HEALTH_VALUES),
    sort: oneOf(first(searchParams.sort), CHARACTER_OPERATIONS_SORTS) ?? "character",
  };
}
