# Phase 1 — Centralized test structure

## STATUS

- **Phase:** 1 — Centralized test structure
- **Result:** DONE
- **Completion criteria:** Satisfied (verified retrospectively on branch `test/audit-batch-a` at HEAD `0db5dc3`, 2026-11-02)

All active tests live under repository-level `tests/`. Vitest discovery, aliases, helpers, shell tests, and coverage paths were preserved. No tests remain under `src/`.

## GIT

| Item | Value |
| --- | --- |
| Branch | `test/audit-batch-a` |
| Phase 1 structural commit | `1c10d74` — move every test from `src/` into `tests/` |
| Phase 1 docs commit | `95c2eaf` — describe the `tests/` layout and record the move |
| Report commit | (this report; see subsequent commit on the audit branch) |
| Remote | Synchronized with `origin/test/audit-batch-a` at time of verification |
| Working tree at verification | Clean aside from this documentation batch |

## WORK COMPLETED

- Moved every Vitest suite out of `src/` into `tests/unit/`, `tests/integration/`, `tests/e2e/` as classified by database / multi-component usage.
- Relocated fixtures and helpers to `tests/fixtures/` and `tests/helpers/`.
- Relocated setup to `tests/setup/` (`global-setup.ts`, `external-api-guard.ts`).
- Updated Vitest `include` to `tests/**/*.test.ts`, global and per-file setup paths, and `@tests` alias in Vitest + `tsconfig.json`.
- Rewrote 89 files’ `@/test/*` and `@/lib/test-run-input` imports to `@tests/fixtures/*` / `@tests/helpers/*`.
- Fixed 16 files that read sources relative to their own folder (`srcPath()`, `@/` imports).
- Updated deploy shell-test path resolution and `docs/DEVELOPER.md` / `docs/DEPLOYMENT.md`.
- Remapped `test-decisions.json` / `test-ledger.tsv` keys to the new paths without changing decision counts at move time.

**Deferred (intentionally not Phase 1):**

- Four production modules imported only by tests (dead-code candidates for Phase 3): `roster-run-commitments.tsx`, `character-availability.ts`, `roster-candidate-counts.ts`, `character-availability.repository.ts`.
- Test quality audit (Phase 2), production refactors (Phase 3), perf/security (Phase 4), UX/docs (Phase 5), final matrix (Phase 6).

## QUALITY AND VALIDATION

| Check | Result |
| --- | --- |
| Inventory before/after move | 341 files / 3825 tests; 0 missing, 0 extra, 0 outside `tests/` |
| `git ls-files` under `src` for `*.test.ts` | 0 |
| Live verification (2026-11-02) | 341 `*.test.ts` under `tests/`; Vitest `include: ["tests/**/*.test.ts"]` |
| Deploy shell tests | update-server 41/41, backup-db 39/39, env-status 18/18 |
| Full suite after `test:db:reset` on `boostting_bot_test_audit` | 341 files / 3825 tests passed (~448 s) |
| ESLint | Pass |
| Typecheck | Pass |
| Production build | Pass |
| Fail-closed DB guard | Preserved (`TEST_DATABASE_EXPECTED_NAME` / `boostting_bot_test_audit`) |

## FINDINGS

- Structural move alone did not change classification totals (at move: 2373 KEEP, 626 REWRITE, 826 open).
- Classification by behaviour (database / multi-component → integration) is authoritative regardless of former `src/` path.
- Phase 2 must finish reviewing remaining suites; Phase 1 must not be re-done.

## NEXT PHASE

- **Phase 2 — Test quality audit**
- Finish every remaining UNREVIEWED suite; migrate `setDraftSelection` → `saveDraftSelection` then remove; isolate DB cleanups; full suite ×2 without reset; lint/typecheck/build; reconcile ledger; then publish `PHASE-2.md`.

## RELEASE SAFETY

No merges, deployments, production database writes, live Discord operations, force-pushes, history rewrites, or new repository creation occurred as part of Phase 1 or this report.
