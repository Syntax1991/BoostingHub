import { managementController } from "@/controllers/app.controller";
import { BoosterAccessQueueView } from "@/components/manage/booster-access-queue-view";

export default async function ManageBoosterAccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    difficulty?: string | string[];
    role?: string | string[];
    query?: string | string[];
    userId?: string | string[];
  }>;
}) {
  const data = await managementController.getBoosterAccessPage(await searchParams);
  return <BoosterAccessQueueView data={data} />;
}
