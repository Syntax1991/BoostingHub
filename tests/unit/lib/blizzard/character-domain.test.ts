import { describe, expect, it } from "vitest";
import { realmSlugFromDisplayName } from "@/lib/blizzard/character-domain";

describe("realmSlugFromDisplayName", () => {
  it("lowercases and hyphenates multi-word realms", () => {
    expect(realmSlugFromDisplayName("Twisting Nether")).toBe("twisting-nether");
    expect(realmSlugFromDisplayName("Area 52")).toBe("area-52");
  });

  it("strips apostrophes so Blizzard profile lookups succeed", () => {
    expect(realmSlugFromDisplayName("Mal'Ganis")).toBe("malganis");
    expect(realmSlugFromDisplayName("Aman'Thul")).toBe("amanthul");
    expect(realmSlugFromDisplayName("Kel'Thuzad")).toBe("kelthuzad");
  });

  it("strips curly apostrophes as well", () => {
    expect(realmSlugFromDisplayName("Mal\u2019Ganis")).toBe("malganis");
  });
});
