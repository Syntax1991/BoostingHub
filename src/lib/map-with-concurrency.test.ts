import { describe, expect, it, vi } from "vitest";
import {
  mapWithConcurrency,
  RAIDER_IO_LOOKUP_CONCURRENCY,
} from "@/lib/map-with-concurrency";

describe("mapWithConcurrency", () => {
  it("preserves order and never exceeds the concurrency ceiling", async () => {
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      started.push(value);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("Raider.IO lookup concurrency constant is 3", () => {
    expect(RAIDER_IO_LOOKUP_CONCURRENCY).toBe(3);
  });

  it("runs empty input without calling the mapper", async () => {
    const mapper = vi.fn(async () => 1);
    await expect(mapWithConcurrency([], 3, mapper)).resolves.toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("caps workers at the item count when smaller than concurrency", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency(["a", "b"], 10, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value;
    });
    expect(peak).toBe(2);
  });
});
