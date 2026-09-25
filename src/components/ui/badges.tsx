import { cn } from "@/lib/cn";
import { wowClassIconUrl } from "@/lib/wow-class-icons";
import {
  ACCESS_STATUS_LABELS,
  ATTENDANCE_STATUS_LABELS,
  CHARACTER_ROLE_LABELS,
  CLASS_COLORS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
  PARTICIPATION_LABELS,
  ROLE_LABELS,
  RUN_STATUS_LABELS,
  SETTLEMENT_STATUS_LABELS,
  SIGNUP_STATUS_LABELS,
} from "@/lib/labels";
import type {
  AccountRole,
  AttendanceStatus,
  BoosterAccessStatus,
  BoosterQualificationStatus,
  CharacterRole,
  ParticipationType,
  RaidDifficulty,
  RunStatus,
  SettlementStatus,
  SignupStatus,
  WowClass,
} from "@/models/enums";

export function Badge({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function DifficultyBadge({ difficulty }: { difficulty: RaidDifficulty }) {
  return (
    <Badge
      className={cn(
        difficulty === "MYTHIC" && "bg-[#5b2a73] text-[#efd4ff]",
        difficulty === "HEROIC" && "bg-[#3d4f1f] text-[#d4e89a]",
        difficulty === "NORMAL" && "bg-[#2b3d5a] text-[#c5d7f5]",
      )}
    >
      {DIFFICULTY_LABELS[difficulty]}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge
      className={cn(
        status === "OPEN" && "bg-success/15 text-success",
        status === "ROSTERING" && "bg-warning/15 text-warning",
        status === "PUBLISHED" && "bg-info/15 text-info",
        status === "IN_PROGRESS" && "bg-accent/15 text-accent",
        status === "DRAFT" && "bg-muted/15 text-muted",
        status === "COMPLETED" && "bg-muted/20 text-muted",
        status === "CANCELLED" && "bg-danger/15 text-danger",
      )}
    >
      {RUN_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SignupStatusBadge({ status }: { status: SignupStatus }) {
  return (
    <Badge
      className={cn(
        status === "SELECTED" && "bg-success/15 text-success",
        status === "PENDING" && "bg-warning/15 text-warning",
        status === "NOT_SELECTED" && "bg-danger/15 text-danger",
        status === "WITHDRAWN" && "bg-muted/15 text-muted",
      )}
    >
      {SIGNUP_STATUS_LABELS[status]}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: CharacterRole }) {
  return (
    <Badge
      className={cn(
        role === "TANK" && "bg-[#2c4d7a] text-[#cfe2ff]",
        role === "HEALER" && "bg-[#2f6a4a] text-[#c8f0d8]",
        role === "DPS" && "bg-[#6a3a2f] text-[#f3d0c6]",
      )}
    >
      {CHARACTER_ROLE_LABELS[role]}
    </Badge>
  );
}

/** Every role a booster offer volunteers for. Renders nothing for a lootbuddy entry. */
export function OfferedRolesBadges({ roles }: { roles: readonly CharacterRole[] }) {
  return (
    <>
      {roles.map((role) => (
        <RoleBadge key={role} role={role} />
      ))}
    </>
  );
}

export function ClassBadge({ wowClass }: { wowClass: WowClass }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <ClassIcon wowClass={wowClass} size={16} />
      <span style={{ color: CLASS_COLORS[wowClass] }}>{CLASS_LABELS[wowClass]}</span>
    </span>
  );
}

/** Square WoW class icon from the public icon CDN. */
export function ClassIcon({
  wowClass,
  size = 20,
  className,
}: {
  wowClass: WowClass;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small external CDN asset; next/image not worth the remotePatterns churn
    <img
      src={wowClassIconUrl(wowClass)}
      alt=""
      width={size}
      height={size}
      className={cn("inline-block shrink-0 rounded-sm", className)}
      style={{ width: size, height: size }}
      loading="lazy"
      decoding="async"
    />
  );
}

export function ParticipationBadge({ type }: { type: ParticipationType }) {
  return (
    <Badge className={type === "BOOSTER" ? "bg-accent/15 text-accent" : "bg-info/15 text-info"}>
      {PARTICIPATION_LABELS[type]}
    </Badge>
  );
}

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <Badge
      className={cn(
        status === "UNMARKED" && "bg-warning/15 text-warning",
        status === "PRESENT" && "bg-success/15 text-success",
        status === "LATE" && "bg-info/15 text-info",
        status === "LEFT_EARLY" && "bg-info/15 text-info",
        status === "NO_SHOW" && "bg-danger/15 text-danger",
        status === "EXCUSED" && "bg-muted/20 text-muted",
        status === "STANDBY" && "bg-accent/15 text-accent",
      )}
    >
      {ATTENDANCE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SettlementStatusBadge({ status }: { status: SettlementStatus }) {
  return (
    <Badge
      className={cn(
        status === "DRAFT" && "bg-warning/15 text-warning",
        status === "FINALIZED" && "bg-info/15 text-info",
        status === "PAID" && "bg-success/15 text-success",
      )}
    >
      {SETTLEMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function AccessBadge({ status }: { status: BoosterAccessStatus | BoosterQualificationStatus }) {
  return (
    <Badge
      className={cn(
        status === "APPROVED" && "bg-success/15 text-success",
        status === "PENDING" && "bg-warning/15 text-warning",
        status === "REJECTED" && "bg-danger/15 text-danger",
        status === "REVOKED" && "bg-muted/20 text-muted",
      )}
    >
      {ACCESS_STATUS_LABELS[status as BoosterAccessStatus]}
    </Badge>
  );
}

export function AccountRoleBadge({ role }: { role: AccountRole }) {
  return (
    <Badge
      className={cn(
        role === "OWNER" && "bg-warning/15 text-warning",
        role === "ADMIN" && "bg-accent/15 text-accent",
        role === "RAID_LEAD" && "bg-info/15 text-info",
        role === "USER" && "bg-muted/20 text-muted",
      )}
    >
      {ROLE_LABELS[role]}
    </Badge>
  );
}
