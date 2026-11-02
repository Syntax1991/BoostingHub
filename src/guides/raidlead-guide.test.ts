import { describe, expect, it } from "vitest";
import { RAIDLEAD_GUIDE_CARDS } from "@/guides/raidlead-guide";

describe("raid lead guide content", () => {
  it("has exactly six canonical cards", () => {
    expect(RAIDLEAD_GUIDE_CARDS.map((c) => c.key)).toEqual([
      "raid-lead-basics",
      "create-run",
      "open-manage-signups",
      "build-roster",
      "run-attendance",
      "complete-run",
    ]);
  });

  it("documents Community, the Publish button, and a completion step without any financial workflow", () => {
    const create = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "create-run")!;
    const roster = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "build-roster")!;
    const complete = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "complete-run")!;
    expect(create.description).toMatch(/Community/);
    expect(roster.description).toMatch(/\*\*Publish\*\*/);
    expect(complete.description).toMatch(/Correct Attendance/);
    for (const card of RAIDLEAD_GUIDE_CARDS) {
      expect(JSON.stringify(card)).not.toMatch(/payout|settlement|mark paid|gold pot/i);
    }
  });
});
