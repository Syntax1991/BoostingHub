import { cn } from "@/lib/cn";
import type { RaidIntegrationStatus } from "@/lib/raid-catalog";

type Tone = "ok" | "warn" | "off";

function Badge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-success/15 text-success",
        tone === "warn" && "bg-warning/15 text-warning",
        tone === "off" && "bg-slate-500/15 text-muted",
      )}
    >
      {children}
    </span>
  );
}

/** Blizzard sync / boss mapping / lockouts / Warcraft Logs readiness of one raid (no raw ids). */
export function RaidStatusBadges({
  status,
  className,
}: {
  status: RaidIntegrationStatus;
  className?: string;
}) {
  const allMapped = status.bossTotal > 0 && status.bossesMapped === status.bossTotal;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      <Badge tone={status.blizzardLinked ? "ok" : "warn"}>
        {status.blizzardLinked ? "Blizzard synced" : "Not linked to Blizzard"}
      </Badge>
      <Badge
        tone={allMapped ? "ok" : "warn"}
      >{`Bosses ${status.bossesMapped}/${status.bossTotal} mapped`}</Badge>
      <Badge
        tone={
          status.lockouts === "READY" ? "ok" : status.lockouts === "INCOMPLETE" ? "warn" : "off"
        }
      >
        {status.lockouts === "READY"
          ? "Lockouts ready"
          : status.lockouts === "INCOMPLETE"
            ? "Lockouts incomplete"
            : "Lockouts not tracked"}
      </Badge>
      <Badge tone={status.warcraftLogs === "MAPPED" ? "ok" : "warn"}>
        {status.warcraftLogs === "MAPPED" ? "Warcraft Logs mapped" : "Warcraft Logs needs mapping"}
      </Badge>
    </div>
  );
}
