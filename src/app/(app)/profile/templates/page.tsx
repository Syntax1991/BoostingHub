import { profileController } from "@/controllers/app.controller";
import { MyTemplatesView } from "@/components/templates/my-templates-view";

export default async function MyTemplatesPage() {
  const data = await profileController.getMyTemplatesPage();
  return <MyTemplatesView data={data} />;
}
