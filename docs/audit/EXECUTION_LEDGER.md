# Refactoring execution ledger

Working record for the refactoring before the move to `Syntax1991/ManawyrmHub`. It survives interrupted sessions: read this first when continuing. It is removed before the migration commit.

- **Test decisions:** [test-decisions.json](test-decisions.json) (input) and [test-ledger.tsv](test-ledger.tsv) (one row per discovered test). `UNREVIEWED` means nobody has read that test yet.
- **Rules:** one agent, one scope per PR, no merge, no deploy, no production writes, no live Discord changes, no history rewrite. Merges and deploys need the owner's approval.

## Baseline

Measured 2026-11-02 at `main` = `da5df27`, plus documentation-only commits.

| Item | Value |
| --- | --- |
| Files under `src` | 929 (592 non-test, 337 test) |
| Other tracked files | 13 scripts, 16 deploy, 31 docs and images, 428 migrations |
| Discovered tests (`vitest list`) | 3919 in 337 files; 0 skipped, 0 failing |
| Shell tests outside Vitest | 3 scripts, all passing |
| Full test suite | 495 s, one file at a time |
| Lint, typecheck, build | Pass |
| `npm audit --omit=dev` | 1 high: indirect `lodash` 4.17.21 |
| Gitleaks | No confirmed credential; all findings reviewed |
| TruffleHog | **Not valid:** the last run read 0 bytes |
| Coverage | **Not measurable:** no coverage provider installed |
| Client JavaScript | 1491 KB total in `.next/static` |
| Type escapes outside tests | 8 `any`, 49 `as unknown as`, 17 lint or TS suppressions, 0 TODO |
| Import cycles | 0 |

### Production measurements (read-only, 2026-11-02)

Single browser session, one measurement each, on a small dataset: 104 users, 106 runs, 353 characters.

| Page | First byte | Load | HTML |
| --- | --- | --- | --- |
| `/runs/[id]` (63 signups) | 802 ms | 1031 ms | **1280 KB** |
| `/dashboard` | 357 ms | 397 ms | 48 KB |
| `/manage/runs` | 308 ms | 338 ms | 61 KB |
| `/my-runs` | 146 ms | 188 ms | 78 KB |
| `/runs` | 100 ms | 142 ms | 43 KB |
| `/manage/analytics` | 66 ms | 80 ms | 36 KB |
| `/manage/system` | 53 ms | 85 ms | 72 KB |

| Job or resource | p50 | p95 | p99 | Max |
| --- | --- | --- | --- | --- |
| Bot `SYNC_ONCE`, 14300 per day | 344 ms | **17.9 s** | 19.9 s | 23.6 s |
| `SCHEDULED_SYNC_PASS`, 96 per day | 4.6 s | 20.9 s | 28.2 s | 28.2 s |

- **Database:** 135 MB, of which `integration_event` is 97 MB. It gains about 18300 rows a day, mostly a row for every successful sync pass, and is kept for 30 days.
- **Memory:** web about 392 MB, bot about 178 MB. CPU is low; load average was 0.02.
- **Not measured:** per-query timings, because `pg_stat_statements` is not enabled.

## Architecture findings

Confirmed by import analysis of all non-test files. Severity is about real impact.

| # | Sev | Where | Evidence | Action |
| --- | --- | --- | --- | --- |
| A1 | Medium | `src/controllers/*.actions.ts` | 8 exported server actions had no caller | Removed in PR "remove dead code" |
| A2 | Medium | `next.config.ts` | Production sends no HSTS, nosniff, frame or referrer header, and sends `X-Powered-By` | Security PR |
| A3 | Low | `src/discord-bot/bot-api-client.ts:55` | Logs up to 500 characters of a non-JSON body | Security PR |
| A4 | Medium | `src/components/manage/*`, `src/services/*` | 16 component-to-service value imports, mostly pure rules or constants | Boundary PR |
| A5 | Low | `src/app/(app)/*/page.tsx`, `layout.tsx` | 6 pages and the layout read `settingsRepository` directly | Boundary PR |
| A6 | Low | `src/app/(app)/runs/[runId]/archive-transcript/route.ts` | Route calls `runRepository` and decides permission itself | Boundary PR |
| A7 | Low | `src/lib/create-run-recurring.ts` | `lib` imports from a React component | Boundary PR |
| A8 | Low | `src/services/*` (32 files), `repositories`, `validators`, `lib` | Pure rules live in `services`, so 38 imports point the wrong way | Decide after A4 |
| A9 | Low | `src/guides/*-publisher.ts`, `scripts/publish-*.mts` | Legacy retirement and key rename code; no live message needs them now | Guide PR |
| A10 | Low | `src/guides`, `scripts` | Two publishers and two scripts are near copies | Guide PR |
| A11 | Medium | `src/app` | No `error.tsx`, `loading.tsx` or `not-found.tsx` anywhere | Frontend PR |
| A12 | Low | `src/components` | 12 `window.location.reload` calls next to 42 files using `router.refresh` | Frontend PR |
| A13 | Low | `src/components` | 13 identical dialog effects | Frontend PR |
| A14 | Medium | `src/components/manage/roster-builder.tsx` | 2471 lines, 23 state hooks, 54 functions | Only with tests first |
| A15 | Medium | `src/services/discord-sync.service.ts`, `src/discord-bot/sync-loop.ts` | 2240 and 2289 lines | Split only along tested lanes |
| A16 | Open | `src/lib/gold.ts` | Payout leftover with no caller. Payouts were removed on purpose in #228 | **Owner decision**, see below |

