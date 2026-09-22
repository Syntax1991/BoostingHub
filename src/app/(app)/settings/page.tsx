import { settingsController } from "@/controllers/app.controller";
import { SettingsView } from "@/components/settings/settings-view";

export default async function SettingsPage() {
  const data = await settingsController.getSettingsPage();
  return <SettingsView data={data} />;
}
