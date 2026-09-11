import { describe, expect, it } from "vitest";
import { formatMySignups } from "@/discord-bot/commands/mysignups";

describe("formatMySignups", () => {
  it("groups multiple Character offers on the same Run into one line", () => {
    const lines = formatMySignups({
      pending: [
        { runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Synblast", status: "PENDING" },
        { runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Synlight", status: "PENDING" },
      ],
      selected: [],
      notSelected: [],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Weekend Heroic");
    expect(lines[0]).toContain("Synblast, Synlight");
    expect(lines[0]).toContain("Selected: Pending");
  });

  it("shows the selected character when one offer is SELECTED among several", () => {
    const lines = formatMySignups({
      pending: [{ runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Synblast", status: "PENDING" }],
      selected: [{ runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Synlight", status: "SELECTED" }],
      notSelected: [],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Selected: Synlight");
  });

  it("keeps different Runs as separate lines", () => {
    const lines = formatMySignups({
      pending: [
        { runId: "r1", runTitle: "Run One", participationType: "BOOSTER", characterName: "A", status: "PENDING" },
        { runId: "r2", runTitle: "Run Two", participationType: "BOOSTER", characterName: "B", status: "PENDING" },
      ],
      selected: [],
      notSelected: [],
    });

    expect(lines).toHaveLength(2);
  });

  it("returns an empty array for no signups", () => {
    expect(formatMySignups({ pending: [], selected: [], notSelected: [] })).toEqual([]);
  });
});
