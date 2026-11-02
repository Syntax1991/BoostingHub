import { describe, expect, it } from "vitest";
import { wowClassIconUrl } from "@/lib/wow-class-icons";

describe("wowClassIconUrl", () => {
  it("builds Wowhead/Zamimg class icon URLs", () => {
    expect(wowClassIconUrl("WARLOCK")).toBe(
      "https://wow.zamimg.com/images/wow/icons/medium/classicon_warlock.jpg",
    );
    expect(wowClassIconUrl("DEATH_KNIGHT", "large")).toBe(
      "https://wow.zamimg.com/images/wow/icons/large/classicon_deathknight.jpg",
    );
    expect(wowClassIconUrl("DEMON_HUNTER")).toContain("classicon_demonhunter");
  });
});
