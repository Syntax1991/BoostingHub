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
  lootbuddySessions.clear();
}

/**
 * In-memory, per-(Discord User, Run) staging area for the Lootbuddy list
 * editor — a completely separate collection from the Booster session above
 * (never reuses `Map<characterId, role>` as Lootbuddy identity; a Lootbuddy
 * entry has no Character at all). `entries` holds only fully-resolved
 * entries (Class and Mode both chosen); an in-progress Add/Edit wizard step
 * lives in `pendingIndex`/`pendingClass` until Mode completes it. Nothing
 * persists until Confirm, exactly like the Booster session.
 */

export type WowClass =
  | "DEATH_KNIGHT"
  | "DEMON_HUNTER"
  | "DRUID"
  | "EVOKER"
  | "HUNTER"
  | "MAGE"
  | "MONK"
  | "PALADIN"
  | "PRIEST"
  | "ROGUE"
  | "SHAMAN"
  | "WARLOCK"
  | "WARRIOR";
export type LootbuddyMode = "LOOT_ONLY" | "PLAYING";

export type StagedLootbuddyEntry = {
  /** Present = this entry already exists server-side (editing it updates in place); absent = a new entry not yet saved. */
  signupId?: string;
  wowClass: WowClass;
  mode: LootbuddyMode;
};

export type StagedLootbuddySession = {
  discordUserId: string;
  runId: string;
  entries: StagedLootbuddyEntry[];
  /** Index into `entries` being edited by the in-progress Class→Mode wizard, or null when adding a brand-new entry. */
  pendingIndex: number | null;
  /** Set once the wizard's Class step completes, cleared once Mode completes it. */
  pendingClass: WowClass | null;
  expiresAt: number;
};

const lootbuddySessions = new Map<string, StagedLootbuddySession>();

function touch(session: StagedLootbuddySession): void {
  session.expiresAt = Date.now() + SESSION_TTL_MS;
}

/** Starts (or fully replaces) a Lootbuddy staging session, seeded with the User's current active entries. */
export function startLootbuddySession(input: {
  discordUserId: string;
  runId: string;
  entries: StagedLootbuddyEntry[];
}): StagedLootbuddySession {
  const session: StagedLootbuddySession = {
    discordUserId: input.discordUserId,
    runId: input.runId,
    entries: [...input.entries],
    pendingIndex: null,
    pendingClass: null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  lootbuddySessions.set(key(input.discordUserId, input.runId), session);
  return session;
}

/** Returns the live session, or undefined if none exists or it has expired (expired entries are pruned on read). */
export function getLootbuddySession(discordUserId: string, runId: string): StagedLootbuddySession | undefined {
  const k = key(discordUserId, runId);
  const session = lootbuddySessions.get(k);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    lootbuddySessions.delete(k);
    return undefined;
  }
  return session;
}

/** Begins the Add-a-new-entry wizard: the next Class/Mode selects append rather than replace. */
export function beginAddLootbuddy(discordUserId: string, runId: string): StagedLootbuddySession | undefined {
  const session = getLootbuddySession(discordUserId, runId);
  if (!session) return undefined;
  session.pendingIndex = null;
  session.pendingClass = null;
  touch(session);
  return session;
}

/** Begins the Edit-existing-entry wizard for `entries[index]`: the next Class/Mode selects replace that entry. */
export function beginEditLootbuddy(discordUserId: string, runId: string, index: number): StagedLootbuddySession | undefined {
  const session = getLootbuddySession(discordUserId, runId);
  if (!session || index < 0 || index >= session.entries.length) return undefined;
  session.pendingIndex = index;
  session.pendingClass = null;
  touch(session);
  return session;
}

/** The wizard's Class step. */
export function setPendingLootbuddyClass(discordUserId: string, runId: string, wowClass: WowClass): StagedLootbuddySession | undefined {
  const session = getLootbuddySession(discordUserId, runId);
  if (!session) return undefined;
  session.pendingClass = wowClass;
  touch(session);
  return session;
}

/** The wizard's Mode step — completes the pending Add (push) or Edit (replace in place) and clears the pending state. */
export function completePendingLootbuddy(discordUserId: string, runId: string, mode: LootbuddyMode): StagedLootbuddySession | undefined {
  const session = getLootbuddySession(discordUserId, runId);
  if (!session || !session.pendingClass) return undefined;
  const entry: StagedLootbuddyEntry = {
    signupId: session.pendingIndex != null ? session.entries[session.pendingIndex]?.signupId : undefined,
    wowClass: session.pendingClass,
    mode,
  };
  if (session.pendingIndex != null && session.pendingIndex < session.entries.length) {
    session.entries[session.pendingIndex] = entry;
  } else {
    session.entries.push(entry);
  }
  session.pendingIndex = null;
  session.pendingClass = null;
  touch(session);
  return session;
}

/** Removes one staged entry by its current array position. */
export function removeLootbuddyEntry(discordUserId: string, runId: string, index: number): StagedLootbuddySession | undefined {
  const session = getLootbuddySession(discordUserId, runId);
  if (!session || index < 0 || index >= session.entries.length) return undefined;
  session.entries.splice(index, 1);
  touch(session);
  return session;
}

/** Ends the session without touching persisted signup state — the Cancel path. */
export function discardLootbuddySession(discordUserId: string, runId: string): void {
  lootbuddySessions.delete(key(discordUserId, runId));
}
