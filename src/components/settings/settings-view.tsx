import { PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { NotificationSettingsCard } from "@/components/settings/notification-settings-card";
import { RegionalSettingsCard } from "@/components/settings/regional-settings-card";
import { GameplaySettingsCard } from "@/components/settings/gameplay-settings-card";
import { RunChannelSettingsCard } from "@/components/settings/run-channel-settings-card";
import { ActiveSessionsSection } from "@/components/settings/active-sessions-section";
import type { PublicSessionView } from "@/auth/session-view";
import type { settingsService } from "@/services/settings.service";

type SettingsPage = Awaited<ReturnType<typeof settingsService.getSettings>> & {
  sessions: PublicSessionView[];
};

function notificationSettingsRemountKey(
  notifications: SettingsPage["notifications"],
): string {
  const n = notifications;
  return [
    n.discordDmEnabled,
    n.dmRosterSelectedEnabled,
    n.dmRaidInviteEnabled,
    n.dmRunCancelledEnabled,
    n.dmRunRescheduledEnabled,
    n.dmRosterRemovedEnabled,
    n.quietHours.enabled,
    n.quietHours.start ?? "",
    n.quietHours.end ?? "",
  ].join("|");
}

export function SettingsView({ data }: { data: SettingsPage }) {
  return (
    <PageWorkspace>
      <PageHeader
        title="Settings"
        description="Manawyrm Hub preferences."
      />
      <div className="grid gap-2 lg:grid-cols-2">
        <NotificationSettingsCard
          key={notificationSettingsRemountKey(data.notifications)}
          preferences={data.notifications}
          timeZone={data.regional.timeZone}
        />
        <RegionalSettingsCard timeZone={data.regional.timeZone} timeZones={data.timeZones} />
        <GameplaySettingsCard
          defaultCharacterId={data.gameplay.defaultCharacterId}
          characters={data.characters}
        />
        {data.runChannels.canConfigure ? (
          <RunChannelSettingsCard
            discordRunChannelNickname={data.runChannels.discordRunChannelNickname}
          />
        ) : null}
        <ActiveSessionsSection sessions={data.sessions} />
      </div>
    </PageWorkspace>
  );
}
