import Link from "next/link";
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

type LifecycleRaid = {
  archived: boolean;
  duplicateOf: { id: string; name: string } | null;
};

/** One-line lifecycle state of a raid list row: Archived / Duplicate (nothing when in the catalog). */
export function RaidLifecycleBadge({ raid }: { raid: LifecycleRaid }) {
  if (raid.duplicateOf) return <Badge tone="warn">Duplicate</Badge>;
  if (raid.archived) return <Badge tone="off">Archived</Badge>;
  return null;
}

/** Raid detail: why an archived or duplicate raid looks the way it does. */
export function RaidLifecycleNotice({
  raid,
  className,
}: {
  raid: LifecycleRaid;
  className?: string;
}) {
  if (!raid.duplicateOf && !raid.archived) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        raid.duplicateOf ? "border-warning/40 bg-warning/10" : "border-border bg-surface-raised",
        className,
      )}
    >
      {raid.duplicateOf ? (
        <>
          Duplicate of{" "}
          <Link
            href={`/manage/raid-catalog/raids/${raid.duplicateOf.id}`}
            className="font-medium underline"
          >
            {raid.duplicateOf.name}
          </Link>{" "}
          (same Blizzard instance). Remove the duplicate to keep one raid.
        </>
      ) : (
        "Archived: kept for existing Runs, lockouts and Warcraft Logs, but not offered for new Runs, Run Setups or Products."
      )}
    </p>
  );
}
