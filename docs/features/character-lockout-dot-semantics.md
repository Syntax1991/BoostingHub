# Character lockout boss-dot semantics

Authoritative mapping for the Characters (and shared `LockoutProgress`) boss-dot UI.
Presentation only — does not change Blizzard sync or lockout derivation.

## Source of truth

| Field | Meaning |
| --- | --- |
| `CharacterRaidLockout` row for this Character × Raid × Difficulty × regional reset | Difficulty is **verified** |
| No row for that difficulty / raid this reset | **Unknown** — never invent `0/N` kills |
| `killedBossIds` + catalog `RaidBoss` (`sortOrder`) | Which bosses are killed |
| `isComplete` | Difficulty is a **full save** (character locked out of that difficulty) |

## Dot visual state

One dot = one catalog `RaidBoss` in `sortOrder`. Dot size/spacing is constant; only color changes.

| Visual | Condition | Tooltip state |
| --- | --- | --- |
| **Gray** | Boss not killed, **or** difficulty/raid unverified (Unknown) | `Available` when verified empty; `Unknown` when unverified |
| **Green** | Boss killed and `isComplete === false` | `Saved` |
| **Red** | Boss killed and `isComplete === true` | `Saved` |

Blizzard’s group role model is irrelevant here. Raid Hub’s colors are a visual reference only; BoostingHub does **not** copy Raid Hub’s product meaning.

## Tooltip

Every focusable/hoverable dot:

1. Boss name (catalog)
2. Difficulty label (`Normal` / `Heroic` / `Mythic`)
3. Exact state (`Available` / `Saved` / `Unknown`)

## Unknown in the list view

Do **not** print the word “Unknown” in the normal Characters lockout subrow.
Unverified raids/difficulties still render catalog-shaped gray dots; `Unknown` appears only in the tooltip.
