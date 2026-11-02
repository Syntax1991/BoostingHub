# Final Audit Acceptance Review

| Field | Value |
| --- | --- |
| Branch | `test/audit-batch-a` |
| Claimed audit HEAD | `dfa940e` (Phase 6 report) |
| Acceptance HEAD (this report) | see commit after push |
| Review date | 2026-11-02 |
| Scope | Acceptance only — no feature phase, no deploy, no merge |
| Verdict | **ACCEPTED WITH DOCUMENTED RISKS** |

This review re-checked claims against the repository, Git history, and fresh validation. Prior phase reports were treated as claims, not proof.

---

## 1. Removed-test reconciliation (341→338 files, 3824→3801 tests)

Baseline: Phase 2 gate (`PHASE-2.md`) — **341 files / 3824 tests**.  
Final: Phase 6 + acceptance re-run — **338 files / 3801 tests**.  
Delta: **−3 files / −23 tests**.

### File 1 — `tests/unit/lib/character-availability.test.ts` (−7)

| Item | Detail |
| --- | --- |
| Commit | `e2a0979` — *refactor: delete four production modules imported only by tests* |
| Production deleted with it | `src/lib/character-availability.ts`, `src/repositories/character-availability.repository.ts` |
| Original cases | half-open `[startsAt, endsAt)` against Run start; reject invalid/zero intervals; select among covering blocks by startsAt/endsAt/id; past blocks historical; overlapping precedence (permutation winner, endsAt tie-break, lexical id) |
| Reason | Helpers existed only to interpret deprecated `CharacterAvailabilityBlock` rows. No remaining `src/` importer (static or dynamic). Product rule is “manual blocks are ignored” (`character-schedule-conflict.service.ts`). |
| Equivalent coverage | `tests/integration/services/schedule-conflict-integrity.test.ts`, `character-schedule-commitments.service.test.ts` insert legacy rows via ORM and assert they do **not** block. Domain conflict rules remain in `tests/unit/domain/character-schedule-conflict.test.ts` and commitment suites. |
| Production contract lost? | **No.** Deprecated table remains in the Prisma contract; behaviour under test was dead code. |
| Restore? | **Not required.** Restoring would reintroduce dead production modules. |

### File 2 — `tests/unit/lib/roster-candidate-counts.test.ts` (−4)

| Item | Detail |
| --- | --- |
| Commit | `e2a0979` |
| Production deleted with it | `src/lib/roster-candidate-counts.ts` |
| Original cases | unique vs projected card counts for single-/double-/triple-role and hybrid filter cases |
| Reason | Pure helper imported only by its unit suite; live roster builder uses its own `candidateCount` on optimizer input, not this helper. |
| Equivalent coverage | Optimizer / builder suites exercise live count fields (`roster-builder.service` / `roster-builder-optimizer`). No UI still calls the deleted helper. |
| Production contract lost? | **No.** |
| Restore? | **Not required.** |

### File 3 — `tests/unit/components/manage/roster-run-commitments.test.ts` (−10)

| Item | Detail |
| --- | --- |
| Commit | `e2a0979` |
| Production deleted with it | `src/components/manage/roster-run-commitments.tsx` |
| Original cases | `getRunCommitmentPresentation` RESERVED/COMMITTED tones; `RosterRunCommitmentsBlock` draft/published/multi/plain; `RosterScheduleConflictAlert` danger alert, label/checkbox a11y, weekly unavailability plain text |
| Reason | Component had no live `src/` consumer. |
| Equivalent coverage | Commitment **semantics** covered by `tests/integration/services/character-run-commitments.test.ts` (RESERVED/COMMITTED mapping, schedule gap, conflict blocking, published vs draft). Risk / preflight projection covered by domain and run-preflight unit suites. Presentation chip copy for the deleted widget specifically is gone with the widget. |
| Production contract lost? | **No live UI contract.** Semantic commitment/conflict contracts remain covered. |
| Restore? | **Not required.** |

### Non-file removals contributing the remaining −2 tests

| Item | Detail |
| --- | --- |
| File kept | `tests/integration/discord-bot/sync-loop.test.ts` (72→70 `it()`s) |
| Commit | `cc14bdf` — *refactor: remove empty Discord raidInvites sync lane (A19)* |
| Removed cases | `syncOnce — Apex-style Raid Invite DMs` → (1) DMs each pending invite once and records raid-invite state; (2) still records when Discord rejects the DM |
| Reason | Empty `raidInvites` sync lane removed; Raid Invites travel as `notificationDms` only. `recordRaidInviteSent` kept via notification DM delivery. |
| Equivalent coverage | `tests/integration/services/notification-raid-invite.test.ts` (creates RAID_INVITE, delivers via `notificationDms`, records sent); `sync-voice.test.ts` / `sync-start-post.test.ts` same-pass Raid Invite + voice linking; remaining `sync-loop` notificationDm paths. |
| Production contract lost? | **No** for delivery; the empty parallel lane is gone by design. **Co-deploy web+bot required** (documented). |
| Restore? | **Not required.** |

