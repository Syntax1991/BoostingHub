import { describe, expect, it, vi } from "vitest";
import {
  GATEWAY_MESSAGE_CONTENT_FLAG,
  GATEWAY_MESSAGE_CONTENT_LIMITED_FLAG,
  capabilityFromApplicationFlags,
  classifyMessageContent,
  describeMessageContentStatus,
  getMessageContentStatus,
  probeMessageContentCapability,
  refineCapabilityFromMessages,
  type MessageContentFacts,
} from "@/discord-bot/message-content";

/** A guild message from another member whose content fields came back empty. */
const empty: MessageContentFacts = {
  content: "",
  hasEmbeds: false,
  hasAttachments: false,
  hasComponents: false,
  hasPoll: false,
  hasStickers: false,
  isSystem: false,
  authoredByApp: false,
  mentionsApp: false,
};

describe("application capability (GET /applications/@me flags)", () => {
  it("GATEWAY_MESSAGE_CONTENT (1 << 18, verified apps) → AVAILABLE", () => {
    expect(GATEWAY_MESSAGE_CONTENT_FLAG).toBe(262_144);
    expect(capabilityFromApplicationFlags(GATEWAY_MESSAGE_CONTENT_FLAG | (1 << 23))).toEqual({
      capability: "AVAILABLE",
      source: "APPLICATION_FLAGS",
    });
  });

  it("GATEWAY_MESSAGE_CONTENT_LIMITED (1 << 19, the portal toggle for apps in < 100 servers) → AVAILABLE", () => {
    expect(GATEWAY_MESSAGE_CONTENT_LIMITED_FLAG).toBe(524_288);
    expect(capabilityFromApplicationFlags(GATEWAY_MESSAGE_CONTENT_LIMITED_FLAG).capability).toBe("AVAILABLE");
  });

  it("neither flag → UNAVAILABLE (authoritative); unreadable application → UNKNOWN", () => {
    expect(capabilityFromApplicationFlags((1 << 23) | (1 << 12))).toEqual({ capability: "UNAVAILABLE", source: "APPLICATION_FLAGS" });
    expect(capabilityFromApplicationFlags(0).capability).toBe("UNAVAILABLE");
    expect(capabilityFromApplicationFlags(null)).toEqual({ capability: "UNKNOWN", source: "NONE" });
  });
});

describe("classifyMessageContent", () => {
  it("1–3. text is TEXT: a member's, another bot's, or this app's own", () => {
    expect(classifyMessageContent({ ...empty, content: "hi\nthere" }, "AVAILABLE")).toBe("TEXT");
    expect(classifyMessageContent({ ...empty, content: "PhoenixStar Logs: new report" }, "AVAILABLE")).toBe("TEXT");
    expect(classifyMessageContent({ ...empty, authoredByApp: true, content: "Final Setup" }, "AVAILABLE")).toBe("TEXT");
  });

  it("4–6. embed-, attachment- or sticker-only with access → NON_TEXT (as are component / poll only)", () => {
    for (const key of ["hasEmbeds", "hasAttachments", "hasStickers", "hasComponents", "hasPoll"] as const) {
      expect(classifyMessageContent({ ...empty, [key]: true }, "AVAILABLE")).toBe("NON_TEXT");
    }
  });

  it("7. a member's message with every restricted field empty and access off → UNAVAILABLE (never 'no text')", () => {
    expect(classifyMessageContent(empty, "UNAVAILABLE")).toBe("UNAVAILABLE");
  });

  it("8–9. the app's own message is classified from its delivered payload even with access off", () => {
    expect(classifyMessageContent({ ...empty, authoredByApp: true, hasEmbeds: true }, "UNAVAILABLE")).toBe("NON_TEXT");
    expect(classifyMessageContent({ ...empty, authoredByApp: true, content: "Raidboost Announce" }, "UNAVAILABLE")).toBe("TEXT");
    expect(classifyMessageContent({ ...empty, authoredByApp: true }, "UNAVAILABLE")).toBe("NON_TEXT");
  });

  it("10. an empty member message while access is unknown → UNKNOWN", () => {
    expect(classifyMessageContent(empty, "UNKNOWN")).toBe("UNKNOWN");
  });

  it("with access on, an empty message is genuinely empty; Discord's exceptions (mention, system) are never 'unavailable'", () => {
    expect(classifyMessageContent(empty, "AVAILABLE")).toBe("NON_TEXT");
    expect(classifyMessageContent({ ...empty, mentionsApp: true }, "UNAVAILABLE")).toBe("NON_TEXT");
    expect(classifyMessageContent({ ...empty, isSystem: true }, "UNAVAILABLE")).toBe("NON_TEXT");
  });

  it("a member's message that still carries a visible field is judged by it, not called unavailable", () => {
    // e.g. a sticker (not message content) is delivered even without access.
    expect(classifyMessageContent({ ...empty, hasStickers: true }, "UNAVAILABLE")).toBe("NON_TEXT");
  });
});

describe("refineCapabilityFromMessages", () => {
  it("restricted content delivered for another member proves access; the app's own messages prove nothing", () => {
    const unknown = { capability: "UNKNOWN", source: "NONE" } as const;
    expect(refineCapabilityFromMessages(unknown, [{ ...empty, content: "text" }])).toEqual({ capability: "AVAILABLE", source: "OBSERVED" });
    expect(refineCapabilityFromMessages(unknown, [{ ...empty, hasEmbeds: true }])).toEqual({ capability: "AVAILABLE", source: "OBSERVED" });
    expect(refineCapabilityFromMessages(unknown, [{ ...empty, authoredByApp: true, content: "own", hasEmbeds: true }])).toEqual(unknown);
    expect(refineCapabilityFromMessages(unknown, [empty])).toEqual(unknown);
    const off = { capability: "UNAVAILABLE", source: "APPLICATION_FLAGS" } as const;
    expect(refineCapabilityFromMessages(off, [{ ...empty, content: "x" }])).toEqual(off);
  });
});

describe("startup diagnostic", () => {
  it("UNAVAILABLE: one actionable warning, no secrets; AVAILABLE: one info line", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    await probeMessageContentCapability(async () => 0, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const warning = String(log.warn.mock.calls[0]![0]);
    expect(warning).toContain("Discord Message Content: UNAVAILABLE (runtime-confirmed via application flags)");
    expect(warning).toContain("automatic Warcraft Logs link detection may be incomplete");
    expect(warning).toContain("Message Content Intent");
    expect(warning).not.toMatch(/token|secret|Bearer|\d{17,}/i);
    expect(getMessageContentStatus()).toEqual({ capability: "UNAVAILABLE", source: "APPLICATION_FLAGS" });

    await probeMessageContentCapability(async () => GATEWAY_MESSAGE_CONTENT_LIMITED_FLAG, log);
    expect(log.info).toHaveBeenCalledWith("[discord-bot] Discord Message Content: AVAILABLE (runtime-confirmed via application flags)");
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("UNKNOWN when the application cannot be read: one warning, no guess, never throws", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const status = await probeMessageContentCapability(async () => {
      throw new Error("503 Service Unavailable");
    }, log);
    expect(status).toEqual({ capability: "UNKNOWN", source: "NONE" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(describeMessageContentStatus(status).message).toContain("UNKNOWN (could not be determined)");
  });
});
