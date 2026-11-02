# Phase 2 — Test quality audit

## STATUS

- **Phase:** 2 — Test quality audit
- **Result:** DONE
- **Completion criteria:** Satisfied on branch `test/audit-batch-a` at HEAD after this report commit (2026-11-02)

Every live Vitest file under `tests/` has a KEEP/REWRITE/MERGE/REMOVE decision. Remaining seed-coupled and isolation-fragile suites were rewritten or hardened. `rosterService.setDraftSelection` is removed; draft selection in tests goes through production `saveDraftSelection` (local adapters where a single-slot API is still convenient). Full suite passes twice on `boostting_bot_test_audit` without reset; lint, typecheck, and production build pass.

## GIT

| Item | Value |
| --- | --- |
| Branch | `test/audit-batch-a` |
| Remote | Synchronized with `origin/test/audit-batch-a` at report time |
| Notable commits this phase (tail) | `cd4a12b` run-management; `f8146c2` signup-offers; `71cbb8b` attendance; `ac494f4` roster.service; `b9138c6` discord-sync; `8892f4f` remove `setDraftSelection` |
| Working tree at gate | Clean aside from this report + gate lint/tsc fixes |

## WORK COMPLETED

### Decision ledger

| Metric | Count |
| --- | --- |
| Live test files | 341 |
| Decision entries (incl. 1 REMOVE tombstone) | 342 |
| KEEP | 257 |
| REWRITE | 84 |
| REMOVE (tombstone) | 1 |
| UNREVIEWED ledger rows | 0 |
| Ledger tests reviewed | 3825 of 3825 rows decided (runtime suite: 3824 tests — one row/runtime delta from earlier merges) |

### Final five UNREVIEWED suites (this continuation)

| File | Tests | Decision | Notes |
| --- | --- | --- | --- |
| `run-management.service.test.ts` | 41 | REWRITE | `assertIsolatedTestDatabase`; verified `deleteAndCount`; `testActor`; `expectDomainError` |
| `signup-offers.service.test.ts` | 32 | REWRITE | Isolation + local `setDraftSelection`→`saveDraftSelection` adapter (same-user booster replace) |
| `attendance.service.test.ts` | 36 | REWRITE | Isolation; draft adapter; fixed 300ms sleeps → `waitForLockWaiter` |
| `roster.service.test.ts` | 30 | REWRITE | `SEED_IDS`; `restoreSeededRosterFixtures` for ×2 without `test:db:reset`; Save rejects unapproved Boosters; publish path plants via repository |
| `discord-sync.service.test.ts` | 92 | REWRITE | Isolation; draft adapter; voice-lane timeouts 30s for publish+start fixtures |

### Production API

- Removed `rosterService.setDraftSelection` (test-only single-slot path). Callers use `saveDraftSelection` or test-local adapters that compose a full draft replace (including same-user Booster replace and `confirmedWarnings` forwarding where needed).

### Isolation patterns enforced

- Fail-closed `assertIsolatedTestDatabase` before destructive setup/cleanup
- Verified `deleteAndCount` (0 or 1) instead of swallowed deletes
- Shared `testActor` / `expectDomainError` where local copies existed
- Seeded roster lab/published restored in-suite so `roster.service` no longer requires a fresh DB reset between runs

## QUALITY AND VALIDATION

| Check | Result |
| --- | --- |
| Full suite run 1 on `boostting_bot_test_audit` (no reset before run) | 341 files / **3824** tests passed (~557 s) |
| Full suite run 2 immediately after (no reset) | 341 files / **3824** tests passed (~538 s) |
| `npm run lint` | Pass (0 errors) |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| Fail-closed DB pin | `TEST_DATABASE_EXPECTED_NAME=boostting_bot_test_audit` |
| `setDraftSelection` in `src/` | 0 matches |

## FINDINGS

- `saveDraftSelection` is stricter than the removed single-slot API: it refuses unapproved Boosters on Save. Publish-blocker coverage for that case now plants the draft via `rosterRepository.setSignupSelected` after asserting Save rejects.
- Activity feed assertions that used `listRecent(20)` under a resetting `FEED_TEST_CLOCK` were flaky across suite invocations; `roster.service` now uses `findLatestByType` + message check.
- Runtime test count is 3824 vs 3825 ledger rows (historical merge/tombstone accounting). Phase 2 treats ledger UNREVIEWED=0 and green ×2 suite as the gate; Phase 6 can reconcile the off-by-one if desired.
- Deferred to later phases (unchanged): A18/A19, multi-row `.delete()` cardinality review leftovers outside audited files, four production modules imported only by tests, naming renames, perf/security/UX.

## NEXT PHASE

- **Phase 3 — Production refactoring / code quality**
- Dead-code candidates, A18/A19, naming review (rename-only; no public fields/columns/Discord payloads), then `PHASE-3.md`.

## RELEASE SAFETY

No merges, deployments, production database writes, live Discord operations, force-pushes, history rewrites, or new repository creation occurred as part of Phase 2 or this report. Destructive DB work used only `boostting_bot_test_audit`.
