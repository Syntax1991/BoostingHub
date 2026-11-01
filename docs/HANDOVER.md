# BoostingHub handover

For the next developer and operator: the real state of the project, what is unfinished, and what you must take over. Written 2026-11-01. Statements about the live server come from the last recorded release and were **not re-checked when this was written**; confirm them first.

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
- Last recorded production release: `418fd7b` (security dependency update, PR #318), deployed 2026-11-01. The owner's production smoke test passed, including a real Discord login and session survival. `main` is ahead of production only by documentation, comments, guide text, four bot messages, test changes and removed one-off scripts; they reach the server with the next normal release.

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
- The production web log showed a burst of "Server Reference ID did not match" lines on 2026-11-01. The origin was not traced; it looks like invalid Server Action probing, not an app failure.
- The guide channels in Discord still show the old text and screenshots until someone runs `npm run guide:booster:publish` and `npm run guide:raidlead:publish` after the next release. Source and `USER.md` already agree.
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
- **Screenshots:** recaptured on 2026-11-01 from a fresh seed database, without real names or the removed Payout tab. The seed's Run dates are fixed and lie in the past, so the capture scripts' default views of `/runs` and `/my-runs` come out empty; `bo-03`, `bo-04`, `bo-05` and `rl-02` were taken with `?id=all`, and there is no capture script for `common-01-login.png`. The old images remain in Git history.
- **Large files:** `src/discord-bot/sync-loop.ts` and `run.service.ts` have grown large.

## Open pull requests

None. The last one, #297, was merged on 2026-11-01.

## Open decisions

| Decision | State |
| --- | --- |
| Repository restart | Planned: new repository under the same name, existing one as private archive. **Not implemented and not approved.** Conditions in [DEPLOYMENT.md](DEPLOYMENT.md#planned-repository-restart) |
| `production` branch | Planned, see below. Today everything deploys from `main` |
| Secret rotation timing | Open; see below. Rotating `BETTER_AUTH_SECRET` ends sessions unless the old value stays configured as a legacy secret |
| Enabling boss exceptions | Open; not needed for the freeze |
| Off-site backups | Open |
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
| Backups only on the production host | Add encrypted off-site copies and test a restore | New operator |
| Secrets were reachable from development and AI tooling, and local and production values overlapped | Rotate all production secrets during takeover, in a planned order | New operator |
| GitHub owner credentials were available to AI tooling | See [Planned access separation](#planned-access-separation) | Owner |
| Release helper runs an app-writable script as root; server installs dev dependencies | Move to a root-owned helper; review dependency install | New operator |
| Known dependency advisories remain: `lodash` (not reachable at runtime per the last review) and development tools | Re-run `npm audit` and decide | Maintainer |
| Public repository history holds operational details and a personal commit e-mail. On 2026-11-01 Gitleaks and TruffleHog (offline, unverified mode, history including PR refs) found **no confirmed credential**: only Discord ids misread as client ids, and the password fixture in `deploy/production/backup-db.test.sh`, which is also what GitGuardian flagged on PR #86. Prod-only and old secrets were not compared, and the GitGuardian dashboard status is not visible from the repository | Repeat the scans at the snapshot checkpoint; treat exposed information as public | Owner |
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
