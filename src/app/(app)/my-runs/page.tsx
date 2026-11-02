import { settingsController, signupController } from "@/controllers/app.controller";
import { MyRunsView } from "@/components/my-runs/my-runs-view";
import { requireUser } from "@/auth/session";

export default async function MyRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const user = await requireUser();
  const [data, timeZone] = await Promise.all([
    signupController.getMyRunsPage(await searchParams),
    settingsController.getTimeZone(user.id),
  ]);
  return <MyRunsView data={data} timeZone={timeZone} />;
}
