import { WOW_SPEC_ICON_FILE_DATA_IDS } from "@/lib/wow-spec-icon-file-ids";
import { specializationIdFor } from "@/lib/wow-specializations";
import type { WowClass } from "@/models/enums";

/**
 * Authoritative specialization icons from Blizzard Game Data media
 * (`playable-specialization` → `file_data_id`), rendered via the public CDN.
 *
 * Static map — zero live Blizzard requests during Signup/Roster render.
 */

const RENDER_HOST = "https://render.worldofwarcraft.com/eu/icons/56";

export type SpecMedia = {
  specId: number;
  iconSrc: string;
  name: string;
};

export function wowSpecIconUrlById(specId: number): string | null {
  const fileId = WOW_SPEC_ICON_FILE_DATA_IDS[specId];
  if (fileId == null) return null;
  return `${RENDER_HOST}/${fileId}.jpg`;
}

/** Resolve cached media for a catalog specialization name. */
export function getSpecializationMedia(wowClass: WowClass, specialization: string): SpecMedia | null {
  const specId = specializationIdFor(wowClass, specialization);
  if (specId == null) return null;
  const iconSrc = wowSpecIconUrlById(specId);
  if (!iconSrc) return null;
  return { specId, iconSrc, name: specialization };
}
