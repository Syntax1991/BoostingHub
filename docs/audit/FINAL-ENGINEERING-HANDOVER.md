# Final engineering freeze and handover

| Field | Value |
| --- | --- |
| Date | 2026-11-02 |
| Branch | `test/audit-batch-a` |
| Acceptance HEAD | `755c971` (suite evidence + acceptance report) |
| Freeze | This documentation commit on top of `755c971`; branch tip after push is the freeze HEAD |
| Acceptance | [FINAL-ACCEPTANCE-REVIEW.md](reports/FINAL-ACCEPTANCE-REVIEW.md) — **ACCEPTED WITH DOCUMENTED RISKS** |
| Status | **Engineering freeze.** No further audit phases. No merge, deploy, or production action from this document. |

This is the owner-facing freeze note after the six-phase master audit. Broader product/operator handover (access, secrets, Discord apps) remains in [HANDOVER.md](../HANDOVER.md).

---

## 1. Git freeze state

| Check | Result |
| --- | --- |
| Branch | `test/audit-batch-a` |
| Acceptance baseline | `755c971` |
| Remote | Synchronized after this freeze docs commit is pushed |
| Working tree | Documentation-only freeze changes; no unfinished code |
| Phase reports | `PHASE-1.md` … `PHASE-6.md` committed |
| Acceptance | `FINAL-ACCEPTANCE-REVIEW.md` + `_acceptance-suite{1,2}.log` committed |
| Ledger | [EXECUTION_LEDGER.md](EXECUTION_LEDGER.md) committed |

Do not force-push, rewrite history, or open a new repository from this freeze.

---

## 2. Architecture (as left by the audit)

Dependency direction:

```text
View → Controller → Service → Repository / Model / Database
```

| Layer | Location | Notes |
| --- | --- | --- |
| App / UI | `src/app`, `src/components` | Thin controllers; no domain transitions in views |
| Domain | `src/domain` | Pure rules moved out of services where audited |
| Services | `src/services` | Business orchestration |
| Repositories | `src/repositories` | Prisma via `tx.orm.public` (A18) |
| Discord bot | `src/discord-bot` | Calls Bot API; Raid Invites are `notificationDms` only (A19) |
| Tests | `tests/unit`, `tests/integration`, `tests/e2e` | No Vitest suites under `src/` |

Account roles (`USER`, `RAID_LEAD`, `ADMIN`) are not Booster/Lootbuddy identities. Booster eligibility is by class, role, and difficulty. Character lockouts are character + raid + difficulty + reset.

---

## 3. Tests and validation

| Metric | Value |
| --- | --- |
| Live Vitest files | 338 |
| Live tests | 3801 |
| Decision ledger | 0 `UNREVIEWED` rows (`docs/audit/test-ledger.tsv`) |
| Production draft API | `saveDraftSelection` only (`setDraftSelection` removed) |

### Commands (local / audit DB only)

```bash
# Pin the isolated audit database (required for audit evidence)
# TEST_DATABASE_URL → …/boostting_bot_test_audit
# TEST_DATABASE_EXPECTED_NAME=boostting_bot_test_audit

npm run lint
npm run typecheck
npm test                 # full suite; do not point at production
npm test                 # immediate second run without test:db:reset (isolation check)
npm run build
npm audit --omit=dev     # expect 0 after lodash override 4.18.1

# Destructive reset — audit/test DB only, never production
npm run test:db:reset
npm run test:full        # reset then full suite
```

Acceptance evidence (same DB, no reset between runs):  
`docs/audit/reports/_acceptance-suite1.log` and `_acceptance-suite2.log` — **338 / 3801** passed.

---

## 4. Database safety

| Rule | Detail |
| --- | --- |
| Fail-closed test URL | `resolveTestDatabaseUrl()` refuses missing URL, equality with `DATABASE_URL`, non-`test` names, and wrong `TEST_DATABASE_EXPECTED_NAME` |
| Destructive helpers | Call `assertIsolatedTestDatabase()` before wipe/cleanup |
| Audit database | `boostting_bot_test_audit` on the local Postgres used for this audit |
| Production | Never run Vitest or `test:db:reset` against production. Migrations only forward via the release helper |

---

## 5. Deployment prerequisites (owner-approved only)

Engineering left the branch merge-ready from a quality-gate perspective. **Deploy is an owner decision**, not part of this freeze.

Before any production release that includes this branch:

