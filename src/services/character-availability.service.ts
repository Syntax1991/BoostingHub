import type { AuthenticatedUser } from "@/auth/authorization";
import {
  assertValidAvailabilityInterval,
  isAvailabilityBlockCurrentOrUpcoming,
  runStartFallsInAvailabilityBlock,
} from "@/lib/character-availability";
import { formatDate, formatDateTime, formatTime, toUtcIso, zonedParts } from "@/lib/datetime";
import { DomainError } from "@/lib/errors";
import {
  characterAvailabilityRepository,
  type CharacterAvailabilityBlockRecord,
} from "@/repositories/character-availability.repository";
import { characterRepository } from "@/repositories/character.repository";

export const AVAILABILITY_REASON_MAX = 120;

export type AvailabilityBlockWrite = {
  startsAt: string;
  endsAt: string;
  reason?: string | null;
};

/** Compact external-plan projection for /characters (current/upcoming only). */
export type ExternalPlanningSummary = {
  id: string;
  characterId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  isCurrent: boolean;
  communityLabel: string;
  timeLabel: string;
  label: string;
};

function assertOwned(user: AuthenticatedUser, character: { userId: string }) {
  if (character.userId !== user.id) {
    throw new DomainError("CHARACTER_NOT_OWNED", "You can only manage your own characters.", 403);
  }
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  if (trimmed.length > AVAILABILITY_REASON_MAX) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `Community / note must be at most ${AVAILABILITY_REASON_MAX} characters.`,
    );
  }
  return trimmed;
}

function normalizeInterval(input: AvailabilityBlockWrite): {
  startsAt: string;
  endsAt: string;
  reason: string | null;
} {
  if (!input.startsAt?.trim() || !input.endsAt?.trim()) {
    throw new DomainError("VALIDATION_FAILED", "Choose a start and end time.");
  }
  if (Number.isNaN(Date.parse(input.startsAt)) || Number.isNaN(Date.parse(input.endsAt))) {
    throw new DomainError("VALIDATION_FAILED", "Enter a valid start and end time.");
  }
  const startsAt = toUtcIso(input.startsAt);
  const endsAt = toUtcIso(input.endsAt);
  try {
    assertValidAvailabilityInterval(startsAt, endsAt);
  } catch {
    throw new DomainError("VALIDATION_FAILED", "End time must be after start time.");
  }
  return { startsAt, endsAt, reason: normalizeReason(input.reason) };
}

export function formatAvailabilityBlockMessage(block: Pick<CharacterAvailabilityBlockRecord, "startsAt" | "endsAt" | "reason">): string {
  const window = `${formatTime(block.startsAt)}–${formatTime(block.endsAt)}`;
  const day = formatDateTime(block.startsAt).replace(/\s+\d{2}:\d{2}$/, "");
  const base = `Unavailable ${day} ${window}`;
  return block.reason ? `${base} — ${block.reason}` : base;
}

function communityLabel(reason: string | null): string {
  return reason?.trim() ? reason.trim() : "External commitment";
}

/** Compact Europe/Berlin window for table cells, e.g. `Fri 22:00–23:30`. */
export function formatExternalPlanTimeLabel(startsAt: string, endsAt: string): string {
  const start = zonedParts(new Date(startsAt), "Europe/Berlin");
  const startDay = `${start.weekday} ${String(start.day).padStart(2, "0")}/${String(start.month).padStart(2, "0")}/${start.year}`;
  const endDay = formatDate(endsAt);
  const window = `${formatTime(startsAt)}–${formatTime(endsAt)}`;
  if (startDay === endDay) {
    return `${start.weekday} ${window}`;
  }
  return `${startDay} ${formatTime(startsAt)} → ${endDay} ${formatTime(endsAt)}`;
}

function projectBlock(block: CharacterAvailabilityBlockRecord) {
  return {
    id: block.id,
    characterId: block.characterId,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    reason: block.reason,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    label: formatAvailabilityBlockMessage(block),
  };
}

function projectExternalSummary(
  block: CharacterAvailabilityBlockRecord,
  now: Date | string | number = Date.now(),
): ExternalPlanningSummary {
  return {
    id: block.id,
    characterId: block.characterId,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    reason: block.reason,
    isCurrent: runStartFallsInAvailabilityBlock(now, block),
    communityLabel: communityLabel(block.reason),
    timeLabel: formatExternalPlanTimeLabel(block.startsAt, block.endsAt),
    label: formatAvailabilityBlockMessage(block),
  };
}

function sortBlocks(blocks: CharacterAvailabilityBlockRecord[]): CharacterAvailabilityBlockRecord[] {
  return [...blocks].sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      a.endsAt.localeCompare(b.endsAt) ||
      a.id.localeCompare(b.id),
  );
}

export const characterAvailabilityService = {
  async listForCharacter(user: AuthenticatedUser, characterId: string) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    const blocks = await characterAvailabilityRepository.listByCharacterId(characterId);
    const upcoming = blocks
      .filter((block) => isAvailabilityBlockCurrentOrUpcoming(block))
      .map(projectBlock);
    const past = blocks
      .filter((block) => !isAvailabilityBlockCurrentOrUpcoming(block))
      .map(projectBlock)
      .reverse();

    return { upcoming, past };
  },

  /**
   * Batched current/upcoming external plans for /characters.
   * One repository read for all Character ids; past blocks excluded.
   */
  async listCurrentOrUpcomingByCharacterIds(
    characterIds: readonly string[],
    now: Date | string | number = Date.now(),
  ): Promise<Map<string, ExternalPlanningSummary[]>> {
    const uniqueIds = [...new Set(characterIds.filter(Boolean))];
    const result = new Map<string, ExternalPlanningSummary[]>(
      uniqueIds.map((id) => [id, []]),
    );
    if (uniqueIds.length === 0) {
      return result;
    }

    const blocks = await characterAvailabilityRepository.listByCharacterIds(uniqueIds);
    for (const block of sortBlocks(blocks)) {
      if (!isAvailabilityBlockCurrentOrUpcoming(block, now)) continue;
      const bucket = result.get(block.characterId);
      if (!bucket) continue;
      bucket.push(projectExternalSummary(block, now));
    }
    return result;
  },

  async createBlock(user: AuthenticatedUser, characterId: string, input: AvailabilityBlockWrite) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    const normalized = normalizeInterval(input);
    const created = await characterAvailabilityRepository.create({
      characterId,
      ...normalized,
    });
    return projectBlock(created);
  },

  async updateBlock(user: AuthenticatedUser, blockId: string, input: AvailabilityBlockWrite) {
    const existing = await characterAvailabilityRepository.findById(blockId);
    if (!existing) {
      throw new DomainError("AVAILABILITY_BLOCK_NOT_FOUND", "Availability block was not found.", 404);
    }
    const character = await characterRepository.findById(existing.characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    const normalized = normalizeInterval(input);
    const updated = await characterAvailabilityRepository.update(blockId, normalized);
    return projectBlock(updated);
  },

  async deleteBlock(user: AuthenticatedUser, blockId: string) {
    const existing = await characterAvailabilityRepository.findById(blockId);
    if (!existing) {
      throw new DomainError("AVAILABILITY_BLOCK_NOT_FOUND", "Availability block was not found.", 404);
    }
    const character = await characterRepository.findById(existing.characterId);
    if (!character) {
      throw new DomainError("CHARACTER_NOT_FOUND", "Character was not found.", 404);
    }
    assertOwned(user, character);

    await characterAvailabilityRepository.delete(blockId);
    return { characterId: existing.characterId };
  },
};
