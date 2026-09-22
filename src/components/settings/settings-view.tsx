import { PageHeader } from "@/components/ui/primitives";
import { NotificationSettingsCard } from "@/components/settings/notification-settings-card";
import type { settingsService } from "@/services/settings.service";

type Settings = Awaited<ReturnType<typeof settingsService.getSettings>>;

export function SettingsView({ data }: { data: Settings }) {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage your BoostingHub preferences."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <NotificationSettingsCard preferences={data.notifications} />
      </div>
    </div>
  );
}
