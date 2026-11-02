import { describe, expect, it, vi } from "vitest";
import {
  CHARACTER_RESERVATION_LOCK_NAMESPACE,
  lockCharactersForReservationInTx,
} from "@/lib/character-reservation-lock";

type RawPlan = {
  ast?: {
    parts?: Array<string | { kind?: string; value?: unknown }>;
  };
};

function characterIdFromPlan(plan: unknown): string | null {
  const parts = (plan as RawPlan).ast?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (typeof part === "object" && part && part.value === CHARACTER_RESERVATION_LOCK_NAMESPACE) {
      continue;
    }
    if (typeof part === "object" && part && typeof part.value === "string") {
      return part.value;
    }
  }
  return null;
}

describe("lockCharactersForReservationInTx", () => {
  it("acquires locks in deterministic sorted order and dedupes ids", async () => {
    const order: string[] = [];
    const tx = {
      execute: vi.fn(async (plan: never) => {
        const characterId = characterIdFromPlan(plan);
        if (characterId) order.push(characterId);
        return { affectedRows: 1 };
      }),
    };

    await lockCharactersForReservationInTx(tx, ["char-c", "char-a", "char-c", "char-b", ""]);

    expect(CHARACTER_RESERVATION_LOCK_NAMESPACE).toBe(837464);
    expect(order).toEqual(["char-a", "char-b", "char-c"]);
    expect(tx.execute).toHaveBeenCalledTimes(3);
  });
});
