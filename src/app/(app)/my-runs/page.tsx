import { signupController } from "@/controllers/app.controller";
import { MyRunsView } from "@/components/my-runs/my-runs-view";

export default async function MyRunsPage() {
  const data = await signupController.getMyRunsPage();
  return <MyRunsView data={data} />;
}
