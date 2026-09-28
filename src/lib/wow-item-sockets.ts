import data from "@/lib/wow-item-sockets.data.json";

/**
 * Gem sockets of an equipped item — Warcraft Logs reports the item id, its
 * bonus list ids and the gems in it, but not its sockets. Game data (see
 * scripts/generate-wow-item-sockets.mjs): base sockets of the item plus
 * sockets added by its bonus lists.
 */

const socketsByBonusList = new Map<number, number>(
  Object.entries(data.socketsByBonusList).map(([id, count]) => [Number(id), count]),
);
const baseSocketsByItem = new Map<number, number>();
for (const [count, ids] of Object.entries(data.itemsBySocketCount)) {
  for (const id of ids) baseSocketsByItem.set(id, Number(count));
}

/** Client build the socket table was generated from. */
export const WOW_ITEM_SOCKETS_BUILD: string | null = data.build;
/** Highest item id the table knows; newer items (a later patch) are unknown. */
export const WOW_ITEM_SOCKETS_MAX_ITEM_ID: number = data.maxKnownItemId;

/**
 * Sockets of the actual equipped item — never assumed from its slot. Null
 * ("unknown", never a missing gem) when the item is newer than the table, or
 * when the game data cannot explain what the log shows (more gems than known
 * sockets: a bonus the table does not know yet).
 */
export function itemSocketCount(input: { itemId: number; bonusIds: readonly number[]; gemCount: number }): number | null {
  if (input.itemId > WOW_ITEM_SOCKETS_MAX_ITEM_ID) return null;
  const sockets =
    (baseSocketsByItem.get(input.itemId) ?? 0) +
    input.bonusIds.reduce((sum, id) => sum + (socketsByBonusList.get(id) ?? 0), 0);
  return input.gemCount > sockets ? null : sockets;
}