Healthy and to be left alone: no import cycles, no repository bypass from components, bot API uses constant-time token comparison, all 127 server actions authenticate directly or through the service they call.

### Refuted suspicions

- `services/character-operations.service` imported into components: only into server components, for a constant.
- Sequential scans on `character` and `run_roster_entry`: tables are small, so these are not a bottleneck by themselves.
- Case-sensitive file names: 0 path collisions and 0 import case mismatches.

## Naming and structure

| Topic | Finding |
| --- | --- |
| Case | Every file outside `src/app` is lower-kebab, except framework needs. No Windows and Linux mismatch |
| Suffixes | Repositories are consistent. Controllers mix `.actions` (22) and `.controller` (3), which is meaningful |
| `src/services` | 63 `.service.ts` plus 32 pure rule modules without a suffix |
| `src/lib` | 128 files, flat; the largest group of unclear ownership |
| Overlapping names | `operational-analytics` and `character-schedule-conflict` each exist with and without `.service` in `services`; 6 stems exist in both `lib` and `services` |
| Generic names | Only `lib/blizzard/types.ts`, which is accurate. No `utils`, `helpers` or `common` |
| Test helpers in production paths | `src/lib/test-run-input.ts` is used only by tests |
| Tests | 118 of 337 test files have no same-named source file, because they test scenarios. 31 use a dotted scenario suffix |

Proposed moves are in the backlog. No mechanical rename has been done yet.

## Test suite findings

Static scan of all 3699 test blocks. These are candidates to read, not decisions.

| Signal | Count | Note |
| --- | --- | --- |
| Tests with only mock-call assertions | 98 | Mostly Discord lanes, where the API call is the behavior |
| Tests with only weak assertions | 12 | To read individually |
| Tests that assert on source text | ~60 in 9 files | Break on harmless edits, and pass on broken behavior |
| Structurally identical bodies | 129 in 49 groups | Mostly table cases with different literals, candidates for `it.each` |
| Helpers redefined in many files | `createTestUser` 36, `createCharacter` 29, `createUser` 26 | A small shared factory would help |
| Mock lifecycle | 52 of the mocking files never reset mocks | `restoreMocks` in the config is cheap |
| Literal seed UUIDs | 626 in 113 files | Couples tests to `seed.ts` |
| Skipped tests | 0 | |

Critical gaps:

- `session-management.service.ts`: the existing test file exercises Better Auth directly, not this service, so its ownership checks had no test. Added in the security batch.
- 14 of 25 controller files are not exercised by a test directly, including `signup.actions`, `strike.actions` and `user-management.actions`.
- `src/discord-bot/interactions/note-handler.ts` has no direct test.
- Only 2 bot routes have explicit credential tests, out of 24.

## Backlog

Order follows the assignment. Each line is one PR, stacked on the one before.

| # | Scope | State |
| --- | --- | --- |
| 1 | Documentation and restart plan | PR #323, awaiting review |
| 2 | Remove dead code | PR #324, awaiting review |
| 3 | Security headers, bot log body, route-wide bot credential test, session ownership tests | PR #325, awaiting review |
| 4 | MVCS boundaries: app and controllers no longer import repositories; lib no longer imports components | PR #326, awaiting review |
| 4b | Move pure rules from `src/services` to `src/domain` | PR #327, awaiting review |
| 5 | Guide code: drop legacy paths, share publisher code | PR #328, awaiting review |
| 6 | Test cleanup by module | Planned; 19 of 337 files read |
| 7 | Frontend: error, loading and not-found pages; shared dialog effect | PR open, awaiting review |
| 8 | Performance, measured: run detail payload, sync p95, event volume | Planned |
| 9 | Dependencies and final verification | Planned |
| 10 | ManawyrmHub preparation | Needs approval |

## Decisions for the owner

- **Payouts:** the assignment lists payout calculations as supported, but the feature was removed in #228 and no payout code path remains. Only the unused `src/lib/gold.ts` is left, and it stays until you confirm.
- **Off-site backup:** no destination exists, so the migration precondition stays open.
- **Old repository visibility:** it stays public, including its history, unless you decide otherwise.

