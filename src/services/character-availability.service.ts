import type { AuthenticatedUser } from "@/auth/authorization";
import {
  assertValidAvailabilityInterval,
  isAvailabilityBlockCurrentOrUpcoming,
} from "@/lib/character-availability";
import { formatDateTime, formatTime, toUtcIso } from "@/lib/datetime";
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
      `Reason must be at most ${AVAILABILITY_REASON_MAX} characters.`,
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
