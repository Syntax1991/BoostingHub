# Phase 4 — Performance, security, reliability

## STATUS

- **Phase:** 4 — Performance, security, reliability
- **Result:** DONE
- **Completion criteria:** Satisfied on branch `test/audit-batch-a` (2026-11-02)

Earlier audit batches already shipped the major Phase 4 hardening (security headers, bot body non-logging, rate-limit diagnostics, event-purge performance, app error/loading/not-found). This phase **re-verified** that work with live evidence, closed the remaining production `npm audit` high (`lodash`), and recorded what stays deferred (CSP study, A16 owner decision, Apache `X-Powered-By`, production Discord rate-limit confirmation after deploy).

## GIT

| Item | Value |
| --- | --- |
| Branch | `test/audit-batch-a` |
| New this phase | `2e98b8c` — `overrides.lodash = 4.18.1` |
| Prior (already on branch) | Batch 3 security headers + A3; Batch 8 perf + rate-limit log; Batch 7 `error`/`loading`/`not-found` |

## WORK COMPLETED

### Security (verified + extended)

| Item | Status | Evidence |
| --- | --- | --- |
| A2 security headers | Present | `next.config.ts`: HSTS 15552000s, nosniff, `X-Frame-Options: DENY`, referrer + permissions policies; `poweredByHeader: false` |
| A3 non-JSON body logging | Fixed earlier | `bot-api-client` logs status/content-type only — no body slice |
| Bot route auth | Covered | `bot-route-credentials` suite (prior); unit smoke this phase |
| Production npm audit | **Closed this phase** | Was 1 high (`lodash` ≤4.17.23 via discord.js / prisma tooling). Override to `4.18.1` → `npm audit --omit=dev` **0 vulnerabilities** |
| CSP | Deferred | Still needs inline-script/image inventory before ship |
| Apache `X-Powered-By: PleskLin` | Out of app scope | Server config, not Next |

### Performance (prior measurements retained)

From Batch 8 (local production build on seed DB; production unchanged until deploy):

| Item | Before | After |
| --- | --- | --- |
| Run detail RSC data | 91 KB | 66 KB |
| Run detail HTML | 241 KB | 213 KB |
| Event purge 5000 rows | ~15.8 s | ~15 ms |
| Event purge 200 rows | ~670 ms | ~2 ms |

No new production-facing perf change this phase — prior wins remain the baseline. Re-measurement against live production requires a deploy (out of authorization).

### Reliability

| Item | Status |
| --- | --- |
| Discord REST rate-limit logging | Present: `logRateLimit` on `RESTEvents.RateLimited` in `discord-bot/client.ts` |
| Unit coverage | `tests/unit/discord-bot/client-rate-limit.test.ts` passes |
| Slow sync-pass hypothesis | Still deploy-gated: `journalctl … \| grep 'rate limited'` after ship |
| App error / loading / not-found | `src/app/(app)/error.tsx`, `loading.tsx`; root `src/app/not-found.tsx` |

### Explicitly not changed

- **A16 `src/lib/gold.ts`:** still unreferenced; payouts removed in #228 — **owner decision** required before delete.
- **A12 `window.location.reload`:** kept (client state reset after run actions); `router.refresh` substitution needs per-site review.
- **A14/A15** large-file splits: deferred (need dedicated test-backed splits).

## QUALITY AND VALIDATION

| Check | Result |
| --- | --- |
| `npm audit --omit=dev` | 0 vulnerabilities (after lodash override) |
| `npm ls lodash` | `4.18.1 overridden` under discord.js / prisma tooling |
| `tests/unit/next-config.test.ts` | Pass |
| `tests/unit/discord-bot/client-rate-limit.test.ts` | Pass |
| `npm run lint` / `typecheck` / `build` | Pass at Phase 3 close; lodash override is lockfile-only |

## FINDINGS

- Production dependency risk was a single transitive high; npm overrides are the correct fix while discord.js / shapeshift stay on their ranges.
- Full `npm audit` (including dev) still reports tooling advisories — out of production scope for this gate; do not run blind `npm audit fix` (dry-run attempted to strip hundreds of packages).
- Rate-limit logging is necessary but not sufficient proof of the 15–25 s sync stalls until production journals are inspected post-deploy.

## NEXT PHASE

- **Phase 5 — UX and documentation**
- Align DEVELOPER/API/HANDOVER with A19 removal and Phase 2–4 outcomes; UX polish items that do not require product redesign; then `PHASE-5.md`.

## RELEASE SAFETY

No merges, deployments, production database writes, live Discord operations, force-pushes, history rewrites, or new repository creation. Dependency override is lockfile-scoped and verified with `npm audit --omit=dev`.
