/**
 * Discord component custom IDs carry Run context only — they are never
 * trusted for authorization. Every action they trigger still resolves the
 * acting Discord User and re-validates through the Bot API / domain
 * Services. The runId format matches the server's entityIdSchema so a
 * malformed or foreign id fails fast before any network call.
 */
const NAMESPACE = "boostinghub";
const ACTIONS = ["signup", "lootbuddy", "cancel", "signup-role", "signup-confirm"] as const;
export type ButtonAction = (typeof ACTIONS)[number];

/** Actions whose select menus need a per-Character identity — one row per selected Character in step 2. */
const CHARACTER_SCOPED_ACTIONS = ["signup-role"] as const;

const RUN_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z-]{7,63}$/;

export function buildCustomId(action: ButtonAction, runId: string, characterId?: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Refusing to build a custom id for an invalid runId: ${runId}`);
  }
  if (characterId !== undefined) {
    if (!(CHARACTER_SCOPED_ACTIONS as readonly string[]).includes(action)) {
      throw new Error(`Action "${action}" does not carry a characterId`);
    }
    if (!RUN_ID_PATTERN.test(characterId)) {
      throw new Error(`Refusing to build a custom id for an invalid characterId: ${characterId}`);
    }
    return `${NAMESPACE}:${action}:${runId}:${characterId}`;
  }
  return `${NAMESPACE}:${action}:${runId}`;
}

export function parseCustomId(customId: string): { action: ButtonAction; runId: string; characterId?: string } | null {
  const parts = customId.split(":");
  if (parts[0] !== NAMESPACE) {
    return null;
  }
  if (parts.length === 4) {
    const [, actionPart, runId, characterId] = parts;
    if (
      !(CHARACTER_SCOPED_ACTIONS as readonly string[]).includes(actionPart) ||
      !RUN_ID_PATTERN.test(runId) ||
      !RUN_ID_PATTERN.test(characterId)
    ) {
      return null;
    }
    return { action: actionPart as ButtonAction, runId, characterId };
  }
  if (parts.length === 3) {
    const [, actionPart, runId] = parts;
    if (!(ACTIONS as readonly string[]).includes(actionPart) || !RUN_ID_PATTERN.test(runId)) {
      return null;
    }
    return { action: actionPart as ButtonAction, runId };
  }
  return null;
}