1. Normal PR into the release line (`main` today) — owner approval.
2. **Co-deploy web + Discord bot** (A19 removed empty `raidInvites` from the sync payload).
3. Run [production smoke checklist](../DEPLOYMENT.md#production-smoke-checklist).
4. Optional: rate-limit journal and Apache header checks (below).

Do not create a `production` branch or new repository as part of this freeze.

---

## 6. Completed engineering vs owner/ops tasks

### Completed on `test/audit-batch-a` (do not re-open as audit phases)

| Work | Reference |
| --- | --- |
| Tests moved under `tests/` | Phase 1 / `1c10d74` |
| Suite decisions; isolation; `setDraftSelection` removed | Phase 2 |
| A18 `tx.orm.public`; A19 `raidInvites` lane removed; dead test-only modules deleted | Phase 3 |
| Security headers + bot body non-logging; lodash override; rate-limit logging present | Phase 4 / earlier batches |
| Docs aligned with A19; UX foundations present | Phase 5 |
| Final gates + acceptance ×2 | Phase 6 + acceptance |

### Requires owner approval or live access (not done)

| Item | Why engineering stopped |
| --- | --- |
| Merge to `main` | Owner release decision |
| Production deploy | Forbidden in audit authorization |
| Enforce CSP | Needs inline-script / image inventory; risk of breakage |
| Unset Apache `X-Powered-By: PleskLin` | Hosting-panel / live server config |
| Confirm Discord rate-limit waits in production journals | Needs post-deploy `journalctl` on the live host |
| A12 reload vs `router.refresh`; A14/A15 file splits; naming ownership | Product judgment |
| Access separation, secret rotation, off-site backups | [HANDOVER.md](../HANDOVER.md) |

---

## 7. Remaining owner items (acceptance risks)

### A16 — `src/lib/gold.ts` (closed)

- **State:** **Deleted** on explicit owner approval. Was an unreferenced `formatGold` leftover after payouts removal (#228).
- **Verification:** Repo-wide search found no imports, re-exports, dynamic requires, or tests; `lint` / `typecheck` / `build` after delete.
- **Status:** Done — not an open owner item.

### CSP — Content-Security-Policy

- **State:** Not set. Other headers ship from `next.config.ts` (HSTS, nosniff, frame deny, referrer, permissions; `poweredByHeader: false`).
- **Risk:** Weaker XSS defense-in-depth.
- **Severity:** Medium (gap), not an observed exploit in the audit.
- **Owner action:** Inventory inline scripts and image hosts → Report-Only in staging → enforce. Do not flip on blindly from the panel.

### Apache `X-Powered-By: PleskLin`

- **State:** Next.js header suppressed; Apache/Plesk may still emit `PleskLin`.
- **Risk:** Minor stack fingerprinting.
- **Severity:** Low.
- **Owner action:** In the hosting panel (or `Header unset X-Powered-By`), then verify with response headers. App deploy alone does not fix this.

### Post-deployment rate-limit journal

- **State:** Bot logs `[discord-bot] rate limited` on Discord REST waits (`src/discord-bot/client.ts`).
- **Risk:** 15–25 s sync-stall hypothesis unconfirmed until production journals are read.
- **Severity:** Low–Medium operational latency; not an auth hole.
- **Owner action (after co-deploy):**  
  `journalctl -u boostinghub-discord-bot --since "1 hour ago" | grep 'rate limited'`

Operator notes also live in [OPERATIONS.md](../OPERATIONS.md#security-checklist) and the [DEPLOYMENT smoke checklist](../DEPLOYMENT.md#production-smoke-checklist).

---

## 8. Known risks (short)

| Risk | Notes |
| --- | --- |
| Acceptance documented risks | CSP, Apache header, rate-limit journal (A16 closed) |
| No CI / branch protection | Checks are local only |
| Prisma 8 RC + `--legacy-peer-deps` | Production dependency reality |
| Perf numbers in Phase 4 | Historical Batch 8 measurements; not re-timed at acceptance |
| Feature freeze product bugs | See [HANDOVER.md](../HANDOVER.md#known-bugs-and-limitations) (e.g. Add strike UI reachability) — not reopened by this audit |

---

## 9. Freeze confirmation checklist

- [x] Audit reports + ledger committed on `test/audit-batch-a`
- [x] Acceptance verdict recorded and suite logs present
- [x] Branch synchronized with origin at freeze HEAD
- [x] No unfinished audit code changes pending
- [x] No untracked temporary audit scripts in `docs/audit/reports/`
- [x] A16 `src/lib/gold.ts` removed after owner approval (post-freeze)
- [x] No merge, deploy, production DB, live Discord, or new repository from this freeze

---

## 10. Stop

Engineering work on the master audit is finished. A16 is closed. Await the owner’s decision on merge, the three remaining ops items (CSP, Apache header, rate-limit journal), and any production release.

Primary pointers:

- Acceptance: [reports/FINAL-ACCEPTANCE-REVIEW.md](reports/FINAL-ACCEPTANCE-REVIEW.md)
- Ledger: [EXECUTION_LEDGER.md](EXECUTION_LEDGER.md)
- Product/operator handover: [../HANDOVER.md](../HANDOVER.md)
- Deploy / ops: [../DEPLOYMENT.md](../DEPLOYMENT.md), [../OPERATIONS.md](../OPERATIONS.md)
