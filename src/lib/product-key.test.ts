import { describe, expect, it } from "vitest";
import { allocateUniqueProductKey, PRODUCT_KEY_PATTERN, productKeyBaseFromName } from "@/lib/product-key";

describe("productKeyBaseFromName", () => {
  it("normalizes punctuation and whitespace into UPPER_SNAKE_CASE", () => {
    expect(productKeyBaseFromName("The Venomous Abyss")).toBe("THE_VENOMOUS_ABYSS");
    expect(productKeyBaseFromName("Season 2 Bundle — Tide + The Venomous Abyss")).toBe(
      "SEASON_2_BUNDLE_TIDE_THE_VENOMOUS_ABYSS",
    );
    expect(productKeyBaseFromName("  Midnight   Bundle  ")).toBe("MIDNIGHT_BUNDLE");
  });

  it("always yields a validator-compatible key", () => {
    for (const name of ["", "!!!", "123 go", "é", "a"]) {
      expect(PRODUCT_KEY_PATTERN.test(productKeyBaseFromName(name))).toBe(true);
    }
  });
});

describe("allocateUniqueProductKey", () => {
  it("returns the base when free and suffixes on collision", async () => {
    const taken = new Set<string>(["MY_PRODUCT", "MY_PRODUCT_2"]);
    expect(await allocateUniqueProductKey("My Product", (key) => taken.has(key))).toBe("MY_PRODUCT_3");
    expect(await allocateUniqueProductKey("Brand New", (key) => taken.has(key))).toBe("BRAND_NEW");
  });
});
