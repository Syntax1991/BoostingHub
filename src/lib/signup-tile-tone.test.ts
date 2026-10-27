import { describe, expect, it } from "vitest";
import { SIGNUP_TILE_TONE_CLASSES, signupTileTone } from "@/lib/signup-tile-tone";

describe("signupTileTone", () => {
  it("a saved Character gets the same tint as one planned on another Run", () => {
    expect(signupTileTone({ selected: false, warning: false, saved: true })).toBe("saved");
    expect(SIGNUP_TILE_TONE_CLASSES.saved).toBe(SIGNUP_TILE_TONE_CLASSES.warning);
  });

  it("a drafted pick keeps the success tone even when saved or warned", () => {
    expect(signupTileTone({ selected: true, warning: true, saved: true })).toBe("selected");
    expect(signupTileTone({ selected: true, warning: false, saved: true })).toBe("selected");
  });

  it("warning wins over saved; no lockout and no warning stays plain", () => {
    expect(signupTileTone({ selected: false, warning: true, saved: true })).toBe("warning");
    expect(signupTileTone({ selected: false, warning: false, saved: false })).toBe("default");
  });
});
