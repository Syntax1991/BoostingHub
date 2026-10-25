import type { CharacterRole } from "@/models/enums";

/**
 * Role media for Characters / Signup tiles / Roster / Choose Spec.
 *
 * ## Blizzard Game Data
 * Spec media exists; dedicated role-icon *API* documents do not.
 * Group roles are TANK | HEALER | DAMAGE only.
 *
 * ## Authoritative UI artwork (static web assets)
 * Extracted once from WoW client CASC (via wago.tools), not redrawn:
 *
 * | Role   | Atlas member (UiTextureAtlas 2462 / FDID 5171843) |
 * | ------ | ------------------------------------------------- |
 * | Tank   | `ui-lfg-roleicon-tank` |
 * | Healer | `ui-lfg-roleicon-healer` (native green cross badge) |
 * | Damage | `ui-lfg-roleicon-dps` |
 *
 * Stored under `/public/media/roles/{tank,healer,dps}.png` (+ `loot.webp` for Lootbuddy).
 * MELEE_DPS / RANGED_DPS share Damage art; labels preserve Melee/Ranged.
 * Zero network at render — no per-row Blizzard fetch.
 *
 * See `public/media/roles/PROVENANCE.md`.
 */

export type WowGroupRole = "TANK" | "HEALER" | "DAMAGE";

export type RoleMedia = {
  groupRole: WowGroupRole;
  /** Static Blizzard-derived texture under `/public/media/roles`. */
  iconSrc: string;
  label: string;
  /** Present only when BoostingHub role is more specific than Blizzard DAMAGE */
  damageKind: "MELEE" | "RANGED" | null;
};

const GROUP_ICON: Record<WowGroupRole, string> = {
  TANK: "/media/roles/tank.png",
  HEALER: "/media/roles/healer.png",
  DAMAGE: "/media/roles/dps.png",
};

/** Lootbuddy is a participation type, not a CharacterRole — own static media. */
export const LOOTBUDDY_ICON_SRC = "/media/roles/loot.webp";

export function getLootbuddyMedia(): { iconSrc: string; label: string } {
  return { iconSrc: LOOTBUDDY_ICON_SRC, label: "Lootbuddy" };
}

/** Resolve cached/static role media. Safe to call per tile — no I/O. */
export function getRoleMedia(role: CharacterRole): RoleMedia {
  switch (role) {
    case "TANK":
      return { groupRole: "TANK", iconSrc: GROUP_ICON.TANK, label: "Tank", damageKind: null };
    case "HEALER":
      return { groupRole: "HEALER", iconSrc: GROUP_ICON.HEALER, label: "Healer", damageKind: null };
    case "MELEE_DPS":
      return {
        groupRole: "DAMAGE",
        iconSrc: GROUP_ICON.DAMAGE,
        label: "Melee DPS",
        damageKind: "MELEE",
      };
    case "RANGED_DPS":
      return {
        groupRole: "DAMAGE",
        iconSrc: GROUP_ICON.DAMAGE,
        label: "Ranged DPS",
        damageKind: "RANGED",
      };
    case "DPS":
      return {
        groupRole: "DAMAGE",
        iconSrc: GROUP_ICON.DAMAGE,
        label: "DPS",
        damageKind: null,
      };
  }
}
