import { describe, expect, it } from "vitest";
import {
  normalizeRunDomainEventActor,
  sanitizeRunDomainEventPayload,
  serializeRunDomainEventPayload,
} from "@/lib/run-domain-event";

describe("sanitizeRunDomainEventPayload", () => {
  it("keeps allowlisted scalars and drops secrets / nested values", () => {
    expect(
      sanitizeRunDomainEventPayload({
        fromStatus: "PUBLISHED",
        toStatus: "IN_PROGRESS",
        token: "secret",
        nested: { a: 1 },
        selectedCount: 8,
      }),
    ).toEqual({
      fromStatus: "PUBLISHED",
      toStatus: "IN_PROGRESS",
      selectedCount: 8,
    });
  });

  it("rejects Error and array payloads", () => {
    expect(sanitizeRunDomainEventPayload(new Error("boom") as unknown as Record<string, unknown>)).toBeNull();
    expect(sanitizeRunDomainEventPayload(["a"] as unknown as Record<string, unknown>)).toBeNull();
  });

  it("serializes to JSON or null", () => {
    expect(serializeRunDomainEventPayload({ difficulty: "HEROIC" })).toBe(JSON.stringify({ difficulty: "HEROIC" }));
    expect(serializeRunDomainEventPayload({ unknown: 1 })).toBeNull();
  });
});

describe("normalizeRunDomainEventActor", () => {
  it("clears actorUserId for SYSTEM", () => {
    expect(normalizeRunDomainEventActor({ actorKind: "SYSTEM", actorUserId: "u1" })).toEqual({
      actorKind: "SYSTEM",
      actorUserId: null,
    });
  });

  it("requires actorUserId for USER", () => {
    expect(() => normalizeRunDomainEventActor({ actorKind: "USER", actorUserId: null })).toThrow(
      /requires actorUserId/,
    );
  });
});