## Change log

Updated with every batch.

### Batch 7: frontend states

- Adds `(app)/error.tsx` (uses `retry`, per the Next.js docs in this repo), `(app)/loading.tsx`, `not-found.tsx` and `useModalDialog` in 12 dialogs.
- Browser check on local dev: a throwing page shows the retry page in the shell; an unknown URL returns 404; a filter click shows no skeleton; a page change does; a non-admin on `/manage/users` still ends on the dashboard; Edit Run opens as a modal and closes.
- Not changed: 12 `window.location.reload` calls. They reset all client state after a run action. `router.refresh` would keep it, and each site would need its own check. Low value during a freeze.

### Batch 5: guide publisher

- `guide-card.ts`, `guide-publisher.ts` and `scripts/publish-guide.mts` replace two near-identical publishers and two scripts. npm script names stay.
- Removed: old-post fingerprints, `--retire-legacy`, the `complete-payout` key rename, and the canonical verifier only retirement used.
- A message with a retired key now makes the publisher refuse, like any unknown key.
- Tests: 5 guide test files. Repeated tests run against both guides from `guide-publisher.test.ts`. New cases: refusing a plan with errors, foreign authors, unmarked messages.
- Script check: `publish-guide.mts` ran the full replace flow and a final normal publish for both guides against an in-memory Discord. No real Discord call.

### Batch 4b: pure rules in `src/domain`

- 26 pure modules and their 22 test files moved from `src/services` to `src/domain`, plus two new modules: `boosting-access.ts` and `character-sync-eligibility.ts`.
- Views, validators and repositories no longer import value code from `src/services`, apart from type imports.
- Stayed in `src/services`: `character-raider-io-ilvl`, `character-run-commitment`, `signup-eligibility-context`, `raid-catalog-import-plan`, `roster-boss-exceptions`, `signup-eligibility`: each needs a repository, client or service.
- Accepted: `consumable-auto-audit-policy`, `dashboard-attention`, `wcl-report-overlap` keep type-only imports from services or repositories.

### Batch 4: MVCS boundaries

- Six pages and the app layout read the time zone through `settingsController`.
- `devIdentityService` replaces the direct repository call in `auth.actions` and `auth.controller`.
- `listAttachCandidatesForSlot` owns the slot lookup that `community-schedule.actions` did.
- The archive transcript route asks `runDetailService.canManageRunById`. New route tests: 4, a mutation that dropped the permission check made them fail.
- `src/lib/schedule-start.ts` holds pure code that lived in a client component.
- Accepted: `lib/discord/discord-integration-events`, `lib/blizzard/blizzard-integration-events` and `lib/integration-provider-events` call `integrationEventService`. They are thin adapters and moving them changes nothing for callers.

### Batch 3: security hardening

- `next.config.ts`: adds HSTS (180 days, no subdomains), nosniff, frame denial, a referrer policy and a permissions policy, and removes `X-Powered-By: Next.js`. Apache still adds its own `X-Powered-By: PleskLin`, which is a server setting. No content security policy yet: it needs a study of inline scripts and images first.
- `bot-api-client.ts`: a non-JSON response no longer logs its body.
- New tests: `bot-route-credentials.test.ts` (every bot route found on disk refuses a missing or wrong token), `session-management-ownership.test.ts`, `next-config.test.ts`.
- Mutation checks: removing the credential check from one route, and removing the owner filter from the session query, each made the new tests fail. Both mutations were restored from a copy.

### Batch 2: remove dead code

Found with an AST scan for exports and object methods that nothing references, then a search for dynamic imports (none) and framework entry points (excluded). Verified by typecheck, lint, build and the full suite.

- Files removed: `components/runs/run-overview-section.tsx`, `components/ui/view-section.tsx`, `discord-bot/class-display.ts`, `services/discord-booster-role-sync.service.ts` and its test, which only compared an alias with itself.
- Server actions removed: `linkBattleNetCharacterAction`, `loadImportSessionAction`, `requestBoosterAccessAction`, `lookupCharacterFromRaiderIoAction`, `createCharacterAction`, `validateRosterAction`, `createBoosterSignupAction`, `cancelBoosterSignupAction`.
- Also removed: 19 unused service and repository methods, plus unused helpers, schemas, types and constants. The full list is in the commit.
- Kept on purpose: methods only tests call, such as `signupService.createBoosterSignup` with 74 test uses. They go with the test cleanup, because removing them needs test rewrites.

## Continuation point

See the backlog table: the first line that is not done is the next step. Tools used for scans and validation are recreated easily: AST scans of exports, `vitest list --json`, and the commands in the baseline table.
