import { runController, settingsController } from "@/controllers/app.controller";
import { RunsView } from "@/components/runs/runs-view";
import { requireUser } from "@/auth/session";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ difficulty?: string | string[]; status?: string | string[]; id?: string | string[] }>;
}) {
  const user = await requireUser();
  const [data, timeZone] = await Promise.all([
    runController.getRunsPage(await searchParams),
    settingsController.getTimeZone(user.id),
  ]);
  return <RunsView data={data} timeZone={timeZone} />;
}
