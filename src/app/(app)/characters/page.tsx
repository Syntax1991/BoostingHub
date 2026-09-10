import { characterController } from "@/controllers/app.controller";
import { CharactersView } from "@/components/characters/characters-view";

export default async function CharactersPage({
  searchParams,
}: {
  searchParams: Promise<{
    importSession?: string | string[];
    battlenet?: string | string[];
    region?: string | string[];
    code?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const data = await characterController.getCharactersPage(params);
  return <CharactersView data={data} />;
}
