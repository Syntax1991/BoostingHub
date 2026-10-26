import { signupController } from "@/controllers/app.controller";
import { MyRunsView } from "@/components/my-runs/my-runs-view";
import { requireUser } from "@/auth/session";
import { settingsRepository } from "@/repositories/settings.repository";

export default async function MyRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const user = await requireUser();
  const [data, timeZone] = await Promise.all([
    signupController.getMyRunsPage(await searchParams),
    settingsRepository.getTimeZone(user.id),
  ]);
  return <MyRunsView data={data} timeZone={timeZone} />;
}
