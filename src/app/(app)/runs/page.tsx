import { runController } from "@/controllers/app.controller";
import { RunsView } from "@/components/runs/runs-view";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ difficulty?: string | string[]; status?: string | string[] }>;
}) {
  const data = await runController.getRunsPage(await searchParams);
  return <RunsView data={data} />;
}
