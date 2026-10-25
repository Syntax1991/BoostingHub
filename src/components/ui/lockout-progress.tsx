import { cn } from "@/lib/cn";
import {
  projectCurrentRaidLockoutSlots,
  shortRaidLockoutLabel,
  type CurrentLockoutRaidDescriptor,
  type LockoutDisplayRow,
  type RaidLockoutSlot,
} from "@/lib/lockout-display";
import type { RaidDifficulty } from "@/models/enums";

const TRACKED: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];

const DIFF_MARK: Record<RaidDifficulty, string> = {
  NORMAL: "N",
  HEROIC: "H",
  MYTHIC: "M",
};

const DIFF_FULL: Record<RaidDifficulty, string> = {
  NORMAL: "Normal",
  HEROIC: "Heroic",
  MYTHIC: "Mythic",
};

/** Compact colored N/H/M marks — alignment only; not lockout state. */
const DIFF_MARK_CLASS: Record<RaidDifficulty, string> = {
  NORMAL: "bg-success/20 text-success ring-success/35",
  HEROIC: "bg-info/20 text-info ring-info/35",
  MYTHIC: "bg-mythic/20 text-mythic ring-mythic/40",
};

/**
 * Raid Hub–style lockout strip: raid name + N/H/M boss dots.
 *
 * Authoritative BoostingHub semantics (see docs/features/character-lockout-dot-semantics.md):
 * - gray: not killed (Available) OR unverified difficulty/raid (Unknown) — never invent kills
 * - green: killed and difficulty `isComplete === false` (Saved progress)
 * - red: killed and difficulty `isComplete === true` (full save)
 *
 * Do not print "Unknown" in the normal view; it belongs in the tooltip only.
 */
export function LockoutProgress({
  slots,
  showRaidName = true,
  layout = "stack",
  nameMode = "full",
  className,
}: {
  slots: RaidLockoutSlot[];
  showRaidName?: boolean;
  /** `rail` = horizontal raids; `stack` = vertical. */
  layout?: "stack" | "rail";
  /** `short` = dense admin labels (Venomous / Tide / Kith'ix). */
  nameMode?: "full" | "short";
  className?: string;
}) {
  if (slots.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        layout === "rail"
          ? "grid items-start gap-x-3"
          : "flex flex-col gap-3",
        className,
      )}
      style={
        layout === "rail"
          ? { gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {slots.map((slot) => (
        <RaidColumn
          key={slot.raidId}
          slot={slot}
          showRaidName={showRaidName}
          nameMode={nameMode}
        />
      ))}
    </div>
  );
}

/** Convenience for Character list rows that still hold raw display rows. */
export function LockoutProgressFromRows({
  rows,
  currentRaids,
  showRaidName = true,
  layout = "stack",
  className,
}: {
  rows: LockoutDisplayRow[];
  currentRaids: readonly CurrentLockoutRaidDescriptor[];
  showRaidName?: boolean;
  layout?: "stack" | "rail";
  className?: string;
}) {
  const slots = projectCurrentRaidLockoutSlots(rows, currentRaids);
  return (
    <LockoutProgress slots={slots} showRaidName={showRaidName} layout={layout} className={className} />
  );
}

/** Fixed title + N/H/M row tracks so Venomous / Tide / Kith'ix share one vertical rhythm. */
const RAID_COLUMN_ROWS = "1rem repeat(3, 1rem)";
const RAID_COLUMN_GAP = "3px";

function RaidColumn({
  slot,
  showRaidName,
  nameMode = "full",
}: {
  slot: RaidLockoutSlot;
  showRaidName: boolean;
  nameMode?: "full" | "short";
}) {
  const label =
    nameMode === "short" ? shortRaidLockoutLabel(slot.raidId, slot.raidName) : slot.raidName;
  return (
    <div
      className="grid min-w-0 content-start"
      style={{
        gridTemplateRows: showRaidName ? RAID_COLUMN_ROWS : "repeat(3, 1rem)",
        gap: RAID_COLUMN_GAP,
      }}
    >
      {showRaidName ? (
        <p
          className="truncate text-[11px] font-medium leading-4 text-foreground/70"
          title={slot.raidName}
        >
          {label}
        </p>
      ) : null}
      {TRACKED.map((difficulty) => (
        <DifficultyDots
          key={difficulty}
          difficulty={difficulty}
          bosses={slot.bosses}
          row={
            slot.status === "VERIFIED"
              ? (slot.rows.find((item) => item.difficulty === difficulty) ?? null)
              : null
          }
        />
      ))}
    </div>
  );
}

type DotState = "available" | "saved" | "fully_saved" | "unknown";

function DifficultyDots({
  difficulty,
  bosses,
  row,
}: {
  difficulty: RaidDifficulty;
  bosses: readonly { name: string }[];
  row: LockoutDisplayRow | null;
}) {
  const mark = DIFF_MARK[difficulty];
  const difficultyLabel = DIFF_FULL[difficulty];
  const complete = Boolean(row?.isComplete);
  const states = row?.bossStates ?? null;

  // Prefer authoritative per-boss states; else catalog names with count fill; else catalog-only Unknown.
  const dots: Array<{ name: string; state: DotState }> = (() => {
    if (states && states.length > 0) {
      return states.map((boss) => ({
        name: boss.name,
        state: boss.killed
          ? (complete ? ("fully_saved" as const) : ("saved" as const))
          : ("available" as const),
      }));
    }
    if (row && bosses.length > 0) {
      const total = bosses.length;
      const filled = Math.min(Math.max(0, row.bossesDefeated), total);
      return bosses.map((boss, index) => ({
        name: boss.name,
        state:
          index < filled
            ? complete
              ? ("fully_saved" as const)
              : ("saved" as const)
            : ("available" as const),
      }));
    }
    // Unverified difficulty/raid — neutral gray catalog dots (or empty if no bosses).
    return bosses.map((boss) => ({ name: boss.name, state: "unknown" as const }));
  })();

  return (
    <span className="inline-flex h-4 min-w-0 items-center gap-1.5 leading-none">
      <span
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none ring-1",
          DIFF_MARK_CLASS[difficulty],
        )}
        aria-hidden
      >
        {mark}
      </span>
      {dots.length > 0 ? (
        <span className="inline-flex min-w-0 flex-nowrap items-center gap-[3px] overflow-hidden">
          {dots.map((dot) => {
            const title = `${dot.name}\n${difficultyLabel}\n${stateLabel(dot.state)}`;
            return (
              <span
                key={`${difficulty}-${dot.name}`}
                tabIndex={0}
                title={title}
                aria-label={`${dot.name}, ${difficultyLabel}, ${stateLabel(dot.state)}`}
                className={cn(
                  // ~7px diameter — readable without growing the lockout subrow
                  "inline-block h-[7px] w-[7px] shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-accent",
                  dotClass(dot.state),
                )}
              />
            );
          })}
        </span>
      ) : (
        <span
          className="text-[10px] leading-none text-muted/50"
          title={`${difficultyLabel}\nUnknown`}
          aria-label={`${difficultyLabel}, Unknown`}
        >
          —
        </span>
      )}
    </span>
  );
}

function stateLabel(state: DotState): string {
  switch (state) {
    case "available":
      return "Available";
    case "saved":
      return "Saved";
    case "fully_saved":
      return "Saved";
    case "unknown":
      return "Unknown";
  }
}

function dotClass(state: DotState): string {
  switch (state) {
    case "saved":
      return "bg-success";
    case "fully_saved":
      return "bg-danger";
    case "available":
      return "bg-foreground/35";
    case "unknown":
      return "bg-foreground/28";
  }
}