### Accounting check

| Source | Files | Tests |
| --- | --- | --- |
| `e2a0979` dead modules | −3 | −21 (7+4+10) |
| `cc14bdf` A19 sync-loop describe | 0 | −2 |
| **Total** | **−3** | **−23** |

`PHASE-6.md` previously attributed all −23 to deleted unit suites; corrected in this acceptance pass.

**No accidental coverage removal found. No restores performed.**

---

## 2. Six-phase verification matrix

Statuses: **VERIFIED** | **PARTIALLY VERIFIED** | **NOT VERIFIED** | **FAILED**

| Phase | Report claim | Acceptance status | Classification of work | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Tests centralized under `tests/` | **VERIFIED** | Implemented and validated | Commit `1c10d74`; `vitest` include `tests/**/*.test.ts`; `git ls-files` / live glob: 0 `*.test.ts` under `src/`; 338 files now (341 after move) |
| 2 | Every suite decided; `setDraftSelection` removed; ×2 green | **VERIFIED** | Implemented and validated | Decisions: KEEP 254 / REWRITE 84 / REMOVE 4 file entries, **0 UNREVIEWED** in `test-ledger.tsv`; `setDraftSelection` absent from `src/`; test-local adapters call `rosterService.saveDraftSelection`; Phase 2 ×2 claimed in `PHASE-2.md` (341/3824) |
| 3 | A18, A19, dead modules, naming | **VERIFIED** | Implemented and validated | `11fc614` (0 remaining `tx.orm as { public` casts); `cc14bdf` (`raidInvites` absent from `src/`); `e2a0979`; `8666f32` rename |
| 4 | Security/perf/reliability | **PARTIALLY VERIFIED** | Mix: implemented + inspected + deferred | Lodash override `2e98b8c` → `npm audit --omit=dev` **0**; headers in `next.config.ts` (`f95b223`); rate-limit log `2af7419` / `client.ts`; **perf numbers not re-measured** this review (Batch 8 / `d350f5b` ledger only); CSP / Apache deferred (A16 later closed on owner approval) |
| 5 | Docs + UX foundations | **VERIFIED** (docs) / deferred UX | Implemented docs; inspected UX; deferred redesigns | API/DEVELOPER/HANDOVER A19 wording; `(app)/error.tsx`, `loading.tsx`, root `not-found.tsx` present; A12/A14 deferred as stated; `hardcoding-findings.md` intentionally not authored |
| 6 | Full suite ×2, lint/tsc/build, readiness | **VERIFIED** (gates) with doc errata | Validated on acceptance re-run | Fresh ×2 below; inventory attribution corrected; open items remain owner decisions |

### Per-claim nuance (do not treat report DONE as proof)

| Claim type | Examples | Acceptance reading |
| --- | --- | --- |
| Implemented and validated | A18, A19, dead-module delete, lodash override, `setDraftSelection` removal, suite ×2 | Code + history + re-run confirm |
| Inspected with no defect found | UX file presence, security headers content, isolation helpers | Present; not redesigned |
| Documented but not corrected | Missing CSP, Apache `X-Powered-By`, hardcoding findings doc | Still open (A16 later closed on owner approval) |
| Deferred | A12 reload policy, A14/A15 splits, naming ownership, CSP inventory | Explicit |
| Not verified (by this review) | Batch 8 payload/purge timings as live numbers; production journal rate-limit | Evidence is historical ledger / deploy-gated |

---

## 3. Security acceptance — owner items

### A16 — `src/lib/gold.ts`

| Aspect | Finding |
| --- | --- |
| Acceptance-time state | Single export `formatGold(amount)`; **no callers** in `src/` or `tests/`. |
| Post-acceptance resolution | **Owner approved delete.** File removed on `test/audit-batch-a`. No exclusively associated tests existed. |
| Validation | `lint`, `typecheck`, `build`; repo-wide search shows no remaining imports of `formatGold` / `@/lib/gold`. |
| Status | **Done** — closed. |

### Content Security Policy

