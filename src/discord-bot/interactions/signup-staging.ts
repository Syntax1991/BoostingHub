/**
 * In-memory, per-(Discord User, Run) staging area for a BOOSTER signup being
 * configured through Discord. Nothing here is a second source of truth for
 * RunSignup data — it exists only so a User can pick Characters, adjust each
 * one's role, and back out, before a single `setCharacterOffers` call
 * commits the whole desired set on Confirm.
 *
 * Deliberately disposable: keyed by `${discordUserId}:${runId}` (never by an
 * ephemeral message id, so it survives Discord editing the same message
 * across steps), pruned lazily on access via a fixed TTL matching Discord's
 * own ~15 minute interaction-token editing window, and wiped entirely on
 * bot restart. Losing a stale editor on restart is fine — no RunSignup row
 * is ever written until Confirm, so persisted signup state is never at risk
 * from this state being lost. A stale/expired session is treated exactly
 * like a missing one everywhere it's read.
 */

export type CharacterRole = "TANK" | "HEALER" | "DPS";

export type StagedBoosterSession = {
  discordUserId: string;
  runId: string;
  /** characterId -> chosen role, or null when a Character has no specialization default and none has been chosen yet. */
  offers: Map<string, CharacterRole | null>;
  /** Whether this User already had an active BOOSTER offer on this Run when the editor was opened — controls "Confirm Signup" vs "Confirm Changes" copy. */
  isExistingSignup: boolean;
  expiresAt: number;
};

const SESSION_TTL_MS = 15 * 60 * 1000;

const sessions = new Map<string, StagedBoosterSession>();

function key(discordUserId: string, runId: string): string {
  return `${discordUserId}:${runId}`;
}

/** Starts (or fully replaces) a staging session, seeded with the given offers. */
export function startSession(input: {
  discordUserId: string;
  runId: string;
  offers: Array<{ characterId: string; role: CharacterRole | null }>;
  isExistingSignup: boolean;
}): StagedBoosterSession {
  const session: StagedBoosterSession = {
    discordUserId: input.discordUserId,
    runId: input.runId,
    offers: new Map(input.offers.map((offer) => [offer.characterId, offer.role])),
    isExistingSignup: input.isExistingSignup,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(key(input.discordUserId, input.runId), session);
  return session;
}

/** Returns the live session, or undefined if none exists or it has expired (expired entries are pruned on read). */
export function getSession(discordUserId: string, runId: string): StagedBoosterSession | undefined {
  const k = key(discordUserId, runId);
  const session = sessions.get(k);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(k);
    return undefined;
  }
  return session;
}

/** Sets one Character's staged role. Renews the TTL — an active editor never expires mid-use. */
export function setStagedRole(discordUserId: string, runId: string, characterId: string, role: CharacterRole): boolean {
  const session = getSession(discordUserId, runId);
  if (!session) return false;
  session.offers.set(characterId, role);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

/** Ends the session without touching persisted signup state — the Cancel path. */
export function discardSession(discordUserId: string, runId: string): void {
  sessions.delete(key(discordUserId, runId));
}

/** Test-only: clears every session so tests don't leak state across cases. */
export function clearAllSessionsForTests(): void {
  sessions.clear();
}
