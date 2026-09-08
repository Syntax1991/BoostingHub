import Link from "next/link";
import { managementController } from "@/controllers/app.controller";
import { RosterBuilderView } from "@/components/manage/roster-builder";
import { PageHeader } from "@/components/ui/primitives";
import { RosterUnavailable } from "@/components/manage/manage-views";
import { isDomainError } from "@/lib/errors";
import type { rosterService } from "@/services/roster.service";

export default async function ManageRosterPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  let data: Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;
  try {
    data = await managementController.getRosterPage(runId);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") {
      return <RosterUnavailable title="Run not found" description="That run does not exist." />;
    }
    if (isDomainError(error) && error.code === "RUN_NOT_MANAGEABLE") {
      return (
        <RosterUnavailable
          title="Not authorized"
          description="Raid leads can only roster runs they are assigned to. Admins can roster any run."
        />
      );
    }
    throw error;
  }

  return (
    <div>
      <PageHeader
        title="Roster"
        description="Draft selection is saved independently of final signup status until you publish."
        actions={
          <Link href="/manage/runs" className="text-sm text-accent hover:underline">
            All runs
          </Link>
        }
      />
      <RosterBuilderView data={data} />
    </div>
  );
}
