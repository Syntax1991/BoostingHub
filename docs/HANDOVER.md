# BoostingHub handover

For the next developer and operator: the real state of the project, what is unfinished, and what you must take over. Written 2026-11-01 and updated 2026-11-02. Statements about the live server were last checked read-only on 2026-11-02 and will age; confirm them first.

This repository is public, so concrete server details, access data and secret values are not here. They are handed over privately.

## Contents

- [Project status](#project-status)
- [Production and disabled features](#production-and-disabled-features)
- [Known bugs and limitations](#known-bugs-and-limitations)
- [Technical debt](#technical-debt)
- [Open pull requests](#open-pull-requests)
- [Open decisions](#open-decisions)
- [Open follow-up ideas](#open-follow-up-ideas)
- [Security risks](#security-risks)
- [Planned access separation](#planned-access-separation)
- [Handover to the new maintainer](#handover-to-the-new-maintainer)
- [AI-assisted development](#ai-assisted-development)

## Project status

- Since 2026-11-01 the project is in a **final feature freeze**, because the owner is stepping away from World of Warcraft. The goal is a stable handover. No new features are planned.
- Stack: Next.js, React, TypeScript, PostgreSQL, Prisma 8 (release candidate), Better Auth, discord.js. Details: [DEVELOPER.md](DEVELOPER.md).
- The app runs on one Linux server with a web process, one Discord bot process and four systemd timers. See [OPERATIONS.md](OPERATIONS.md).
- Last recorded production release: `da5df27` (new Discord guides and replace flow, PR #321), deployed 2026-11-02 with no migrations. It includes the `db:seed` production guard from PR #322, deployed the same day as `0fd2080`. Automated production checks and signed-in pages passed after the deploy. A fresh Discord login was last done on 2026-11-01, on the `a596c8e` release, not since.

## Production and disabled features

**In production (per code and last release):** Discord login, Characters with Blizzard lookup and Battle.net link, Boosting Roles and Discord role sync, Run creation, Products and Run Setups, Community Schedule, web and Discord signups, roster tools (Add Booster, Externals, Auto Build, Find replacement, Ping roles), Start, attendance and replacement, Warcraft Logs Consumables Audit with automatic linking, notifications, Quiet Hours, Raid Catalog imports, analytics and system health, scheduled sync, backups.

**Built but disabled or dormant:**

| Item | State |
| --- | --- |
| Boss-specific roster exceptions | Behind `ROSTER_BOSS_EXCEPTIONS_ENABLED`; recorded as off in production, with no stored rows. Follow-ups never done: versioning on Run edits, attendance replacement beyond the current rule. Before enabling, read [Boss-specific exceptions](DEVELOPER.md#boss-specific-exceptions). A rollback must handle stored rows |
| Self-service Booster requests | Disabled (`BOOSTER_ACCESS_SELF_REQUEST_DISABLED`); old requests remain as history |
| Legacy single-channel Discord mode | Fallback only when no Run category is set |

**Shipped but not yet observed in real use:** Late Fill, Smart Replacement and the Roster Diff had not been seen under real use at last check. A real test of Ping roles was still pending. Check them at first real use.

**Removed on purpose:** the payout and settlement domain. **Cancelled:** the Raidlead Teams feature; only its first PR (attendance and Edit Run concurrency protection, #317) shipped.

## Known bugs and limitations

- A full test run on a database without reset failed four tests once, while another session was active (cause unproven). Those files passed alone, and the suite passed after a reset. Use `npm run test:full`.
- The production web log shows recurring bursts of exactly 25 "Server Reference ID did not match" lines, each saying it received `x`, for example seven bursts between 2026-11-01 and 2026-11-02. They look like automated Server Action probing, not an app failure. The source was not traced.
- The Discord guides were replaced on 2026-11-02 with the flow in [OPERATIONS.md](./OPERATIONS.md#replacing-a-guide-with-new-messages): 5 Booster and 6 Raid Lead messages, verified through the Discord API. Replacing needs the channels to hold only this bot's guide messages. There is no undo or restore command; the old text and images are in the replace snapshot folders on the server.
- **Add strike on the Run page looks unreachable.** `AddStrikeButton` only renders in the manager signup list, and `run-detail-tabs.tsx` shows that list only to viewers who are not managers. So in practice Strikes are added on `/manage/users/[userId]`, which means by Admins. Found by reading the code, not reproduced in a browser, and not fixed because the freeze excludes logic changes.
- External boosters have no Warcraft Logs identity and are shown as "Log data unavailable".
- The voice-presence hint assumes one web process.
- Realm transfers are refused, not handled automatically.
- Deactivating a Character does not withdraw its future signups.

## Technical debt

- **Prisma 8 release candidate** in production. Better Auth needs `--legacy-peer-deps` because of it.
- **No CI, no branch protection, no dependency updates automation.** Checks run only locally.
- **Stale comments:** `.env.example` describes the old difficulty-based bootstrap and an older Warcraft Logs use; `GET /api/bot/runs/:runId/start` mentions gold collectors.
- **Legacy kept for compatibility:** `lootType` as the name of Run type, `RunTemplate` for Run Setup, generic `DPS` role rows, Character-backed Lootbuddy rows, `BoosterAccess` history, `raidInvites` always empty in the sync payload, `User.discordRunChannelNickname` unused, `runService.createRun` used only by tests, `clear-channel` no longer used for retirement.
- **Naming:** BoostingHub, Manawyrm Hub, `boostting-bot` and a Discord emoji named `PhoenixStarDiscord` all still exist.
- **Screenshots:** the Discord guides use redacted production images from 2026-11-01 (`live-*.png`), which show real run dates and counts that will age, plus `rl-09-finish-run.png` from the local test system. The other images, used by `USER.md`, were recaptured on 2026-11-01 from a fresh seed database, without real names or the removed Payout tab. The seed's Run dates are fixed and lie in the past, so the capture scripts' default views of `/runs` and `/my-runs` come out empty; `bo-03`, `bo-04`, `bo-05` and `rl-02` were taken with `?id=all`, and there is no capture script for `common-01-login.png`. The old images remain in Git history.
- **Large files:** `src/discord-bot/sync-loop.ts` and `run.service.ts` have grown large.
- **Duplicate scripts:** the Booster and Raid Lead publish scripts, and the two screenshot capture scripts, are near copies. `capture-raidlead-guide-screenshots.mts` still looks for the old **Save Roster** label, then falls back. Neither capture script limits `--base-url` to local hosts.
- **Deployment script tests** run only by hand, because there is no CI.

## Open pull requests

None once this documentation update is merged. The last feature PR, #321, was merged on 2026-11-02.

## Open decisions

| Decision | State |
| --- | --- |
| Repository restart | Planned: new repository `Syntax1991/ManawyrmHub` with one clean commit, after the planned refactoring. The existing repository is kept. **Not implemented and not approved.** Conditions in [DEPLOYMENT.md](DEPLOYMENT.md#planned-repository-restart) |
| `production` branch | Planned, see below. Today everything deploys from `main` |
| Secret rotation timing | Open; see below. Rotating `BETTER_AUTH_SECRET` ends sessions unless the old value stays configured as a legacy secret |
| Enabling boss exceptions | Open; not needed for the freeze |
| Off-site backups | Open: a destination and encryption key still have to be chosen. Nothing has been copied off the server |
| Scope of the Discord bot's permissions | To be reduced when a new community or operator takes over |

## Open follow-up ideas

Not commitments. From the former roadmap:

- Optional per-setup "open signups on create" for Schedule Drafts
- Planned-versus-staffed metric on the Manage Runs list (the Schedule already shows it)
- Date-range controls for analytics
- A reliability summary for Raid Leads (attendance, consumables, strikes, logs), without money

## Security risks

Named as classes on purpose. Details and evidence go to the new maintainer privately. Verify each one before acting.

| Risk | Needed action | Owner |
| --- | --- | --- |
| Server access hardening is incomplete, and root access depends on one key on one machine | Give the new operator their own verified access first, then harden login and remove old access. Never the other way round | New operator |
| No independent console access for the current maintainer | Take over the provider account; until then keep server changes minimal | New operator |
| Backups only on the production host. An isolated restore test passed on 2026-11-02 on that host (see [OPERATIONS.md](OPERATIONS.md#testing-a-backup-without-touching-production)): 54 tables, 576 columns, 241 constraints and 204 indexes matched production, and row counts matched in 53 of 54 tables, with `integration_event` growing after the backup as expected. If that host is lost, the backups are lost with it | Add encrypted off-site copies and repeat the restore test from them | New operator |
| Secrets were reachable from development and AI tooling, and local and production values overlapped | Rotate all production secrets during takeover, in a planned order | New operator |
| GitHub owner credentials were available to AI tooling | See [Planned access separation](#planned-access-separation) | Owner |
| Release helper runs an app-writable script as root; server installs dev dependencies | Move to a root-owned helper; review dependency install | New operator |
| Known dependency advisories remain. `lodash` 4.17.21 (high) is indirect: the bot reaches it through `discord.js` and `@sapphire/shapeshift`, which import only `get` and `uniqWith`, not the affected `template`, `unset` or `omit`. Development tools also pull it in, and the server installs those | Re-run `npm audit`, and update it in a separate tested change | Maintainer |
| Public repository history holds operational details and a personal commit e-mail. On 2026-11-01 Gitleaks and TruffleHog (offline, unverified mode, history including PR refs) found **no confirmed credential**: only Discord ids misread as client ids, and the password fixture in `deploy/production/backup-db.test.sh`, which is also what GitGuardian flagged on PR #86. On 2026-11-02 Gitleaks 8.28.0 ran again over the tracked files and all refs including PR refs (909 commits scanned, merge commits have no separate diff scan): **no confirmed credential**. Every finding was reviewed: 18-digit numbers in test files, which are not credentials but were not each proven to be made up; an empty `DISCORD_BOT_TOKEN` in `.env.example`; and plain words in a table of the removed `docs/features/blizzard-integration.md` (commit `0c23031`, only on the ref of PR #8, not on `main`). Scanners match patterns and do not test whether a value still works. Prod-only and old secrets were not compared, and the GitGuardian dashboard status is not visible from the repository | Repeat the scans at the snapshot checkpoint; treat exposed information as public | Owner |
| Discord bot permissions are broader than the documented minimum | Scope down | New operator |

**Remaining public identifiers in tracked files** (no secrets): the guild and guide channel ids in `src/discord-bot/guide-channels.ts`, the app URL in `deploy/update-server.sh` and the guides, and the Guild emoji name `PhoenixStarDiscord` the bot looks up. They are working configuration. Moving the Discord ids to the environment would be a small separate change worth making when a new community takes over; it brings no security gain on its own. Test fixtures, comments and `.env.example` now use neutral names and ids.

## Planned access separation

Planned, **nothing is changed yet**:

1. A separate, restricted GitHub account for AI tooling, with write access to work branches only. Prove by a negative test that it cannot push to protected branches.
2. Remove the owner token and related allowlist entries from the AI environment.
3. A protected `production` branch: no force pushes, no deletion, merges only after review by the owner or a maintainer, tagged releases.
4. CI (lint, typecheck, tests, build) as a required check.
5. No production deploys by AI tooling: remove root credentials and deploy commands from its environment.
6. The deploy helper switches to `production` as a separate, tested change.

## Handover to the new maintainer

Take over, in this order:

1. **Provider account, DNS, firewall, panel and TLS certificate.** The current maintainer has server login but no provider account.
2. **Your own SSH access**, verified with a second session. Only then remove old access. Do not change SSH or firewall settings during unrelated work.
3. **Read-only check:** commit, services, timers, feature switch, backups, open ports.
4. **Backups:** off-site copy and a restore test.
5. **Secrets:** rotate after the access change. `.env` is never sourced or printed; use `env-status.py`.
6. **GitHub:** access separation, protection, CI, then the repository decision.
7. **Discord and game APIs:** bot application, OAuth clients, Battle.net and Warcraft Logs clients, roles and channels. Private handover lists them.

First read: [DEVELOPER.md](DEVELOPER.md) up to the data model, then [DEPLOYMENT.md](DEPLOYMENT.md) and [OPERATIONS.md](OPERATIONS.md).

## AI-assisted development

This project was developed largely with AI coding assistants: **Claude Code** (Anthropic) and, earlier, **Cursor**. Commits and PRs often carry their co-author trailers. `AGENTS.md`, `CLAUDE.md` and `.cursor/rules/` are agent instructions and are still tracked.

What this means for you:

- Code, tests and this documentation were largely generated by AI and reviewed by one person. There was no independent code review and no CI.
- Expect thorough tests and detailed comments, but also large files and leftovers from changed decisions. Trust the code over comments.
- AI tools had broad access during development, including owner-level GitHub rights and root access to the production server. That is why access separation and secret rotation are part of this handover.
- This documentation was checked against the code on a sample of risky statements and known contradictions, not line by line.
