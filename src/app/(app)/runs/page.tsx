import { runController } from "@/controllers/app.controller";
import { RunsView } from "@/components/runs/runs-view";
import { requireUser } from "@/auth/session";
import { settingsRepository } from "@/repositories/settings.repository";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ difficulty?: string | string[]; status?: string | string[] }>;
}) {
  const user = await requireUser();
  const [data, timeZone] = await Promise.all([
    runController.getRunsPage(await searchParams),
    settingsRepository.getTimeZone(user.id),
  ]);
  return <RunsView data={data} timeZone={timeZone} />;
}
