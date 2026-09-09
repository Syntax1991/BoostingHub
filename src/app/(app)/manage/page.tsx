import { requireManagerOrRedirect } from "@/auth/session";
import { ManageHomeView } from "@/components/manage/manage-views";

export default async function ManagePage() {
  const user = await requireManagerOrRedirect();
  return <ManageHomeView accountRole={user.accountRole} />;
}
