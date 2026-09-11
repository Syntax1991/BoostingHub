/**
 * Discord component custom IDs carry Run context only — they are never
 * trusted for authorization. Every action they trigger still resolves the
 * acting Discord User and re-validates through the Bot API / domain
 * Services. The runId format matches the server's entityIdSchema so a
 * malformed or foreign id fails fast before any network call.
 */
const NAMESPACE = "boostinghub";
const ACTIONS = ["signup", "lootbuddy", "cancel"] as const;
export type ButtonAction = (typeof ACTIONS)[number];

const RUN_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z-]{7,63}$/;

export function buildCustomId(action: ButtonAction, runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Refusing to build a custom id for an invalid runId: ${runId}`);
  }
  return `${NAMESPACE}:${action}:${runId}`;
}

export function parseCustomId(customId: string): { action: ButtonAction; runId: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== NAMESPACE) {
    return null;
  }
  const [, actionPart, runId] = parts;
  if (!(ACTIONS as readonly string[]).includes(actionPart) || !RUN_ID_PATTERN.test(runId)) {
    return null;
  }
  return { action: actionPart as ButtonAction, runId };
}
