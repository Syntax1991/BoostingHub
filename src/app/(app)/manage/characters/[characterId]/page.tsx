import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { managementController } from "@/controllers/app.controller";
import { ManageCharacterDetailView } from "@/components/manage/manage-character-detail-view";

export default async function ManageCharacterDetailPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  let data: Awaited<ReturnType<typeof managementController.getCharacterOperationsPage>>;
  try {
    data = await managementController.getCharacterOperationsPage(characterId);
  } catch (error) {
    if (isDomainError(error) && error.code === "CHARACTER_NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  return <ManageCharacterDetailView data={data} />;
}
