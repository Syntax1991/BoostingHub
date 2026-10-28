import {
  ArrowLeftRight,
  Ban,
  Check,
  CheckCircle2,
  DoorOpen,
  FilePenLine,
  Lock,
  PlayCircle,
  Send,
  TriangleAlert,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { getLootbuddyMedia, getRoleMedia } from "@/lib/wow-role-media";
import type { CharacterRole, RunStatus } from "@/models/enums";

/** Shared stroke for operational status line icons (not game role media). */
export const OPS_ICON_STROKE = 1.75;
/** Default optical size for status glyphs. */
export const OPS_ICON_SIZE = 16;
/** Role / class identity icons on Signup tiles. */
/** Characters / roster optical box — Blizzard art at ~18–20px. */
export const ROLE_ICON_SIZE = 18;

type OpsIconTone = "muted" | "warning" | "danger" | "success" | "inherit";

const TONE_CLASS: Record<OpsIconTone, string> = {
  muted: "text-muted",
  warning: "text-warning",
  danger: "text-danger",
  success: "text-success",
  inherit: "",
};

function OpsGlyph({
  icon: Icon,
  label,
  size = OPS_ICON_SIZE,
  tone = "muted",
  className,
}: {
  icon: typeof Check;
  label: string;
  size?: number;
  tone?: OpsIconTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        TONE_CLASS[tone],
        className,
      )}
      style={{ width: size, height: size }}
      title={label}
      aria-label={label}
    >
      <Icon
        aria-hidden
        strokeWidth={OPS_ICON_STROKE}
        style={{ width: size, height: size }}
        className="block"
      />
    </span>
  );
}

/**
 * Shared Blizzard LFG role icon (static `/media/roles/*` from client atlas).
 * Melee/Ranged share Blizzard DAMAGE art; distinction stays in aria-label only
 * (no invented Melee/Ranged glyphs, no M/R chrome badge).
 */
export function RoleIcon({
  role,
  size = ROLE_ICON_SIZE,
  className,
}: {
  role: CharacterRole;
  size?: number;
  className?: string;
}) {
  const media = getRoleMedia(role);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      title={media.label}
      aria-label={media.label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local static Blizzard-derived PNG */}
      <img
        src={media.iconSrc}
        alt=""
        width={size}
        height={size}
        className="block h-full w-full object-contain"
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}

/** Lootbuddy participation mark — static `/media/roles/loot.webp`. */
export function LootbuddyIcon({
  size = ROLE_ICON_SIZE,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const media = getLootbuddyMedia();
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      title={media.label}
      aria-label={media.label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local static role media */}
      <img
        src={media.iconSrc}
        alt=""
        width={size}
        height={size}
        className="block h-full w-full object-contain"
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}

/** Soft draft / success mark (selected in draft roster). */
export function DraftCheckIcon({ className, size = OPS_ICON_SIZE }: { className?: string; size?: number }) {
  return <OpsGlyph icon={Check} label="In draft" size={size} tone="success" className={className} />;
}

/** Quiet healthy / OK mark — muted, not decorative success chrome. */
export function QuietOkIcon({
  label = "OK",
  className,
  size = OPS_ICON_SIZE,
}: {
  label?: string;
  className?: string;
  size?: number;
}) {
  return <OpsGlyph icon={Check} label={label} size={size} tone="muted" className={className} />;
}

/** Soft warning (lockout attention, soft risk). */
export function WarningIcon({
  label = "Needs attention",
  className,
  size = OPS_ICON_SIZE,
}: {
  label?: string;
  className?: string;
  size?: number;
}) {
  return <OpsGlyph icon={TriangleAlert} label={label} size={size} tone="warning" className={className} />;
}

/** Hard blocker / error. */
export function BlockerIcon({
  label = "Blocked",
  className,
  size = OPS_ICON_SIZE,
}: {
  label?: string;
  className?: string;
  size?: number;
}) {
  return <OpsGlyph icon={X} label={label} size={size} tone="danger" className={className} />;
}

/** Swap a roster slot for another signup (Find replacement). */
export function ReplaceIcon({
  label = "Find replacement",
  className,
  size = OPS_ICON_SIZE,
}: {
  label?: string;
  className?: string;
  size?: number;
}) {
  return <OpsGlyph icon={ArrowLeftRight} label={label} size={size} tone="inherit" className={className} />;
}

/** Saved / lockout progress indicator (quiet unless attention). */
export function LockoutIcon({
  attention = false,
  label = "Lockout",
  className,
  size = OPS_ICON_SIZE,
}: {
  attention?: boolean;
  label?: string;
  className?: string;
  size?: number;
}) {
  return (
    <OpsGlyph
      icon={Lock}
      label={label}
      size={size}
      tone={attention ? "warning" : "muted"}
      className={className}
    />
  );
}

/** Buff coverage present. */
export function BuffCoveredIcon({ className, size = 14 }: { className?: string; size?: number }) {
  return <OpsGlyph icon={Check} label="Covered" size={size} tone="muted" className={className} />;
}

/** Buff coverage missing. */
export function BuffMissingIcon({ className, size = 14 }: { className?: string; size?: number }) {
  return <OpsGlyph icon={X} label="Missing" size={size} tone="danger" className={className} />;
}

/** Lucide glyph for each Run lifecycle status — paired with short labels in RunStatusBadge. */
export const RUN_STATUS_ICONS: Record<RunStatus, LucideIcon> = {
  DRAFT: FilePenLine,
  OPEN: DoorOpen,
  ROSTERING: UsersRound,
  PUBLISHED: Send,
  IN_PROGRESS: PlayCircle,
  COMPLETED: CheckCircle2,
  CANCELLED: Ban,
};

export function RunStatusGlyph({
  status,
  size = 12,
  className,
}: {
  status: RunStatus;
  size?: number;
  className?: string;
}) {
  const Icon = RUN_STATUS_ICONS[status];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon
        aria-hidden
        strokeWidth={OPS_ICON_STROKE}
        style={{ width: size, height: size }}
        className="block"
      />
    </span>
  );
}
