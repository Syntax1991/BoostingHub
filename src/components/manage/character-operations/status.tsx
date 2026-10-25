import { Badge } from "@/components/ui/badges";
import { LockoutProgress } from "@/components/ui/lockout-progress";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { cn } from "@/lib/cn";
import type { CharacterLinkageState, CharacterSyncHealth } from "@/lib/blizzard/sync-health";
import type { RaidLockoutSlot } from "@/lib/lockout-display";

/**
 * Presentation only — every state here is derived server-side by the sync
 * health domain (character-operations.service); components never re-derive.
 */
const HEALTH_COPY: Record<CharacterSyncHealth, { label: string; className: string }> = {
  HEALTHY: { label: "Healthy", className: "bg-success/15 text-success" },
  STALE: { label: "Stale", className: "bg-warning/15 text-warning" },
  ERROR: { label: "Error", className: "bg-danger/15 text-danger" },
  NEVER_SYNCED: { label: "Never synced", className: "bg-info/15 text-info" },
};

const LINKAGE_COPY: Record<CharacterLinkageState, { label: string; className: string }> = {
  LINKED: { label: "Linked", className: "bg-success/10 text-success" },
  NOT_LINKED: { label: "Public API", className: "bg-info/15 text-info" },
  NO_CONNECTION: { label: "Public API", className: "bg-info/15 text-info" },
};

export function SyncHealthBadge({ health, retired }: { health: CharacterSyncHealth | null; retired: boolean }) {
  if (retired) return <Badge className="bg-muted/20 text-muted">Retired</Badge>;
  if (!health) return <span className="text-xs text-muted">—</span>;
  const copy = HEALTH_COPY[health];
  return <Badge className={copy.className}>{copy.label}</Badge>;
}

export function LinkageBadge({ linkage }: { linkage: CharacterLinkageState }) {
  const copy = LINKAGE_COPY[linkage];
  return (
    <span
      title={
        linkage === "NOT_LINKED"
          ? "Manually added — synced from the public Blizzard API (item level + lockouts). Ownership not verified via Battle.net."
          : linkage === "NO_CONNECTION"
            ? "Owner has no Battle.net connection for this region — synced from the public Blizzard API, ownership not re-verified."
            : "Linked via the owner's Battle.net login (verified ownership)."
      }
    >
      <Badge className={copy.className}>{copy.label}</Badge>
    </span>
  );
}

export function StatusBadge({ retired }: { retired: boolean }) {
  return retired ? (
    <Badge className="bg-muted/20 text-muted">Retired</Badge>
  ) : (
    <Badge className="bg-success/10 text-success">Active</Badge>
  );
}

/** Sub-minute (incl. tiny clock skew between write and render) reads "just now", never "in 0m". */
function relativeLabel(value: string, now = new Date()): string {
  return Math.abs(now.getTime() - new Date(value).getTime()) < 60_000 ? "just now" : formatRelative(value, now);
}

/** "Never" or a relative time, with the exact timestamp on hover. */
export function Timestamp({ value, never = "Never" }: { value: string | null; never?: string }) {
  if (!value) return <span className="text-muted">{never}</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)} className="whitespace-nowrap">
      {relativeLabel(value)}
    </time>
  );
}

/**
 * Dense admin lockout cell — horizontal raid rail with short names.
 * Personal Characters page keeps the stacked `LockoutProgress` layout.
 */
export function LockoutSlotsCompact({ slots }: { slots: RaidLockoutSlot[] }) {
  return <LockoutProgress slots={slots} layout="rail" nameMode="short" className="min-w-[14rem]" />;
}

export function SummaryStat({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger" | "info";
  href?: string;
}) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          value > 0 && tone === "success" && "text-success",
          value > 0 && tone === "warning" && "text-warning",
          value > 0 && tone === "danger" && "text-danger",
          value > 0 && tone === "info" && "text-info",
        )}
      >
        {value}
      </div>
    </>
  );
  const className = "rounded-md border border-border bg-surface px-3 py-2";
  return href ? (
    <a href={href} className={cn(className, "hover:bg-surface-raised")}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}
