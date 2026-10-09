# Discord-Posts: Anleitungen

Die Guides stehen in eigenen, normalen Discord-Channels — ohne Threads, ohne Forum-Posts und ohne „Back to menu“.

Der **Booster-Guide v2** und der **Raid-Lead-Guide v2** werden als Discord-Embeds mit Footer-Marker
`guide:<kind>:v2:<cardKey>` gepflegt (idempotent edit-in-place).

App: https://manawyrm-boosting.com

---

## Channel-Struktur

| Guide | Channel | Publisher | `/guide` |
| --- | --- | --- | --- |
| 📘 Booster | `1552712971543650425` | `npm run guide:booster:publish` | `/guide booster` |
| 📗 Raidlead | `1553768153572708514` | `npm run guide:raidlead:publish` | `/guide raidlead` |

IDs: `src/discord-bot/guide-channels.ts`.

---

# Booster Guide v2 (Discord embeds)

Canonical source: `src/guides/booster-guide.ts`  
Markdown mirrors: `docs/guides/booster.en.md` (EN) / `docs/guides/booster.md` (DE)  
Preview: `docs/guides/booster-discord-preview.md`

| Card | Key | Screenshot |
| --- | --- | --- |
| 📘 Getting started | `getting-started` | `bo-01-dashboard.png` |
| 🧙 Characters | `characters` | `bo-02-characters.png` |
| 📝 Signing up | `signing-up` | `bo-04-signup.png` |
| ⚡ Discord Signups | `discord-signups` | text-only (no screenshot) |
| ✅ After signing up | `after-signing-up` | `bo-05-my-runs.png` |

Accent: `#d4af37`. Card 1 may include a Link button **Open Manawyrm Hub**.

### Maintainer workflow

```bash
# 1) Refresh screenshots (local DEV_AUTH + Playwright)
npm run guide:screenshots

# 2) Preview cards (no Discord mutation)
npm run guide:booster:preview

# 3) Upsert the five canonical embeds (edit-in-place when markers exist)
npm run guide:booster:publish

# 4) After verifying the new guide, retire old unmarked bot posts once
npm run guide:booster:publish -- --retire-legacy

# Optional local rollback snapshot (do not commit):
npm run guide:booster:publish -- --snapshot-dir=/tmp/booster-guide-snapshots
```

Safety:

- Default / preview = dry listing of cards; `--publish` required to mutate Discord.
- Canonical messages are identified by embed footer markers + optional `asset:<sha12>` — not “last five messages”.
- Screenshot byte changes bump `asset:` and force an edit even when the filename is unchanged.
- Duplicate markers or foreign authors → refuse.
- Legacy retirement requires the complete known five-message fingerprint set, then upsert + re-read verification of all five v2 cards before any delete.
- Every `--publish` writes a local rollback snapshot under `tmp-booster-guide-snapshots/` (gitignored).

Screenshots live under `docs/guides/screenshots/`. Capture viewport: **1440×900**, dark theme, no browser chrome.

---

# Raid Lead Guide v2 (Discord embeds)

Canonical source: `src/guides/raidlead-guide.ts`  
Markdown mirrors: `docs/guides/raidlead.en.md` (EN) / `docs/guides/raidlead.md` (DE)  
Preview: `docs/guides/raidlead-discord-preview.md`

| Card | Key | Screenshot |
| --- | --- | --- |
| 📗 Raid Lead basics | `raid-lead-basics` | `rl-01-dashboard.png` |
| 🛠️ Create a Run | `create-run` | `rl-04-create-run.png` |
| 📣 Open & Manage Signups | `open-manage-signups` | `rl-06-run-overview.png` |
| 👥 Build the Roster | `build-roster` | `rl-05-roster.png` |
| ▶️ Run & Attendance | `run-attendance` | `rl-07-attendance.png` |
| ✅ Complete the run | `complete-run` | `rl-06-run-overview.png` |

Accent: `#d4af37` (same as Booster). Card 1 includes Link button **Open Manawyrm Hub**.

### Maintainer workflow

```bash
# 1) Refresh screenshots (local DEV_AUTH + Playwright)
npm run guide:raidlead:screenshots

# 2) Preview cards (no Discord mutation)
npm run guide:raidlead:preview

# 3) Upsert the six canonical embeds
npm run guide:raidlead:publish

# 4) After verifying the new guide, retire the known six-message legacy set once
npm run guide:raidlead:publish -- --retire-legacy
```

Safety (same model as Booster):

- Default / preview = dry listing; `--publish` required to mutate Discord.
- Identity via footer `guide:raidlead:v2:<cardKey>[ · asset:<sha12>]`.
- Legacy retirement requires the complete known six-message fingerprint set + post-upsert verification of all six v2 cards.
- Every `--publish` writes `tmp-raidlead-guide-snapshots/` (gitignored).
- Deprecated forwarder: `scripts/post-raidlead-guide.mts` (`--post` → `--publish`).

---

## Posten per SSH

Booster-Guide (v2, idempotent):

```bash
ssh root@manawyrm-boosting.com
cd /var/www/boostinghub

sudo -u boostinghub npm run guide:booster:preview
sudo -u boostinghub npm run guide:booster:publish
# after visual verify:
sudo -u boostinghub npm run guide:booster:publish -- --retire-legacy
```

Raid-Lead-Guide (v2, idempotent — do not use append-only `--post` anymore):

```bash
sudo -u boostinghub npm run guide:raidlead:preview
sudo -u boostinghub npm run guide:raidlead:publish
# after visual verify:
sudo -u boostinghub npm run guide:raidlead:publish -- --retire-legacy
```

- Ohne `--publish` nur Preview; mit `--publish` edit-in-place / create missing; nie blind duplizieren.
- Es gibt keinen „Back to menu“-Button und keine Threads.
