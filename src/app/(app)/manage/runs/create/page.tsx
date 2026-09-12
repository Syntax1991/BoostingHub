import { managementController } from "@/controllers/app.controller";
import { PageHeader } from "@/components/ui/primitives";
import { RunCreationForm } from "@/components/runs/run-creation-form";

export default async function CreateRunsPage() {
  const form = await managementController.getCreateManyRunsPage();
  return (
    <div>
      <PageHeader
        title="Create Runs"
        description="Create one or multiple run drafts. Set shared defaults, then add a row for each concrete run — every run starts as a draft with signups closed, ready to open individually when it's time."
      />
      <RunCreationForm form={form} />
    </div>
  );
}
