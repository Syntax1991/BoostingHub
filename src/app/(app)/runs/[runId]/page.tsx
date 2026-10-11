import { runController } from "@/controllers/app.controller";
import { RunDetailView } from "@/components/runs/run-detail-view";
import { PageHeader } from "@/components/ui/primitives";
import { isDomainError } from "@/lib/errors";
import { parseRunDetailTab } from "@/lib/run-routes";
import type { runDetailService } from "@/services/run-detail.service";
import { requireUser } from "@/auth/session";
import { settingsRepository } from "@/repositories/settings.repository";

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { runId } = await params;
  const query = await searchParams;
  const initialTab = parseRunDetailTab(query.tab);
  let data: Awaited<ReturnType<typeof runDetailService.getRunDetail>>;

  try {
    data = await runController.getRunDetailPage(runId);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") {
      return (
        <div>
          <PageHeader title="Run not found" description="That run does not exist." />
        </div>
      );
    }
    throw error;
  }

  const timeZone = await settingsRepository.getTimeZone((await requireUser()).id);
  return <RunDetailView data={data} initialTab={initialTab} timeZone={timeZone} />;
}
