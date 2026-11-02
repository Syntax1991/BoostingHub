import { describe, expect, it } from "vitest";
import {
  formatWeeklyAvailabilityButtonLabel,
  formatWeeklyAvailabilityDetailSummary,
  normalizeUnavailableDifficulties,
} from "@/lib/weekly-availability-display";

describe("weekly availability display", () => {
  it("normalizes difficulty order and drops duplicates", () => {
    expect(normalizeUnavailableDifficulties(["MYTHIC", "NORMAL", "MYTHIC", "HEROIC"])).toEqual([
      "NORMAL",
      "HEROIC",
      "MYTHIC",
    ]);
  });

  it("formats compact button labels", () => {
    expect(formatWeeklyAvailabilityButtonLabel([])).toBe("Available");
    expect(formatWeeklyAvailabilityButtonLabel(["HEROIC"])).toBe("Unavailable · HC");
    expect(formatWeeklyAvailabilityButtonLabel(["NORMAL", "HEROIC"])).toBe("Unavailable · N + HC");
    expect(formatWeeklyAvailabilityButtonLabel(["HEROIC", "MYTHIC"])).toBe("Unavailable · HC + M");
    expect(formatWeeklyAvailabilityButtonLabel(["NORMAL", "HEROIC", "MYTHIC"])).toBe(
      "Unavailable · All",
    );
  });

  it("formats detail summaries", () => {
    expect(formatWeeklyAvailabilityDetailSummary([])).toEqual({
      headline: "Available this reset",
      detail: null,
    });
    expect(formatWeeklyAvailabilityDetailSummary(["HEROIC", "MYTHIC"])).toEqual({
      headline: "Unavailable this reset",
      detail: "Heroic, Mythic",
    });
  });
});
