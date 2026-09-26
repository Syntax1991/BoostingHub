import { managementController } from "@/controllers/app.controller";
import { ManageCharactersView } from "@/components/manage/manage-characters-view";

export default async function ManageCharactersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data = await managementController.getCharactersPage(await searchParams);
  return <ManageCharactersView data={data} />;
}
