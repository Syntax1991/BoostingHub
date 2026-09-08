import { cn } from "@/lib/cn";
import {
  ACCESS_STATUS_LABELS,
  CHARACTER_ROLE_LABELS,
  CLASS_COLORS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
  PARTICIPATION_LABELS,
  RUN_STATUS_LABELS,
  SIGNUP_STATUS_LABELS,
} from "@/lib/labels";
import type {
  BoosterAccessStatus,
  CharacterRole,
  ParticipationType,
  RaidDifficulty,
  RunStatus,
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

export function ClassBadge({ wowClass }: { wowClass: WowClass }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: CLASS_COLORS[wowClass] }}
      />
      <span style={{ color: CLASS_COLORS[wowClass] }}>{CLASS_LABELS[wowClass]}</span>
    </span>
  );
}

export function ParticipationBadge({ type }: { type: ParticipationType }) {
  return (
    <Badge className={type === "BOOSTER" ? "bg-accent/15 text-accent" : "bg-info/15 text-info"}>
      {PARTICIPATION_LABELS[type]}
    </Badge>
  );
}

export function AccessBadge({ status }: { status: BoosterAccessStatus }) {
  return (
    <Badge
      className={cn(
        status === "APPROVED" && "bg-success/15 text-success",
        status === "PENDING" && "bg-warning/15 text-warning",
        status === "REVOKED" && "bg-danger/15 text-danger",
      )}
    >
      {ACCESS_STATUS_LABELS[status]}
    </Badge>
  );
}
