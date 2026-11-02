/** Only retirement blocks a sync: unlinked / unconnected Characters sync PUBLIC. */
export type SyncIneligibleReason = "RETIRED";

export const SYNC_INELIGIBLE_COPY: Record<SyncIneligibleReason, string> = {
  RETIRED: "Retired characters are not synced.",
};

export function syncIneligibleReason(input: { isActive: boolean }): SyncIneligibleReason | null {
  return input.isActive ? null : "RETIRED";
}
