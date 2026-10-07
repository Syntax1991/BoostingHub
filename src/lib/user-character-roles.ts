import { availableRoles } from "@/lib/character-capabilities";
import { CONCRETE_CHARACTER_ROLES, type ConcreteCharacterRole } from "@/lib/character-roles";
import type { WowClass } from "@/models/enums";

export type CharacterRoleCapabilityInput = {
  isActive: boolean;
  wowClass: WowClass;
  specialization: string | null;
  playableSpecs: readonly string[];
};

/**
 * Distinct concrete roles across a User's active Characters, in central order.
 * Informational only — independent of User.isBooster.
 */
export function unionActiveCharacterRoles(
  characters: readonly CharacterRoleCapabilityInput[],
): ConcreteCharacterRole[] {
  const roles = new Set<ConcreteCharacterRole>();
  for (const character of characters) {
    if (!character.isActive) continue;
    for (const role of availableRoles(character)) {
      roles.add(role);
    }
  }
  return CONCRETE_CHARACTER_ROLES.filter((role) => roles.has(role));
}
