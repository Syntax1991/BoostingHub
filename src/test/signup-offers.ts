import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { CharacterRole } from "@/models/enums";
import { signupService } from "@/services/signup.service";

/**
 * Booster offers made through the production entry point
 * (`signupService.setCharacterOffers`), so the signup window, eligibility and
 * role checks apply exactly as in the app, with the same error codes.
 *
 * setCharacterOffers takes the User's complete offer set for the Run: a
 * Character offered earlier and left out here is withdrawn. Returns the offer
 * (RunSignup) ids in input order.
 */
export async function offerCharacters(
  actor: AuthenticatedUser,
  runId: string,
  offers: ReadonlyArray<{ characterId: string; roles: CharacterRole[] }>,
): Promise<string[]> {
  await signupService.setCharacterOffers(actor, {
    runId,
    offers: offers.map((offer) => ({ characterId: offer.characterId, offeredRoles: offer.roles })),
  });
  const rows = (await orm.RunSignup.where({ runId, userId: actor.id, participationType: "BOOSTER" })
    .select("id", "characterId", "status")
    .all()) as Array<{ id: string; characterId: string | null; status: string }>;
  return offers.map(({ characterId }) => {
    const row = rows.find((candidate) => candidate.characterId === characterId && candidate.status !== "WITHDRAWN");
    if (!row) throw new Error(`setCharacterOffers left no active offer for Character ${characterId}.`);
    return row.id;
  });
}

/** One Character offered in one role, as the User's only Booster offer on the Run. */
export async function offerCharacter(actor: AuthenticatedUser, runId: string, characterId: string, role: CharacterRole): Promise<string> {
  const [signupId] = await offerCharacters(actor, runId, [{ characterId, roles: [role] }]);
  return signupId!;
}
