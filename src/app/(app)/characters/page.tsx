import { characterController } from "@/controllers/app.controller";
import { CharactersView } from "@/components/characters/characters-view";

export default async function CharactersPage() {
  const data = await characterController.getCharactersPage();
  return <CharactersView data={data} />;
}
