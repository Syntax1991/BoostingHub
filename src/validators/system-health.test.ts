import { describe, expect, it } from "vitest";
import { parseSystemHealthFilters } from "@/validators/system-health";

describe("parseSystemHealthFilters", () => {
  it("parses known provider/status and clamps invalid to null", () => {
    expect(
      parseSystemHealthFilters({
        provider: "DISCORD",
        status: "ERROR",
        operation: " SYNC_ONCE ",
        limit: "50",
        offset: "10",
      }),
    ).toEqual({
      provider: "DISCORD",
      status: "ERROR",
      operation: "SYNC_ONCE",
      limit: 50,
      offset: 10,
    });

    expect(
      parseSystemHealthFilters({
        provider: "NOT_A_PROVIDER",
        status: "NOPE",
      }),
    ).toMatchObject({
      provider: null,
      status: null,
      operation: null,
      limit: 25,
      offset: 0,
    });
  });
});
