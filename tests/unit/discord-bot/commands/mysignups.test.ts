import { describe, expect, it } from "vitest";
import { formatMySignups } from "@/discord-bot/commands/mysignups";

describe("formatMySignups", () => {
  it("groups multiple Character offers on the same Run into one line", () => {
    const lines = formatMySignups({
      pending: [
        { runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Testblast", status: "PENDING" },
        { runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Testlight", status: "PENDING" },
      ],
      selected: [],
      notSelected: [],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Weekend Heroic");
    expect(lines[0]).toContain("Testblast, Testlight");
    expect(lines[0]).toContain("Selected: Pending");
  });

  it("shows the selected character when one offer is SELECTED among several", () => {
    const lines = formatMySignups({
      pending: [{ runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Testblast", status: "PENDING" }],
      selected: [
        {
          runId: "r1",
          runTitle: "Weekend Heroic",
          participationType: "BOOSTER",
          characterName: "Testlight",
          status: "SELECTED",
          selectionState: "PUBLISHED",
          displayRole: "HEALER",
        },
      ],
      notSelected: [],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Selected: Testlight · Healer · Confirmed");
  });

  it("shows draft selection before publish", () => {
    const lines = formatMySignups({
      pending: [
        { runId: "r1", runTitle: "Weekend Heroic", participationType: "BOOSTER", characterName: "Testblast", status: "PENDING", selectionState: "OFFERED" },
      ],
      selected: [
        {
          runId: "r1",
          runTitle: "Weekend Heroic",
          participationType: "BOOSTER",
          characterName: "Testmist",
          status: "PENDING",
          selectionState: "DRAFT",
          displayRole: "HEALER",
        },
      ],
      notSelected: [],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Offered: Testmist, Testblast");
    expect(lines[0]).toContain("Selected: Testmist · Healer · Draft");
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
