import { runController } from "@/controllers/app.controller";
import { PageHeader } from "@/components/ui/primitives";
import { RunCreationForm } from "@/components/runs/run-creation-form";

export default async function CreateRunPage() {
  const form = await runController.getCreateRunsPage();
  return (
    <div>
      <PageHeader
        title="Create Run"
        description="Schedule a new boosting run. Create one draft or several at once — every run starts as a draft with signups closed, ready to open individually when it's time."
      />
      <RunCreationForm form={form} />
    </div>
  );
}
