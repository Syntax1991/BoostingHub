# Content Security Policy preparation

| Field | Value |
| --- | --- |
| Branch | `test/audit-batch-a` |
| Status | **Report-Only prepared** in `next.config.ts` (not enforcing). Confirmed: no `Content-Security-Policy` enforcing header |
| Owner decision | Required before flipping to `Content-Security-Policy` (enforcing) or changing host-panel CSP |
| Canonical docs | Product truth remains the six `docs/*.md` files; this file is audit prep only |
| Related | [OPERATIONS.md § Content Security Policy](../OPERATIONS.md#content-security-policy), [DEVELOPER.md § Technical decisions](../DEVELOPER.md#technical-decisions) |

## Contents

- [Inventory](#inventory)
- [Proposed Report-Only policy](#proposed-report-only-policy)
- [What is not covered](#what-is-not-covered)
- [Validation](#validation)
- [Owner rollout](#owner-rollout)

## Inventory

Observed from current application code and config (static review; no production browser report collection on this branch).

| Surface | Finding |
| --- | --- |
| Scripts | Next.js App Router / Turbopack build. No `dangerouslySetInnerHTML` script injection found under `src/`. No third-party analytics scripts in `src/app/layout.tsx`. |
| Styles | Tailwind / global CSS. Inline style attributes are used in components → `style-src` needs `'unsafe-inline'` for Report-Only compatibility. |
| Fonts | `next/font/google` (`Geist`, `Geist_Mono`) in `src/app/layout.tsx` — self-hosted by Next at build time → `font-src 'self'`. |
| Images | `next.config.ts` `images.remotePatterns`: `https://cdn.discordapp.com`. Guide publishers also allow `media.discordapp.net`. Discord avatars / guide assets. |
| Auth redirects | Discord OAuth (Better Auth) → `https://discord.com`. Battle.net OAuth → `https://oauth.battle.net` and regional Battle.net hosts. |
| Server-side HTTP only (not browser CSP) | Raider.IO, Warcraft Logs API, Blizzard Game Data — browser pages may still open `https://www.warcraftlogs.com` / `https://raider.io` as user-facing links (`img`/`connect` not required for navigation, but `connect-src` kept tight to app + Discord/Battle.net OAuth). |
| Frames | App should not be framed → `frame-ancestors 'none'` (aligns with `X-Frame-Options: DENY`). |
| Existing headers | HSTS, nosniff, frame deny, referrer, permissions; `poweredByHeader: false`. |

## Proposed Report-Only policy

Shipped as header `Content-Security-Policy-Report-Only` (same value as below). **No report-uri / report-to endpoint is configured** on this branch — violations appear only in browser consoles until the owner adds a collector.

```text
default-src 'self';
base-uri 'self';
frame-ancestors 'none';
object-src 'none';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net;
font-src 'self' data:;
connect-src 'self' https://discord.com https://oauth.battle.net;
form-action 'self' https://discord.com https://oauth.battle.net;
upgrade-insecure-requests
```

Notes:

- `'unsafe-inline'` / `'unsafe-eval'` on `script-src` are deliberate for Next.js compatibility until a nonce/hash strategy is proven. They weaken XSS defense; Report-Only exists to measure breakage before tightening.
- Regional Blizzard profile hosts are not listed: browser pages do not call them directly (server integrations do).
- Do not copy this policy into Apache as an **enforcing** header independently of the Next app.

## What is not covered

- Production browser violation telemetry (no report endpoint).
- Tightening to nonce-based `script-src` (requires Next CSP integration work).
- Hosting-panel CSP that could fight the app header.

## Validation

- Unit: `tests/unit/next-config.test.ts` asserts Report-Only header presence and existing security headers.
- `npm run lint`, `typecheck`, `build` after the CSP code commit.
- Browser Report-Only observation requires a deployed or local production build — **not** done as a live production change in this audit.

## Owner rollout

1. Ship Report-Only with web deploy (co-deploy bot if the release also contains A19).
2. Browse primary flows: Discord sign-in, Battle.net connect, Characters, Runs, Discord avatar images.
3. Collect console Report-Only violations; adjust allowlist or move to nonces.
4. Flip header name from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in a dedicated change with test update.
5. Keep Apache from injecting a conflicting CSP.
