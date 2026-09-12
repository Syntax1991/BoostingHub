import { managementController } from "@/controllers/app.controller";
import { PageHeader } from "@/components/ui/primitives";
import { RunCreateManyForm } from "@/components/runs/run-create-many-form";

export default async function CreateManyRunsPage() {
  const form = await managementController.getCreateManyRunsPage();
  return (
    <div>
      <PageHeader
        title="Create Many Runs"
        description="Set shared defaults, add one row per concrete run, then submit once. Every run starts as a draft with signups closed — open each one individually when it's ready."
      />
      <RunCreateManyForm form={form} />
    </div>
  );
}
