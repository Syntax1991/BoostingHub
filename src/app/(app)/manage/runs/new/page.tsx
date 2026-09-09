import { managementController } from "@/controllers/app.controller";
import { PageHeader } from "@/components/ui/primitives";
import { RunCreateForm } from "@/components/runs/run-create-form";

export default async function CreateRunPage() {
  const form = await managementController.getCreateRunPage();
  return (
    <div>
      <PageHeader
        title="Create Run"
        description="New runs start as drafts with signups closed. Review the configuration, then open the run from its page."
      />
      <RunCreateForm form={form} />
    </div>
  );
}
