import { describe, expect, it } from "vitest";
import {
  INTEGRATION_METADATA_ALLOWLIST,
  safeIntegrationErrorCode,
  sanitizeIntegrationMetadata,
  serializeIntegrationMetadata,
} from "@/lib/integration-telemetry";
import { DomainError } from "@/lib/errors";

describe("integration telemetry redaction", () => {
  it("keeps only allowlisted scalar metadata keys", () => {
    expect(
      sanitizeIntegrationMetadata({
        processed: 10,
        succeeded: 8,
        failed: 2,
        secretToken: "abc",
        nested: { a: 1 },
        authorization: "Bearer x",
        rawBody: "<html>",
      }),
    ).toEqual({ processed: 10, succeeded: 8, failed: 2 });
  });

  it("rejects Error objects and arrays as metadata roots", () => {
    expect(sanitizeIntegrationMetadata(new Error("boom") as unknown as Record<string, unknown>)).toBeNull();
    expect(sanitizeIntegrationMetadata(["a"] as unknown as Record<string, unknown>)).toBeNull();
  });

  it("never serializes forbidden keys even if present", () => {
    const json = serializeIntegrationMetadata({
      processed: 1,
      access_token: "leak",
      refreshToken: "leak",
      bot_token: "leak",
      client_secret: "leak",
      Authorization: "Bearer leak",
      cookie: "session=1",
    });
    expect(json).toBe(JSON.stringify({ processed: 1 }));
    expect(json).not.toMatch(/leak|Bearer|session/i);
  });

  it("allowlist does not include secret-like keys", () => {
    for (const key of INTEGRATION_METADATA_ALLOWLIST) {
      expect(key).not.toMatch(/token|secret|password|authorization|cookie/i);
    }
  });

  it("safeIntegrationErrorCode uses DomainError.code and never stacks", () => {
    expect(safeIntegrationErrorCode(new DomainError("BATTLENET_RATE_LIMITED", "slow down", 429))).toBe(
      "BATTLENET_RATE_LIMITED",
    );
    const err = new Error("secret token=abc in message");
    expect(safeIntegrationErrorCode(err)).toBe("Error");
    expect(safeIntegrationErrorCode(err)).not.toContain("token");
  });
});
