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
| 6 | Test cleanup by module | Partial: flagged tests in PR open; 39 of 342 files read, 358 of 3933 tests decided |
| 7 | Frontend: error, loading and not-found pages; shared dialog effect | PR #329, awaiting review |
| 8 | Performance, measured: run detail payload, event purge, rate-limit log | PR #330, awaiting review |
| 9 | Dependencies and final verification | Dependencies audited, no change; TruffleHog scan still invalid |
| 10 | ManawyrmHub preparation | Needs approval |

## Decisions for the owner

- **Payouts:** the assignment lists payout calculations as supported, but the feature was removed in #228 and no payout code path remains. Only the unused `src/lib/gold.ts` is left, and it stays until you confirm.
- **Off-site backup:** no destination exists, so the migration precondition stays open.
- **Old repository visibility:** it stays public, including its history, unless you decide otherwise.

## Change log

Updated with every batch.

### Batch 6: flagged tests (partial)

- Removed: `auth-session-hardening` constants test, `manage/runs/create` path constant test, bot client instance test (merged into the error test).
- Rewritten: three platform-owner tests, one misleading bot route title, one Warcraft Logs title that claimed a rejection it never tested, one weak token count.
- Read in full, all kept: 4 validator files, 6 integration files.

### Dependencies

- `npm audit --omit=dev`: 1 high, `lodash` 4.17.21, indirect through discord.js. Only `get` and `uniqWith` are used there. No fix is available from discord.js. Accepted and reported.
- Not updated: Prisma RCs (behind by several RCs), `vitest`, `typescript`, `eslint`, `dotenv` majors. A freeze is the wrong moment for them. The new owner decides.

### Batch 8: performance

Measured locally: a production build on the seed database, 8 requests per page. Production was not changed. Before/after values for production can only be taken after a deploy.

| Item | Before | After |
| --- | --- | --- |
| Run detail page data (RSC) | 91 KB | 66 KB |
| Run detail HTML | 241 KB | 213 KB |
| Run detail response time | about 122 ms | about 130 ms, no improvement |
| Event purge, 5000 rows | about 15.8 s | about 15 ms |
| Event purge, 200 rows | about 670 ms | about 2 ms |

Slow sync pass, read from production, not fixed:

- About 60 slow passes per hour, one a minute, 15 to 25 s each, no failures. Starts are exactly 60 s apart, and each end drifts about 330 ms later.
- This points to a wait on a Discord rate-limit bucket. It is a hypothesis: discord.js waits silently, and the two scans that run once a minute both read channel history. The voice presence report makes no Discord request.
- The batch adds a log line for each wait. After a deploy, `journalctl -u boostinghub-discord-bot | grep 'rate limited'` names the route. Effect today: Discord updates can wait up to about 25 s once a minute.

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

## Hardcoding audit (added 2026-11-02)

Requested as an addendum: inspect every source, config, script, test and doc for hardcoded Discord ids, URLs, infrastructure values, business constants, secrets and test fixtures; classify each finding KEEP / CENTRALIZE / CONFIGURE / DERIVE / REMOVE / BLOCKED and implement the justified changes. Runs after the lib and domain test audit and before the services test audit and performance work. Findings: `docs/audit/hardcoding-findings.md` (to be written).

Second addendum, same pass: replace unexplained magic strings and numbers in business logic with named constants close to their owning domain (retry limits, delays, intervals, pagination limits, Discord error codes, thresholds, repeated API paths). Keep obvious literals, messages and JSX text inline; no global constants file; no new configuration layer; behaviour and public contracts unchanged.

## Test code quality and fixtures (addenda, 2026-11-02)

Four addenda extend the test audit: hold test code to production standards (no unexplained magic values, typed factories, scoped fixtures, isolation, strong assertions), refactor the Bot API integration suite as the worked example, remove fragile hardcoding without making tests tautological, and the general quality bar (root causes, no workarounds, self-review per batch).

Rules applied to every test file from here on:

- Expected values of public contracts (error codes, HTTP statuses, buff ids, wire keys) stay explicit literals in the test, so a changed implementation constant cannot pass unnoticed.
- DB suites create their own users, characters and runs with fresh ids, delete exactly those rows, and fail when a row survives. No pre-clean by predictable ids, no swallowed cleanup errors.
- The seeded fixtures (`src/prisma/seed.ts`) are named through `SEED_IDS`, not raw UUIDs. A suite may read a seeded row; it removes only rows it wrote.
- Raid-week-dependent suites freeze `Date` (only) at `RAID_WEEK_TEST_CLOCK` with `advance: true`, so CURRENT/NEXT is deterministic and Prisma keeps real timers.
- Exact key-list assertions stay only where a separately deployed consumer reads the shape (the Discord bot via `src/discord-bot/bot-api-client.ts`).

Shared fixtures, each small and scoped, in `src/test/`:

