# BoostingHub deployment guide

How a release reaches production today, and what happens when one fails. Running services, timers, configuration, monitoring and restores are in [OPERATIONS.md](OPERATIONS.md).

## Contents

- [Contents](#contents)
- [Release process and approvals](#release-process-and-approvals)
- [Build and prerequisites](#build-and-prerequisites)
- [Database migrations](#database-migrations)
- [Deployment scripts](#deployment-scripts)
- [Normal update deploy](#normal-update-deploy)
- [Pre-deploy checks](#pre-deploy-checks)
- [Backups before releases](#backups-before-releases)
- [Initial system setup](#initial-system-setup)
- [Changing systemd units or the backup script](#changing-systemd-units-or-the-backup-script)
- [Rollback](#rollback)
  - [Preferred: revert on main, then deploy normally](#preferred-revert-on-main-then-deploy-normally)
  - [Emergency: run a known-good commit directly](#emergency-run-a-known-good-commit-directly)
- [Production smoke checklist](#production-smoke-checklist)
- [Failed deployments](#failed-deployments)
- [Planned repository restart](#planned-repository-restart)
  - [Checkpoint](#checkpoint)
  - [Planned effects](#planned-effects)
  - [Abort criteria](#abort-criteria)

## Release process and approvals

The current process, as it actually works:

1. Work happens on a branch and reaches `main` through a pull request, squash merged (see [Git workflow](DEVELOPER.md#git-workflow)).
2. There is **no CI** and no branch protection. Lint, typecheck, tests and build run locally. GitGuardian comments on pull requests.
3. Every merge and every production deploy needs an explicit decision by the owner. A documentation-only change needs no deploy.
4. An operator with root access on the server runs the release helper against `main`.
5. The operator runs the [smoke checklist](#production-smoke-checklist).

A protected `production` branch, CI and review duty are planned, not in place. See [HANDOVER.md](HANDOVER.md#planned-access-separation).

## Build and prerequisites

Runtime: Node.js 24 with npm, PostgreSQL 15 or newer (production uses a host package), Python 3 for the ops scripts and PostgreSQL client tools. A full `npm ci` plus build uses most of the memory of a small server, so swap must be present and other heavy work should not run at the same time.

`npm ci --legacy-peer-deps` installs development dependencies too, because the release helper runs `typecheck`, `db:emit` and the `tsx`-based jobs from the same checkout.

The build's Next.js `deploymentId` is the deployed commit (`next.config.ts`; `NEXT_DEPLOYMENT_ID` overrides it). A browser tab still running the previous build is hard-reloaded on its next navigation.

## Database migrations

- Migrations live in `migrations/app/` and are planned with `npx prisma migration plan` (see [Prisma 8 workflow](DEVELOPER.md#prisma-8-workflow)).
- `npm run db:migrate` runs inside the release helper **after** a successful typecheck and build, and **before** any restart. A failure aborts without restarting services.
- Migrations only move forward. Never run a reset, drop the schema or recreate the database as a fix.
- The migration state is tracked by contract hash inside the database, not by Git commit, so it does not depend on commit ids.
- `npm run db:status` lists applied and pending migrations; `npm run db:verify` compares the live database with the contract.

## Deployment scripts

| Path | Purpose |
| --- | --- |
| `deploy/update-server.sh` | **The** release helper for normal updates (see below) |
| `deploy/update-server.test.sh` | Offline tests for the release helper (systemd / git / npm stubbed): timer pause/restore, failure paths, lock, self-update |
| `deploy/production/systemd/*.service`, `*.timer` | Reference copies of the live units (6 services, 4 timers) |
| `deploy/production/backup-db.sh` | Backup script; production runs a root-owned installed copy |
| `deploy/production/env-status.py` | Read-only `.env` check that never prints secret values. Database URLs show only scheme/user/host/port/database; the password and every query-parameter value are hidden. |
| `deploy/production/*.test.sh` | Offline tests for the two scripts above (no DB, no credentials) |
| `scripts/record-backup-telemetry.mts` | Called by the backup script as the app user; records the outcome as an `IntegrationEvent` for `/manage/system`. Best effort, never carries paths or secrets |

**Units and root-owned executables are never installed by a normal deploy.**
`update-server.sh` does not copy unit files, run `systemctl enable`, run
`daemon-reload`, or install anything under `/usr/local/libexec`. Changing any of
those is a deliberate operator step (see [Changing systemd units or the backup
script](#changing-systemd-units-or-the-backup-script)). The live host is
authoritative. Keep the tracked copies identical to what is installed. PR #319 changed
one documentation path in the comments of the tracked units and `backup-db.sh`; until
they are next installed, a `cmp` difference limited to that comment line is expected.

The checkout may contain untracked one-off diagnostic scripts. The release
helper preserves them. They are not part of the supported tooling.

## Normal update deploy

```bash
sudo /var/www/boostinghub/deploy/update-server.sh
```

This is the one supported invocation. The script is tracked executable
(Git mode `100755`, `#!/usr/bin/env bash`, LF line endings enforced by
`.gitattributes`), so the checkout keeps the execute bit after every
fast-forward. Releases before that tracked it as `100644`, which made the
direct call fail with `Permission denied`.

Optional first argument: branch (default `main`). Success ends with
`DEPLOY_OK before=<sha> after=<sha>`. Any failed step aborts, and every later
step is skipped.

Safety contract, in order:

1. Must run as root. Only one deploy at a time (`flock` on
   `/run/lock/boostinghub-deploy.lock`; a second deploy aborts untouched).
2. The web, bot and backup units must exist.
3. `boostinghub-backup.service` must be `Type=oneshot` with
   `RemainAfterExit=no`. Only then does `systemctl start` block until the dump
   finishes and report a real `Result`.
4. The tracked working tree must be clean. Tracked modifications abort; untracked
   operational files are preserved (no `reset --hard`, no `git clean`, no forced
   checkout).
5. Records the full pre-deploy SHA.
5a. **Pause scheduled app jobs**: `boostinghub-character-sync.timer`,
    `boostinghub-community-schedule.timer` and `boostinghub-battlenet-links.timer`
    (their services run `npm run …` /
    `tsx` from the checkout) are stopped if active; enablement is untouched. An
    already-running job service is waited for (bounded, never killed); if it is
    still running after 15 min the deploy aborts before any change. The backup
    timer is not paused (it runs a root-owned installed copy).
6. **Database backup first**: `systemctl start boostinghub-backup.service` and
   require `Result=success` before any Git, dependency or schema change.
7. `git fetch origin --prune`, `git checkout <branch>`, `git pull --ff-only`.
   Anything other than a fast-forward aborts.
8. `npm ci --legacy-peer-deps`
9. `npm run db:emit`
10. `npm run typecheck`, then `npm run build`. Both must pass **before** the live
    schema is touched.
    The build's Next.js `deploymentId` is the deployed commit (`next.config.ts`;
    `NEXT_DEPLOYMENT_ID` overrides): a browser tab still running the previous
    build is hard-reloaded on its next navigation instead of calling the new
    server with old client code (server action IDs are stable across builds).
11. `npm run db:migrate` (never `migrate reset`). A failure aborts before any restart.
12. Restart `boostinghub-web.service`, then `boostinghub-discord-bot.service`.
13. Both must be `active`.
13a. The job runtime must be complete (`node_modules/.bin/tsx` runs and the
     `sync:characters` / `materialize:community-schedule` npm scripts exist);
     only then the timers paused in 5a are started again. A monotonic timer whose
     interval elapsed during the deploy fires once on start (its regular
     catch-up run) — nothing is started manually.
14. `https://manawyrm-boosting.com/` must answer HTTP 200 (with a short startup retry window).

Git operations and npm run as `boostinghub`.

**Failure path (EXIT trap, original exit code preserved).** If the deploy fails
before any code or dependency change (while pausing / waiting, backup), the
paused timers are restarted. If it fails after the checkout changed (npm ci,
emit, typecheck, build, migrate, restart, runtime check), the timers stay
**stopped** — jobs must not run new code against a partial install or an
unmigrated schema — and the output ends with
`after fixing the release run: systemctl start <timers>`. After a failure past
migrate with a complete runtime they are restarted.

**Self-update.** The script's body is one `main()` function and the last line is
`main "$@"; exit $?`, so the `git pull` that rewrites this file during a deploy
cannot corrupt the running deploy. Offline tests: `bash deploy/update-server.test.sh`.

After a deploy, run the [production smoke checklist](#production-smoke-checklist).

## Pre-deploy checks

Before starting the helper:

- [ ] The intended commit is on the target branch, and lint, typecheck, tests and build passed locally.
- [ ] Review the diff for migrations: `git diff --stat <current-sha> <target-sha> -- migrations/`.
- [ ] No Run is about to start and no scheduled job needs to finish first (the helper waits at most 15 minutes for a running job).
- [ ] Unit or backup-script changes are planned as a separate step (below).
- [ ] New environment variables are already in the server's `.env`; check with `python3 deploy/production/env-status.py`.

The helper itself enforces the rest: root, single deploy lock, existing units, clean tracked tree, backup success and fast-forward only.

## Backups before releases

The helper starts `boostinghub-backup.service` and requires `Result=success` before any Git, dependency or schema change. If the backup fails, nothing is changed. Retention, format and restore are in [OPERATIONS.md](OPERATIONS.md#backups).

## Initial system setup

This is for a fresh host only. Every step is an explicit operator action, as root.
Commands never rely on the shell's current directory: application `npm`
commands always run after `cd /var/www/boostinghub`, and install commands use
absolute paths.

1. Create the service user and checkout:

   ```bash
   useradd --system --create-home --shell /usr/sbin/nologin boostinghub
   install -d -o boostinghub -g boostinghub -m 0770 /var/www/boostinghub
   sudo -u boostinghub git clone --branch main https://github.com/Syntax1991/BoostingHub.git /var/www/boostinghub
   ```

2. Create the PostgreSQL role and database (`boostinghub`), listening on localhost only.
3. Write `/var/www/boostinghub/.env` from `.env.example` (`chown boostinghub:boostinghub`,
   `chmod 600`), then check it without printing secrets:
   `python3 /var/www/boostinghub/deploy/production/env-status.py`
   Production must have `DEV_AUTH_ENABLED=false` and `DEV_ACCOUNT_BOOTSTRAP_ENABLED=false`.
   To derive Booster and Lootbuddy access from Discord roles on sign-in, set
   `DISCORD_BOOSTER_ROLE_ID` and `DISCORD_LOOTBUDDY_ROLE_ID`; the existing bot token and
   guild ID are used for the member lookup. See [Discord Booster role sync](DEVELOPER.md#discord-booster-role-sync).
4. Install, validate and build as `boostinghub`, from the app directory:

   ```bash
   cd /var/www/boostinghub
   sudo -u boostinghub npm ci --legacy-peer-deps
   sudo -u boostinghub npm run db:emit
   sudo -u boostinghub npm run typecheck
   sudo -u boostinghub npm run build
   sudo -u boostinghub npm run db:migrate
   ```

5. Install the root-owned backup executable. A root service must never execute a
   file the app user can write:

   ```bash
   install -d -o root -g root -m 0755 /usr/local/libexec/boostinghub
   install -o root -g root -m 0755 \
     /var/www/boostinghub/deploy/production/backup-db.sh \
     /usr/local/libexec/boostinghub/backup-db.sh
   install -d -o root -g root -m 0700 /var/backups/boostinghub
   ```

6. Install the units (root-owned, `0644`), reload, enable:

   ```bash
   U=/var/www/boostinghub/deploy/production/systemd
   install -o root -g root -m 0644 "$U"/boostinghub-*.service "$U"/boostinghub-*.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now boostinghub-web.service boostinghub-discord-bot.service
   systemctl enable --now boostinghub-character-sync.timer boostinghub-community-schedule.timer \
     boostinghub-battlenet-links.timer boostinghub-backup.timer
   ```

7. Take and validate the first backup: `systemctl start boostinghub-backup.service`,
   then check `systemctl show -p Result --value boostinghub-backup.service` is `success`.
8. In the hosting panel, point the domain's reverse proxy at `http://127.0.0.1:3000`
   and install the TLS certificate there. Do not add a second proxy. Certificate
   type and renewal date are handed over privately; a manually purchased certificate
   does not renew by itself.
9. Set `BETTER_AUTH_URL=https://manawyrm-boosting.com` and register the provider callbacks:
   - Discord OAuth: `https://manawyrm-boosting.com/api/auth/callback/discord`
   - Battle.net: `https://manawyrm-boosting.com/api/integrations/battlenet/callback`
10. Register slash commands (again whenever the command list changes):

    ```bash
    cd /var/www/boostinghub
    sudo -u boostinghub npm run bot:register-commands
    ```

11. Run the smoke checklist.

## Changing systemd units or the backup script

Edit the tracked file on a branch and merge it. Then, **as a separate step from
the application deploy**, install it on the host:

```bash
# after the change is on the server checkout (normal update deploy)
cd /var/www/boostinghub
install -o root -g root -m 0644 deploy/production/systemd/<unit> /etc/systemd/system/<unit>
systemctl daemon-reload
# backup script:
install -o root -g root -m 0755 deploy/production/backup-db.sh /usr/local/libexec/boostinghub/backup-db.sh
```

Then restart only the affected unit, or wait for its timer. Verify the installed
file matches the tracked one (`cmp` / `sha256sum`). After a backup unit change,
confirm `systemctl show -p Type -p RemainAfterExit boostinghub-backup.service`
still shows `oneshot` / `no`, or the next `update-server.sh` run refuses to deploy.

## Rollback

**Application rollback does not roll back the schema.** Migrations applied by a
bad release stay applied. Older code is only known to work against a newer schema
if you have verified it. Check what changed first:

```bash
git -C /var/www/boostinghub diff --stat <good-sha> <bad-sha> -- migrations/
```

An empty diff means no schema difference. Additive migrations are often tolerated
by older code, but that is not guaranteed. A database restore is a separate,
explicitly approved step (see [Restore](OPERATIONS.md#restore-operator-decision-only)).

### Preferred: revert on `main`, then deploy normally

Revert the bad change on GitHub (`git revert`, a PR, then merge), then run the
normal `update-server.sh`. You get a fresh backup, the fast-forward guard,
validation and verified restarts, and the checkout stays on `main`.

### Emergency: run a known-good commit directly

Use this only when waiting for a revert on `main` is not acceptable. Run as root:

```bash
cd /var/www/boostinghub
systemctl start boostinghub-backup.service                 # fresh backup first
systemctl show -p Result --value boostinghub-backup.service  # must be success
sudo -u boostinghub git status --porcelain --untracked-files=no   # must be empty
sudo -u boostinghub git rev-parse HEAD                       # record the bad SHA
sudo -u boostinghub git fetch origin --prune
sudo -u boostinghub git checkout --detach <good-sha>
sudo -u boostinghub npm ci --legacy-peer-deps
sudo -u boostinghub npm run db:emit
sudo -u boostinghub npm run typecheck
sudo -u boostinghub npm run build
systemctl restart boostinghub-web.service boostinghub-discord-bot.service
```

- Do **not** run `db:migrate` here. It only moves forward and never undoes newer
  migrations.
- Do not use `git reset --hard` or `git clean` for rollbacks.
- The checkout is now on a **detached HEAD** (`git branch --show-current` prints
  nothing). Local `main` still points at the bad commit.
- **Reconcile back to `main`**: once `main` on GitHub contains the fix or revert,
  run the normal `update-server.sh`. It checks out `main` and fast-forwards it.
  Running it **before** `main` is fixed redeploys the bad commit.

## Production smoke checklist

- [ ] `sudo -u boostinghub git -C /var/www/boostinghub rev-parse HEAD` is the expected SHA,
      and `git status --porcelain --untracked-files=no` is empty
- [ ] `https://manawyrm-boosting.com/` returns 200 and shows Discord sign-in
- [ ] Signed out, `/dashboard`, `/settings`, `/notifications`, `/profile`,
      `/manage/runs` return 307 to `/?next=<same path>`
- [ ] Discord sign-in completes with no redirect loop; a returning login maps to the same user
- [ ] A member holding the configured Booster role receives Booster on sign-in;
      manual Booster grants remain enabled and role absence does not revoke them
- [ ] `/profile` renders, including Active Sessions (no raw tokens)
- [ ] `/characters` loads (availability, lockouts, WCL, Battle.net)
- [ ] `/runs`, `/my-runs` and `/manage/runs` (for authorized roles) load
- [ ] Discord bot shows online in the guild
- [ ] `systemctl is-active boostinghub-web boostinghub-discord-bot` shows both `active`
- [ ] Exactly one bot process tree:
      `systemd-cgls -u boostinghub-discord-bot.service --no-pager`
- [ ] `systemctl list-timers 'boostinghub-*'` shows all four timers with a next run
- [ ] Newest `/var/backups/boostinghub/*.dump` is non-empty and passes `pg_restore --list`
- [ ] Fresh logs are clean since the restart:
      `journalctl -u boostinghub-web --since "10 min ago"` and
      `journalctl -u boostinghub-discord-bot --since "10 min ago"` show no startup errors,
      schema errors, reconnect loops or repeating Unknown Channel lines

## Failed deployments

The failure path of the helper is described under [Normal update deploy](#normal-update-deploy). In practice:

| Failed at | State | What to do |
| --- | --- | --- |
| Before the backup finished | Nothing changed; timers restored | Fix the cause, run the helper again |
| `pull --ff-only` | Checkout unchanged; timers restored when the old runtime is intact | Investigate why it is not a fast-forward. Never force it |
| `npm ci`, emit, typecheck or build | New code may be on disk, old build may be gone; services keep running until a restart; timers **stay stopped** | Fix forward or follow [Rollback](#rollback), then start the timers named in the output |
| `db:migrate` | Services not restarted; timers stopped | Read the error, fix forward. Never reverse a migration by hand |
| Restart, runtime check or HTTP smoke | New schema is live | Check `journalctl`, then fix forward or roll back the application only |

Do not restart the host, and do not touch SSH or firewall settings, as part of fixing a deploy.

## Planned repository restart

**Status: planned. Nothing here is implemented, and the switch is not approved.** Today production still pulls `main` from the existing repository `Syntax1991/BoostingHub`, with its full history.

Goal: a new repository under the same name starts with one reviewed initial commit, and the existing repository stays complete as a private archive.

### Checkpoint

The new initial commit must equal the last cleaned, tested and successfully deployed state. Comparing trees alone proves only that the files match, so the checkpoint records all of the following in a private release record, and any later commit voids it:

| Item | Requirement |
| --- | --- |
| Commit `C` | The final cleanup commit on `main`, tagged `handover-checkpoint-<date>` in the archive |
| Cleanup done | Documentation consolidated, security cleanup merged, secret scanners without open findings |
| Tests | Lint, typecheck, full test suite and build passed on exactly `C` |
| Deployed | `DEPLOY_OK … after=<C>` from the release helper, and the smoke checklist passed |
| Server state | `git rev-parse HEAD` equals `C`, the tracked tree is clean, services and timers are active |
| Fingerprints | Tree id of `C` plus tree ids of `C:migrations`, `C:deploy`, and the hash of `package-lock.json` |
| Backup | A successful database backup taken after the deploy, with a copy outside the server |

The new initial commit `R` is valid only if `R^{tree}` equals the tree of `C`. Because `C` is already deployed, the switch needs no build, no migration and no restart.

### Planned effects

| Area | Effect | Planned handling |
| --- | --- | --- |
| Server checkout | `git pull --ff-only` refuses the unrelated history. The helper aborts safely and restores the timers | One deliberate step: tag the old `HEAD` locally, fetch `R`, compare the tree with `C`, move `main` to `R`, confirm `git status` |
| Git remote | Stays the same URL once the new repository owns the name; the old repository moves to a new private name | Test anonymous fetch before and after. A private new repository would require server credentials |
| Deploy scripts | No change needed for the switch; they keep using `origin` and the branch argument | A later move to a `production` branch is a separate, tested change |
| Rollback | Old commit ids no longer exist in the new repository | Keep the local tag on the server and the private archive. Rollback targets after the switch are commits of the new history. Update [Rollback](#rollback) at that time |
| Open pull requests | Not carried over | Merge or close every open PR before `C` |
| Local worktrees and old clones | Their `origin` would point at the new repository and could push old history into it | Before the switch, point them at the archive and disable pushes (`git remote set-url --push origin no_push`). Remove leftover worktrees and branches. Enable secret scanning and push protection on the new repository before the first push |
| Public old content | Existing clones and third-party caches cannot be recalled | Removal is best effort. Exposed credentials are rotated, not hidden |

### Abort criteria

Stop the switch if a scanner finds a real credential (rotate first), if any fingerprint differs from the checkpoint, if the archive or backup cannot be restored, if the old repository stays publicly reachable, or if the server shows tracked changes, another commit or another remote. The switch never includes SSH, firewall or package changes, because there is no independent console access to recover the server.