| Aspect | Finding |
| --- | --- |
| Current implementation | **No CSP** in `next.config.ts`. Present headers: HSTS (`max-age=15552000`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo disabled), `poweredByHeader: false`. |
| Concrete risk | Weaker XSS defense-in-depth if a future XSS sink appears; React escaping + existing headers mitigate common cases but do not replace CSP. |
| Severity | **Medium** (defense-in-depth gap), not an observed exploitable defect in this review. |
| Production readiness | **Documented risk**, not a silent blocker for the audited branch. Shipping an enforcing CSP **without** an inline-script / image-host inventory can break Discord CDN images and Next inline assets. |
| Safe to fix on audit branch? | **No enforcing CSP** without inventory. Report-Only without a report sink adds noise without benefit. |
| Required validation | Inventory → Report-Only in staging → enforce → header unit test update. |
| Action this pass | Operator note in `docs/OPERATIONS.md` security checklist. |

### Apache `X-Powered-By: PleskLin`

| Aspect | Finding |
| --- | --- |
| Current implementation | App suppresses Next’s header. Apache/Plesk may still add `PleskLin` (hosting panel). No tracked Apache vhost in repo. |
| Concrete risk | Minor stack fingerprinting / information disclosure. |
| Severity | **Low**. |
| Production readiness | **Does not block** application readiness; fix is host config. |
| Safe to fix on audit branch? | **Cannot** change live Apache (forbidden). Docs-only guidance is safe. |
| Required validation | After panel change: `curl -sI https://… \| findstr /I X-Powered-By` shows none. |
| Action this pass | Notes in `docs/OPERATIONS.md` and `docs/DEPLOYMENT.md` smoke checklist. |

### Deployment-time rate-limit journal check

| Aspect | Finding |
| --- | --- |
| Current implementation | `logRateLimit` on `RESTEvents.RateLimited` in `src/discord-bot/client.ts` (`[discord-bot] rate limited` JSON fields). Unit: `tests/unit/discord-bot/client-rate-limit.test.ts`. |
| Concrete risk | 15–25 s Discord sync stalls hypothesized from REST waits remain **unconfirmed in production** until journals are read post-deploy. |
| Severity | **Low–Medium** operational (latency), not an authz hole. Code instrumentation is present. |
| Production readiness | **Does not block** code acceptance; blocks *confirmation* of the stall hypothesis until deploy. |
| Safe to fix on audit branch? | Logging already shipped (`2af7419`). Journal inspection needs live host (out of scope). |
| Required validation | Post-deploy: `journalctl -u boostinghub-discord-bot --since "1 hour ago" \| grep 'rate limited'`. |
| Action this pass | Smoke + OPERATIONS notes added. |

**No security finding above was marked non-blocking without a reason.** None required an unauthorized live-infra change at acceptance time. A16 was later deleted on explicit owner approval; CSP and host Apache header remain owner/ops items.

---

## 4. Performance evidence

| Conclusion | Measured? | Evidence |
| --- | --- | --- |
| Run detail RSC data 91 KB → 66 KB | **Historical measurement** (Batch 8 / ledger), not re-measured in Phase 4 or this acceptance | `docs/audit/EXECUTION_LEDGER.md` Batch 8; commit `d350f5b` |
| Run detail HTML 241 KB → 213 KB | Same | Same |
| Event purge 5000 rows ~15.8 s → ~15 ms | Same | Same |
| Event purge 200 rows ~670 ms → ~2 ms | Same | Same |
| Phase 4 “no new production-facing perf change” | **Inspected** | Phase 4 only added lodash override (`2e98b8c`) |
| Live production perf after deploy | **Not measured** | Deploy forbidden |

**Areas only statically inspected this acceptance:** current purge/batch code paths, Next bundle sizes, Discord sync timing.  
**Do not claim new measured improvements from Phase 4 or this review.**

---

## 5. Test and reliability evidence

### Individual review of remaining cases

| Claim | Status |
| --- | --- |
| Phase 2: 0 UNREVIEWED ledger rows | **VERIFIED** (ledger scan) |
| Acceptance re-read of every suite body | **NOT VERIFIED** — out of scope for a single acceptance pass; relied on ledger completeness + spot checks of concurrency/auth/isolation |

### Database isolation

| Check | Result |
| --- | --- |
| Fail-closed pin | `TEST_DATABASE_EXPECTED_NAME=boostting_bot_test_audit` active in acceptance shell |
| Live DB | `select current_database()` → `boostting_bot_test_audit` |
| Helpers | `assertIsolatedTestDatabase`, `deleteAndCount`, `waitForLockWaiter` in `tests/fixtures/db-fixtures.ts` |
| Note | Checked-in `.env` file still lists `boostting_bot_test`; process env / pin overrides for audit runs. Operators must keep the pin set when claiming audit-DB evidence. |