| Module | Contents |
| --- | --- |
| `actors.ts` | `testActor(id, role, overrides)`: the typed signed-in caller (replaces 71 local `asUser` copies as files are audited) |
| `domain-error.ts` | `expectDomainError(promise, code)`: reports what actually happened (replaces 41 local copies) |
| `db-fixtures.ts` | `assertIsolatedTestDatabase()` (test runtime and pool on `TEST_DATABASE_URL`), `createTestUser`, `createTestCharacter`, `syntheticDiscordId`, `deleteCreatedRows` (verifies nothing survives) |
| `bot-api.ts` | `botRequest(path, {token, actingDiscordUserId, body})`, `runRouteParams`, `installBotApiToken` |
| `time.ts` | added `RAID_WEEK_TEST_CLOCK`, `CURRENT_WEEK_RUN_START` |

Also: `src/prisma/seed-ids.ts` now owns the seed's ids (`seed.ts` imports them), and `anyContentRunInput` in `src/lib/test-run-input.ts` marks tests that do not depend on the raid content.

Refactored so far:

- `src/app/api/bot/bot-routes.test.ts` (25 tests, all kept). Coverage preserved for token auth, acting-user resolution, character ownership, Booster role, signup window, quick-signup idempotency, sync channel and schedule contracts, channel-gone, voice channel, start voice, and WCL configuration. Fixed ids, a fixed real-looking snowflake set and the pre-clean of fixed user ids replaced by fresh rows. Request, header, param, signup-body and discord-state helpers replace 20 inline request blocks. The bucket is now asserted as exactly CURRENT under a frozen clock. Added side-effect checks: the spoofed body userId, foreign character, closed signup window and unauthenticated quick signup write no signup row.
- `src/app/api/bot/runs/[runId]/archive/archive-route.test.ts`: the tests no longer depend on order (each makes its own Run). The token restore no longer writes the string "undefined" into the environment, and a repeated archive keeps the first timestamp.
- `src/domain/roster-raid-buffs.integration.test.ts`: invalid fixed UUIDs, pre-delete, wall-clock scheduling, repeated roster settings and the shared mutable Run all removed. Each test gets its own Run. SKYFURY, ARCANE_INTELLECT and POWER_WORD_FORTITUDE are still asserted explicitly.
- `src/controllers/run-consumable-audit.actions.test.ts`: seed users and the seeded completed Run are now named via `SEED_IDS`. The duplicated per-test delete is dropped (afterEach alone cleans), the revalidated path is checked via the public `runDetailPath`, and an unauthenticated call is checked to revalidate nothing.

## Continuation point

The test audit is not complete. Order for the rest, smallest risk first:

1. Done on branch `test/audit-batch-a`: `src/repositories` (11 files), `src/components` (39), `src/discord-bot` (37), `src/lib` (88), `src/domain` (22), `src/services` batches 1–5 (63 files, the smallest by line count, through `raid-catalog-lifecycle.test.ts`).
2. Next: the rest of `src/services` (smallest first, `node todo.cjs src` lists them), `src/guides/guide-replace.test.ts`. Each file now also gets the fixture rules above; files already audited get a fixture sweep afterwards (local `asUser`, `expectDomainCode`, fixed-id pre-cleans, swallowed `.catch(() => {})` cleanups).
3. Open from batch 2: `src/services/signup.service.test.ts` is classified REWRITE but not yet rewritten. It writes onto shared seed Runs, its tests depend on order, and it is the main caller of the test-only `signupService.createBoosterSignup`. It is rewritten in the batch that removes that method (13 files, 75 uses), because the replacement production entry point (`setCharacterOffers`) has different semantics: complete offer set, no backups, no `DUPLICATE_SIGNUP`.

Services batch 2 notes worth keeping:

- `schedule-conflict-integrity.test.ts` used fixed November 2026 dates. Run creation rejects past starts, so it would have failed for good after 10 November 2026. It now uses the frozen raid-week clock.
- `signup-my-runs-terminal-filter.test.ts` mocked the repository with a re-implementation of its status filter, so the service's own terminal-Run filter was untested. Mutation check: with that filter removed, 7 rewritten tests fail (none did before).
- `settings.service.test.ts` "defaults" tests asserted values the suite had written itself; they now prove the column defaults.
- `warcraft-logs-discovery.test.ts` and `discord-member-name-sync.service.test.ts` used real-looking Discord snowflakes (log channel, log bot, guild, role ids). They are now synthetic per run.
- `character-sync-matrix.test.ts` clears earlier `CHARACTER_BULK_FORCE_REFRESH_STARTED` markers before its bulk run: the cooldown reads the latest marker community-wide. It is the one documented delete of rows a suite did not create, limited to that marker type on the isolated test DB.
3. For each file: read every test, record a decision in `docs/audit/test-decisions.json`, change what the decision says, then rebuild `docs/audit/test-ledger.tsv` from `vitest list --json`.
4. After that, remove methods only tests call, such as `signupService.createBoosterSignup` (74 uses) and `rosterService.setDraftSelection` (78 uses). Move their tests to the production entry points first.
5. Then shared helpers for `createTestUser` (36 copies), `createCharacter` (29) and `createUser` (26), and `restoreMocks` for the 52 files that never reset mocks.

Not started: renames from the naming table, other than the move to `src/domain`.
