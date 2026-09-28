# Run Consumables Audit

## Purpose

A factual post-run overview, from the Run's Warcraft Logs report, of whether each booster had a flask, used a combat potion, and — for every death — used a Healing Potion or Healthstone shortly before dying.

It shows facts and actionable warnings. There is deliberately **no score, ranking, or overall rating** of a booster.

## Access — ADMIN and RAID_LEAD only

`canViewRunConsumableAudit` / `assertCanViewRunConsumableAudit` (`src/auth/authorization.ts`) is the single rule. It is the Run-management rule (`canManageRun`), unchanged:

| Account | Access |
| --- | --- |
| ADMIN / OWNER | every Run |
| RAID_LEAD | only Runs they lead (`run.raidLeadId`) |
| USER | never — not even when listed as the Run's raid lead |

Enforcement is server-side, before any audit read or Warcraft Logs request:

- **Run detail** — `runDetailService.getRunDetail` sets `consumables` via `runConsumableAuditService.getAuditViewForRunDetail`, which returns `null` without reading the audit tables for anyone else. A USER's serialized page payload contains no audit data, heading, placeholder or controls; the **Consumables** tab only exists when `consumables` is present.
- **Reads** — `runConsumableAuditService.getAuditView` asserts access first.
- **Mutations** — `attachRunWarcraftLogsReportAction`, `rescanRunWarcraftLogsAction`, `detachRunWarcraftLogsReportAction`, `decideRunWarcraftLogsFightAction`, `analyzeRunConsumablesAction` → `runWarcraftLogsService` / `runConsumableAuditService`, which assert access before any database read of associations or the audit and before any WCL call. Unauthorized callers get the standard `NOT_AUTHORIZED` (403) result and cause no Warcraft Logs traffic.
- **Moving a fight away from another Run** additionally requires permission to manage that other Run (a Raid Lead cannot pull fights out of another lead's Run).

There is no separate audit API route; the server actions are the only mutation surface.

## Workflow

1. A Run is **COMPLETED** (the tab is only offered then). Completion records `Run.completedAt`.
2. The Admin / Raid Lead opens **Consumables** on `/runs/[runId]` and pastes the Warcraft Logs report link (or code) — **Link & analyze**.
3. The report's boss fights are assigned to Runs (below); the audit is built from this Run's **ASSIGNED** fights only.
4. **Re-scan fights** re-fetches the report (new pulls uploaded) and re-assigns; **Re-analyze** rebuilds the audit from the current assignment; **Detach** removes the report from this Run. More than one report can be linked to a Run.
5. Page loads read stored data only — rendering the Run never calls Warcraft Logs.

A 60-second cooldown per Run (`WCL_RUN_ACTION_COOLDOWN_SECONDS`) covers every WCL-triggering action and protects the shared WCL rate limit.

## Automatic linking and audit

Run IN_PROGRESS → a trusted log bot (e.g. PhoenixStar Logs) posts "started a new report <url>" in the Run's Discord channel → the Discord bot hands the link to the Bot API → the report is linked with `source = DISCORD_BOT` → Run COMPLETED → the audit runs automatically.

- **Trust**: only authors in `DISCORD_WCL_REPORT_AUTHOR_IDS`, only in the Run's own channel, only for IN_PROGRESS / COMPLETED Runs — all re-checked server-side. Details in [discord-bot.md](discord-bot.md#warcraft-logs-report-links-log-bot).
- **No assignment while running**: the Run's window closes at completion, so fights are assigned by the automatic audit.
- **Automatic audit** (`CONSUMABLE_AUTO_AUDIT_POLICY`, `autoAuditState`, `runConsumableAutoAuditService`): one pure rule decides for both the job and the Run page, from persisted timestamps only (no in-memory timers). A COMPLETED Run with a recorded `completedAt` becomes due **15 min** after completion (late uploads reach WCL first) when it has a linked report and **no successful analysis covers every linked report**. The pass re-fetches the reports, assigns fights (ambiguous ones stay in review) and analyzes the ASSIGNED fights as a system action (`autoAnalyzed`, no `analyzedBy`). Due Runs are processed earliest-due first, ≤ 3 per pass; overlapping passes are skipped by an advisory lock (`CONSUMABLE_AUTO_AUDIT_LOCK_KEY`); Runs completed more than 3 days ago are never picked up.
- **Report arrives late**: no report at +15 min means nothing is due and no attempt is spent. As soon as a report is linked (log bot, final pre-archive scan, or manually), the next pass audits it — no manual step.
- **New report after an analysis**: a report linked after the latest successful analysis (automatic or manual) makes the Run due again (`reason: NEW_REPORT`); the log-bot attach restarts the attempt budget (`resetAutoAttempts`). Re-linking the same report is a no-op. MANUAL fight decisions survive the re-scan. A manager's analysis with no newer report is never redone automatically.
- **Retries**: attempts are 15 min apart, at most **4** per report generation. Permanent failures (`REPORT_NOT_FOUND` — private/unknown report, `NOT_CONFIGURED`) stop at once; transient ones (`WCL_UNAVAILABLE`, `NO_RELEVANT_FIGHTS` — last pulls not uploaded yet, internal errors) are retried. An attempt is counted before any WCL call, so a crash can never loop.
- **Logs**: `[consumable-auto-audit] start|analyzed|failed|error { runId, reports, reason, fights, failure, retryable }` — never tokens or secrets.
- The Consumables tab shows "via Discord log bot", "Automatic analysis scheduled from …", "automatic re-analysis scheduled" (new report), "Analyzed automatically after completion", or that the automatic analysis stopped (permanent failure) / gave up after its attempts.

## Report → fight → Run association

One Warcraft Logs report often holds several consecutive BoostingHub Runs — possibly with identical `RunRaidContent` (two Venomous 8/8 Runs back to back). Raid identity alone can never decide which fights belong to which Run, so every fight is associated explicitly (`src/services/wcl-fight-assignment.ts`, pure):

1. **Time — primary.** WCL fight times are relative to the report start and are converted first: `absolute = report.startTime + fight.startTime`. A fight is a candidate when its absolute start lies in the Run's active window `[RunStartSnapshot.startedAt, Run.completedAt]` padded by `WCL_RUN_MATCH_TOLERANCE_SECONDS` (**300 s**, boundaries inclusive). The tolerance stays well below the usual gap between back-to-back boost Runs.
2. **RunRaidContent + difficulty — validation.** The encounter must belong to one of the Run's contents (catalog `warcraftLogsEncounterIds`; Bundles accept both Tidebound and Venomous encounters) at the Run's difficulty. In-window fights that fail this are **IGNORED**. Encounters the catalog does not know yet pass (time decides). Content never replaces time: two identical Runs stay separated by their windows.
3. **Roster overlap — disambiguation.** When other started Runs' windows also contain the fight (overlapping or unfinished Runs), the fight's players are compared with each Run's attendance roster (character name + realm — never display names; external boosters have no realm and never count). A Run wins only with ≥ 50 % of its roster present **and** a ≥ 30-point lead, and only when every compared Run has at least 3 identity-bearing roster members. A clear win for another Run marks the fight IGNORED here.

Wipes are fights like any other: every wipe in the window is assigned, so wipe deaths and recovery consumables are audited (the combat-potion requirement still applies to kills only — a separate rule).

### Review instead of guessing

A fight becomes **NEEDS_REVIEW** — and is never audited until a manager decides — when:

- several Runs' windows match and the roster does not clearly decide;
- the Run's completion time was not recorded (`RUN_END_UNKNOWN`; open window of up to 8 h);
- the Run has no recorded window at all (completed before start snapshots / `completedAt` existed): every content-matching fight is offered for review (`RUN_WINDOW_UNKNOWN`);
- the only matching Run's roster is barely in the fight (< 25 %);
- another Run already holds the fight.

The review list shows concrete evidence ("Time matches Run", "Encounter matches Run content", "15/16 roster members in this fight", "Matches multiple Run time windows") — never a score. **Assign to this run** / **Remove from this run** are MANUAL decisions that survive re-scans.

### Uniqueness

A `(report, fight)` pair is ASSIGNED to at most one Run — enforced by the partial unique index `run_wcl_fight_assigned_once` on `run_warcraft_logs_fight (reportId, wclFightId) WHERE status = 'ASSIGNED'`. Assigning a fight another Run holds is a **reassignment** in one transaction: the other Run's row becomes IGNORED (MANUAL). A concurrent double-assign fails on the index and rolls back.

## What is checked

Only the Run's **ASSIGNED boss fights** (kills and wipes) are audited; trash is ignored. WCL is asked for exactly those fight ids (deaths, pull snapshots); consumable casts are fetched for their time range and then attributed to those fights only, so nothing from another Run in the same report can enter the audit.

Audited players are **attended BOOSTER roster participants** (`PRESENT`, `LATE`, `LEFT_EARLY`) plus the roster's external BOOSTERs. Lootbuddies, no-shows, excused and standby rows are not audited. The role is the published roster role.

| Check | Rule | Status |
| --- | --- | --- |
| Flask | Flask aura active **at pull**, per fight (WCL CombatantInfo snapshot) | PASS if present in every snapshot; WARNING lists fights without one; UNKNOWN without snapshots |
| Combat Potion | At least one accepted potion per boss **kill** the player was in. Wipes are listed but never required; no "use every cooldown" rule | PASS / WARNING (lists kills without one) / N/A (no kills) / UNKNOWN (no roster role) |
| Healing Potion | Uses are listed | Never a failure on its own — NEUTRAL with 0 uses; WARNING only via a death |
| Healthstone | Uses are listed | Never a failure on its own — NEUTRAL / N/A when not applicable; WARNING only via a death |
| Deaths | Each death evaluated independently (below) | WARNING per missing recovery consumable |

### Combat potion by role

| Role | Accepted |
| --- | --- |
| Tank | Damage Potion |
| DPS | Damage Potion |
| Healer | Damage Potion **or** Mana Potion |

A healer never fails for choosing a Mana Potion. Mana Potions are identified by their cast, never inferred from a mana increase. Configured in `CONSUMABLE_AUDIT_POLICY.combatPotionByRole`.

A catalog cast up to 5 s before a pull (`CONSUMABLE_PRE_PULL_WINDOW_MS`) counts for that fight as a pre-pull use (shown as a negative time, e.g. `-00:02`).

## Death analysis

For every death, the audit looks for the **latest** Healing Potion and Healthstone use by that player:

- within `CONSUMABLE_AUDIT_POLICY.deathLookbackSeconds` (**30 s**) before the death,
- in the same fight,
- and after that player's previous death in the same fight (a battle-ressed player dying again is not covered by the first use).

A consumable used early in a fight never satisfies a later death. Multiple deaths — across one fight or many encounters — are listed and judged separately, each with its encounter and fight-relative time (`Ula'tek · Pull 3 (wipe) @ 03:42`).

### Healthstone applicability

Per fight, from the strongest evidence the log provides:

- **Applicable** — a Warlock took part, or anyone used a Healthstone in that fight.
- **Not applicable** — fight participants are known, no Warlock, and no Healthstone use seen. A death there shows N/A, never a warning.
- **Unknown** — WCL did not report the fight's participants. No warning.

### Why "not used before death", never "failed to use"

Warcraft Logs records what was **cast**, not what was in a player's bags. The audit therefore only states facts — "No Healing Potion use detected before death" — and never claims a consumable was available. For the same reason, a player who never died is never flagged for not using a Healing Potion or Healthstone.

### Unknown is never a failure

- **Log data unavailable** — the Character is not in the report (`NOT_IN_LOG`), or the booster has no character identity (`NO_CHARACTER_IDENTITY`: external boosters only carry a Discord name).
- **Unknown** flask — no CombatantInfo pull snapshot for that fight.

## Player matching

A Character is matched to a report actor by **name + realm within the report's region** (case-, accent-, space- and punctuation-insensitive; that is the in-game identity). A stored `Character.warcraftLogsId` found among the report's ranked characters is preferred (survives renames). Never by name alone. External boosters are never matched: their name is a Discord name with no realm.

## Data model

Normalized **facts** are persisted; PASS/WARNING/N/A/UNKNOWN is evaluated at read time (`consumable-audit-policy.ts`), so changing a rule or the lookback never needs a new Warcraft Logs fetch.

| Model | Content |
| --- | --- |
| `WarcraftLogsReport` | shared report (`code` unique): title, absolute start/end, region, cached metadata JSON (boss fights, actors, ranked characters), `fetchedAt`. Reused by every Run on the report; deleted when the last Run detaches |
| `RunWarcraftLogsReport` | Run ↔ report association (`runId, reportId` unique): `source` (MANUAL / DISCORD_BOT), attached by (null for the log bot), Discord message id, last scan (null until first scanned) |
| `RunWarcraftLogsFight` | one report fight considered for one Run: WCL fight/encounter id, kill, relative and absolute times, `raidContentId`, `status` (ASSIGNED / NEEDS_REVIEW / IGNORED), `decision` (AUTO / MANUAL), evidence codes, roster overlap |
| `RunConsumableAudit` | one per Run (`runId` unique): last successful analysis (`autoAnalyzed` when automatic), last attempt, safe failure code, automatic attempts |
| `RunConsumableAuditFight` | audited fight snapshot (`auditId, reportCode, wclFightId` unique), Warlock presence, Healthstone use seen |
| `RunConsumableAuditPlayer` | audited booster snapshot: attendance / external booster link, names, class, role, match status, WCL actor id |
| `RunConsumableAuditObservation` | one fact per player per fight: `COMBATANT` / `PARTICIPANT` presence, `AURA` (flask at pull), `CAST` (potion/Healthstone), `DEATH`; report-relative `atMs` |
| `Run.completedAt` | set on IN_PROGRESS → COMPLETED; closes the Run's active window |

A successful analysis replaces all audit fights/players/observations in one transaction (idempotent). A failed analysis or re-scan keeps the previous snapshot and associations untouched. When the assignment changes after an analysis, the view flags the audit as stale until **Re-analyze**. Deleting a Run cascades to its associations, fight rows and audit; other Runs' use of the same report is unaffected.

## Warcraft Logs requests

Via `warcraftLogsApiClient` (shared client-credentials token cache, typed results, never throws for business outcomes):

- **Link / Re-scan** — `fetchReportMetadata`: one GraphQL request per report (fights, player actors, ranked characters, region). Linking a report another Run fetched in the last 10 min (`WCL_REPORT_METADATA_REUSE_SECONDS`) reuses the stored metadata — no request.
- **Analyze** — `fetchReportConsumableEvents`: one GraphQL request per linked report with three aliased streams for the Run's assigned fights: `Casts` (filtered server-side to catalog spell ids, time-windowed incl. 5 s pre-pull), `Deaths` (friendly), `CombatantInfo` (reduced to aura ids on receipt). Only a stream with `nextPageTimestamp` is re-requested.

Never one request per player, death, or Run fight. Report requests use a 45 s timeout; failures map to `WCL_UNAVAILABLE`.

## Consumable catalog

`src/lib/consumable-catalog.ts` is the single list of supported consumables: category (`FLASK`, `DAMAGE_POTION`, `MANA_POTION`, `HEALING_POTION`, `HEALTHSTONE`), spell id, name, expansion. Business logic only reads categories.

The Midnight ids were taken from public Venomous Abyss reports (WCL zone 53) through the WCL v2 API: `masterData.abilities` for names, cast events joined to CombatantInfo `specID` to classify potions by who uses them (healer-only → Mana Potion), and CombatantInfo `auras` for flasks. Ids that could not be classified from that evidence are left out rather than guessed.

To add a consumable (new season, new rank): add a catalog row with its source. To add a new check category later (food, weapon oil, rune, defensives): add the category + evidence type to the catalog and a rule to the policy — the observation table stores `category` as text, so no enum migration is needed.