### Full suite ×2 on the same DB without reset (acceptance re-run)

| Run | Result | Duration | Log |
| --- | --- | --- | --- |
| 1 | **338 files / 3801 tests passed** | 553.03 s | `docs/audit/reports/_acceptance-suite1.log` |
| 2 (immediate, no `test:db:reset`) | **338 files / 3801 tests passed** | 517.75 s | `docs/audit/reports/_acceptance-suite2.log` |

Commands:

```text
# pin already set in process env
npm test   # run 1 → _acceptance-suite1.log
npm test   # run 2 → _acceptance-suite2.log  (no reset between)
```

Also: `npm run lint` pass; `npm run typecheck` pass; `npm audit --omit=dev` → 0 vulnerabilities.

Prior Phase 6 logs (`_p6-suite*.log`) were untracked and not present at acceptance start; **this re-run is the authoritative ×2 evidence**.

### Critical concurrency / authorization coverage

Still present (non-exhaustive): `roster-reservation-concurrency`, `run-lifecycle-concurrency`, `roster-pre-start-replacements` (lock waits), attendance lock paths, ~102 authz-related suites (FORBIDDEN/requireAdmin/etc. grep). Spot-checked adapters still call production `saveDraftSelection`.

### Test-only production bypass

| Check | Result |
| --- | --- |
| `rosterService.setDraftSelection` in `src/` | **Absent** (`8892f4f`) |
| Test helpers named `setDraftSelection` | Local adapters → `saveDraftSelection` only |
| Auth bypass flags | No test-only production auth bypass reintroduced in sampled paths |

---

## 6. Verification matrix (summary)

| Area | Status |
| --- | --- |
| Phase 1 | **VERIFIED** |
| Phase 2 | **VERIFIED** |
| Phase 3 | **VERIFIED** |
| Phase 4 | **PARTIALLY VERIFIED** (deps/headers/logging yes; perf numbers historical; owner security items open) |
| Phase 5 | **VERIFIED** (docs/UX presence); deferred items explicit |
| Phase 6 gates | **VERIFIED** (re-run); inventory text corrected |
| Removed-test reconciliation | **VERIFIED** |
| A16 gold.ts | **VERIFIED** closed — deleted on owner approval; no callers |
| CSP | **PARTIALLY VERIFIED** (absence confirmed; fix deferred) |
| Apache X-Powered-By | **PARTIALLY VERIFIED** (app-side fixed; host side docs-only) |
| Rate-limit journal | **PARTIALLY VERIFIED** (code present; production journal **NOT VERIFIED**) |
| Perf improvements claimed in Phase 4 | **PARTIALLY VERIFIED** (historical Batch 8 only) |
| Every test body re-reviewed by acceptance | **NOT VERIFIED** |
| Accidental coverage loss | **VERIFIED** none; no restore |

---

## Corrections made in this acceptance pass

1. Corrected Phase 6 −23 test attribution (`PHASE-6.md`).
2. Operator docs for Apache `X-Powered-By`, CSP caution, and rate-limit journal checks (`OPERATIONS.md`, `DEPLOYMENT.md`).
3. Fresh suite ×2 evidence logs committed under `docs/audit/reports/_acceptance-suite*.log`.
4. Reports index updated.

No production modules restored at acceptance. A16 later deleted on owner approval. No CSP shipped. No live infrastructure touched.

---

## Final verdict

### **ACCEPTED WITH DOCUMENTED RISKS**

The six-phase audit on `test/audit-batch-a` is acceptance-ready as an audit completion: structural move, test decisions, production cleanups (A18/A19/dead modules/`setDraftSelection`), dependency audit, and quality gates hold under independent re-validation (338/3801 ×2 on `boostting_bot_test_audit` without reset).

**Documented risks / owner actions before or after merge (not silent):**

1. ~~Decide A16 (`gold.ts`)~~ — **Done** (deleted on owner approval).
2. CSP inventory then staged rollout.
3. Host: unset Apache/Plesk `X-Powered-By`.
4. After co-deploy of web+bot: inspect Discord rate-limit journal lines.
5. Treat Batch 8 perf numbers as historical until re-measured on a chosen environment.
6. Optional: commission `hardcoding-findings.md` / A12–A15 product decisions.

**Stop here.** No merge, deploy, production data change, live Discord operation, history rewrite, or new repository. Await owner decision on release path.
