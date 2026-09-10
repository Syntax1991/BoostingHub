import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { managementController } from "@/controllers/app.controller";
import { ManageUserDetailView } from "@/components/manage/manage-user-detail-view";

export default async function ManageUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  let data: Awaited<ReturnType<typeof managementController.getUserDetailPage>>;
  try {
    data = await managementController.getUserDetailPage(userId);
  } catch (error) {
    if (isDomainError(error) && error.code === "USER_NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  return <ManageUserDetailView data={data} />;
}
