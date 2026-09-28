/**
 * Discord Message Content access — what the bot can actually read.
 *
 * Official behavior (Discord docs, "Message Content Intent" + application
 * flags): `content`, `embeds`, `attachments`, `components` and `poll` of a
 * message are message content. Without Message Content access they come back
 * EMPTY — over the gateway and over REST (GET channel messages) alike —
 * except for messages the app sent itself, DMs with the app, messages that
 * mention the app, and the target of a message context-menu command.
 *
 * Access is the application's privileged "Message Content Intent" (Developer
 * Portal → Bot). The bot reads history over REST only, so no gateway intent is
 * requested: REST follows the application's access, and requesting the gateway
 * intent without the portal toggle would make Discord reject the login.
 * The application flags (GET /applications/@me, callable with the bot token)
 * say whether it is on — this is the technical capability, read at runtime:
 * - GATEWAY_MESSAGE_CONTENT (1 << 18): Discord reports Message Content access
 *   granted through its privileged intent review;
 * - GATEWAY_MESSAGE_CONTENT_LIMITED (1 << 19): Discord reports Message Content
 *   access enabled with the Bot page toggle, without review.
 * Either flag means this application currently receives message content, so
 * both map to AVAILABLE. Which apps need Discord's review (a Discord policy that
 * changes over time) is deliberately not modeled here — no server or user
 * counts, no verification status.
 */

export type MessageContentCapability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

/** How the capability is known: read from the application flags, seen in messages, or not at all. */
export type MessageContentCapabilitySource = "APPLICATION_FLAGS" | "OBSERVED" | "NONE";

export type MessageContentStatus = { capability: MessageContentCapability; source: MessageContentCapabilitySource };

/** Application flag: Message Content access granted through Discord's review. */
export const GATEWAY_MESSAGE_CONTENT_FLAG = 1 << 18;
/** Application flag: Message Content access enabled with the Bot page toggle (no review). */
export const GATEWAY_MESSAGE_CONTENT_LIMITED_FLAG = 1 << 19;

/** Capability from the application's flags; UNKNOWN when they could not be read. */
export function capabilityFromApplicationFlags(flags: number | null | undefined): MessageContentStatus {
  if (flags == null || !Number.isFinite(flags)) return { capability: "UNKNOWN", source: "NONE" };
  const enabled = (flags & (GATEWAY_MESSAGE_CONTENT_FLAG | GATEWAY_MESSAGE_CONTENT_LIMITED_FLAG)) !== 0;
  return { capability: enabled ? "AVAILABLE" : "UNAVAILABLE", source: "APPLICATION_FLAGS" };
}

/**
 * What a message's text slot holds.
 * TEXT: text is present. NON_TEXT: legitimately no text (embed, attachment,
 * sticker, component, poll, system message, or the app's own empty message).
 * UNAVAILABLE: Discord withheld it (no Message Content access). UNKNOWN: an
 * empty message from someone else while access itself is unknown.
 */
export type MessageContentState = "TEXT" | "NON_TEXT" | "UNAVAILABLE" | "UNKNOWN";

export type MessageContentFacts = {
  content: string;
  hasEmbeds: boolean;
  hasAttachments: boolean;
  hasComponents: boolean;
  hasPoll: boolean;
  /** Stickers are not message content — always delivered. */
  hasStickers: boolean;
  /** Not a regular user message (pins, joins, thread created, …). */
  isSystem: boolean;
  /** Written by this application — always delivered in full. */
  authoredByApp: boolean;
  /** Mentions this application — always delivered in full. */
  mentionsApp: boolean;
};

/** Pure: never invents text; an empty foreign message is only "unavailable" when access is known to be off. */
export function classifyMessageContent(
  facts: MessageContentFacts,
  capability: MessageContentCapability,
): MessageContentState {
  if (facts.content.trim().length > 0) return "TEXT";
  if (facts.hasEmbeds || facts.hasAttachments || facts.hasComponents || facts.hasPoll || facts.hasStickers) {
    return "NON_TEXT";
  }
  // Everything below is a message with no content fields at all.
  if (facts.isSystem || facts.authoredByApp || facts.mentionsApp) return "NON_TEXT";
  if (capability === "AVAILABLE") return "NON_TEXT";
  return capability === "UNAVAILABLE" ? "UNAVAILABLE" : "UNKNOWN";
}

/**
 * Refine UNKNOWN access from what a channel actually delivered: a message by
 * someone else that carries content-restricted data proves access is on.
 * Absence proves nothing (a channel may simply hold no such message).
 */
export function refineCapabilityFromMessages(
  status: MessageContentStatus,
  messages: ReadonlyArray<Pick<MessageContentFacts, "content" | "hasEmbeds" | "hasAttachments" | "hasComponents" | "hasPoll" | "authoredByApp" | "mentionsApp">>,
): MessageContentStatus {
  if (status.capability !== "UNKNOWN") return status;
  const seen = messages.some(
    (message) =>
      !message.authoredByApp &&
      !message.mentionsApp &&
      (message.content.trim().length > 0 ||
        message.hasEmbeds ||
        message.hasAttachments ||
        message.hasComponents ||
        message.hasPoll),
  );
  return seen ? { capability: "AVAILABLE", source: "OBSERVED" } : status;
}

export const MESSAGE_CONTENT_UNAVAILABLE_WARNING =
  "Discord Message Content access is unavailable; user-authored transcript text and automatic Warcraft Logs link detection may be incomplete. Enable Developer Portal → (the production bot's application) → Bot → Privileged Gateway Intents → Message Content Intent, then restart the bot.";

/** One log line for the operator (no ids, tokens or secrets). */
export function describeMessageContentStatus(status: MessageContentStatus): { level: "info" | "warn"; message: string } {
  const how =
    status.source === "APPLICATION_FLAGS"
      ? "runtime-confirmed via application flags"
      : status.source === "OBSERVED"
        ? "observed in fetched messages"
        : "could not be determined";
  if (status.capability === "AVAILABLE") {
    return { level: "info", message: `[discord-bot] Discord Message Content: AVAILABLE (${how})` };
  }
  if (status.capability === "UNAVAILABLE") {
    return { level: "warn", message: `[discord-bot] Discord Message Content: UNAVAILABLE (${how}). ${MESSAGE_CONTENT_UNAVAILABLE_WARNING}` };
  }
  return {
    level: "warn",
    message: `[discord-bot] Discord Message Content: UNKNOWN (${how}) — transcripts mark empty messages from others as "content unavailable or empty". Check Developer Portal → Bot → Message Content Intent.`,
  };
}

let current: MessageContentStatus = { capability: "UNKNOWN", source: "NONE" };

/** Process-wide status, set once when the bot is ready. */
export function getMessageContentStatus(): MessageContentStatus {
  return current;
}

export function setMessageContentStatus(status: MessageContentStatus): void {
  current = status;
}

/**
 * Read the application's flags once (bot token; GET /applications/@me) and
 * log the result once. A failed read leaves UNKNOWN — never a guess.
 */
export async function probeMessageContentCapability(
  fetchApplicationFlags: () => Promise<number | null | undefined>,
  log: Pick<Console, "info" | "warn"> = console,
): Promise<MessageContentStatus> {
  let status: MessageContentStatus;
  try {
    status = capabilityFromApplicationFlags(await fetchApplicationFlags());
  } catch {
    status = { capability: "UNKNOWN", source: "NONE" };
  }
  setMessageContentStatus(status);
  const { level, message } = describeMessageContentStatus(status);
  log[level](message);
  return status;
}
