import { describe, expect, it } from "vitest";
import { deriveProviderHealth } from "@/lib/system-health";

describe("deriveProviderHealth", () => {
  it("returns NOT_CONFIGURED when provider is not configured", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: false,
        recentStatuses: ["SUCCESS"],
      }),
    ).toBe("NOT_CONFIGURED");
  });

  it("returns UNKNOWN when configured but no recent events", () => {
    expect(
      deriveProviderHealth({
        provider: "DISCORD",
        configured: true,
        recentStatuses: [],
      }),
    ).toBe("UNKNOWN");
  });

  it("returns HEALTHY for success-only window", () => {
    expect(
      deriveProviderHealth({
        provider: "SYSTEM",
        configured: true,
        recentStatuses: ["SUCCESS", "SUCCESS"],
      }),
    ).toBe("HEALTHY");
  });

  it("returns DEGRADED for warnings without errors", () => {
    expect(
      deriveProviderHealth({
        provider: "DISCORD",
        configured: true,
        recentStatuses: ["WARNING", "SUCCESS"],
      }),
    ).toBe("DEGRADED");
  });

  it("returns DOWN when newest event is ERROR", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentStatuses: ["ERROR", "SUCCESS"],
      }),
    ).toBe("DOWN");
  });

  it("returns DEGRADED when an older ERROR was followed by SUCCESS", () => {
    expect(
      deriveProviderHealth({
        provider: "BLIZZARD",
        configured: true,
        recentStatuses: ["SUCCESS", "ERROR"],
      }),
    ).toBe("DEGRADED");
  });
});
