import { describe, expect, it } from "vitest";
import {
  attachRunWarcraftLogsReportSchema,
  decideRunWarcraftLogsFightSchema,
  detachRunWarcraftLogsReportSchema,
  parseWarcraftLogsReportCode,
} from "@/validators/run-consumable-audit";

describe("parseWarcraftLogsReportCode", () => {
  it("accepts a bare code and retail report URLs", () => {
    expect(parseWarcraftLogsReportCode("zrQydCT4vaDFk1fw")).toBe("zrQydCT4vaDFk1fw");
    expect(parseWarcraftLogsReportCode("https://www.warcraftlogs.com/reports/zrQydCT4vaDFk1fw")).toBe(
      "zrQydCT4vaDFk1fw",
    );
    expect(
      parseWarcraftLogsReportCode(" https://de.warcraftlogs.com/reports/zrQydCT4vaDFk1fw/#fight=4&type=damage-done "),
    ).toBe("zrQydCT4vaDFk1fw");
  });

  it("rejects classic sites, other hosts and malformed codes", () => {
    expect(parseWarcraftLogsReportCode("https://classic.warcraftlogs.com/reports/zrQydCT4vaDFk1fw")).toBeNull();
    expect(parseWarcraftLogsReportCode("https://evil.example/reports/zrQydCT4vaDFk1fw")).toBeNull();
    expect(parseWarcraftLogsReportCode("https://warcraftlogs.com.evil.example/reports/zrQydCT4vaDFk1fw")).toBeNull();
    expect(parseWarcraftLogsReportCode("https://www.warcraftlogs.com/character/id/123")).toBeNull();
    expect(parseWarcraftLogsReportCode("short")).toBeNull();
    expect(parseWarcraftLogsReportCode("javascript:alert(1)")).toBeNull();
  });

  it("attach schema maps a link to its code and requires one", () => {
    const runId = "r9999992-9992-4992-8992-999999999992";
    expect(
      attachRunWarcraftLogsReportSchema.parse({ runId, report: "https://www.warcraftlogs.com/reports/zrQydCT4vaDFk1fw" })
        .report,
    ).toBe("zrQydCT4vaDFk1fw");
    expect(() => attachRunWarcraftLogsReportSchema.parse({ runId })).toThrow();
    expect(() => attachRunWarcraftLogsReportSchema.parse({ runId, report: "nope" })).toThrow();
  });

  it("detach and decide schemas validate their ids", () => {
    const runId = "r9999992-9992-4992-8992-999999999992";
    expect(() => detachRunWarcraftLogsReportSchema.parse({ runId, reportCode: "../../etc" })).toThrow();
    expect(detachRunWarcraftLogsReportSchema.parse({ runId, reportCode: "zrQydCT4vaDFk1fw" }).reportCode).toBe(
      "zrQydCT4vaDFk1fw",
    );
    expect(() => decideRunWarcraftLogsFightSchema.parse({ runId, fightId: "x", assign: "yes" })).toThrow();
  });
});
