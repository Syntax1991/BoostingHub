import { characterController } from "@/controllers/app.controller";
import { CharacterDetailsView } from "@/components/characters/character-details-view";
import { PageHeader } from "@/components/ui/primitives";
import { isDomainError } from "@/lib/errors";
import type { characterService } from "@/services/character.service";

export default async function CharacterDetailsPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  let data: Awaited<ReturnType<typeof characterService.getCharacterDetails>>;

  try {
    data = await characterController.getCharacterDetailsPage(characterId);
  } catch (error) {
    if (isDomainError(error) && (error.code === "CHARACTER_NOT_FOUND" || error.code === "CHARACTER_NOT_OWNED")) {
      return (
        <div>
          <PageHeader
            title="Character not available"
            description="That character does not exist or belongs to another account."
          />
        </div>
      );
    }
    throw error;
  }

  return <CharacterDetailsView data={data} />;
}
