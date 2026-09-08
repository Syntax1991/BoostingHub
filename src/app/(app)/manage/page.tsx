import { requireManagerOrRedirect } from "@/auth/session";
import { ManageHomeView } from "@/components/manage/manage-views";

export default async function ManagePage() {
  await requireManagerOrRedirect();
  return <ManageHomeView />;
}
