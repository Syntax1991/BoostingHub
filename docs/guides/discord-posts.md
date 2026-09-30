# Discord-Posts: Anleitungen

Die Guides stehen in eigenen, normalen Discord-Channels — ohne Threads, ohne Forum-Posts und ohne „Back to menu“.

Der **Booster-Guide v2** wird als fünf Discord-Embeds mit Footer-Marker
`guide:booster:v2:<cardKey>` gepflegt (idempotent edit-in-place).

App: https://manawyrm-boosting.com

---

## Channel-Struktur

| Guide | Channel | Publisher | `/guide` |
| --- | --- | --- | --- |
| 📘 Booster | `1552712971543650425` | `npm run guide:booster:publish` | `/guide booster` |
| 📗 Raidlead | `1553768153572708514` | `scripts/post-raidlead-guide.mts` | `/guide raidlead` |

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
| ⚡ Discord Signups | `discord-signups` | `bo-06-discord-signups.png` |
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

# Raidlead

## Nachricht R1 — Intro + Dashboard

```
## 📗 Anleitung für Raidleads

BoostingHub als **RAID_LEAD**: Run anlegen, Signups öffnen, Roster, Start, Attendance, Complete.

Du verwaltest nur **deine** Runs. Admins können alle Runs sehen.

App: https://manawyrm-boosting.com

### 1. Anmelden
**Continue with Discord** → oben rechts **RAID LEAD**, Sidebar **Manage**.

### 2. Boosting Control Center
Hand-offs für deine Runs, z. B.:
• Build Roster / Start Run
• Mark Attendance
• Prepare / Review Payout
```

Anhänge: `common-01-login.png`, `rl-01-dashboard.png`

---

## Nachricht R2 — Create + Manage

```
### 3. Run erstellen
1. **Runs** → **Create Run**
2. Shared defaults: Product, Bosses, Difficulty, Loot Type, Composition, optional Discord-Ping
3. Startzeitpunkt pro Zeile (1–25 Runs möglich)
4. **Create … Draft** → Status **DRAFT**, Signups zu

Als Raid Lead ist der Lead fest auf dich gesetzt.

### 4. Manage Runs
Unter **Manage → Runs**: deine Runs inkl. Status und Aktionen (Build Roster, View Run, Cancel, …).

Drafts erscheinen für normale User **nicht** unter Runs.
```

Anhänge: `rl-04-create-run.png`, `rl-03-manage-runs.png`

---

## Nachricht R3 — Open Signups + Roster

```
### 5. Run öffnen & Signups
Auf der Run-Detailseite (**Overview**):
• **Open Run** — DRAFT → OPEN, Signups auf
• **Close / Reopen Signups** — Fenster zu/auf
• **Edit Run** — Planung (je nach Status eingeschränkt)
• **Cancel Run** — abbrechen, Historie bleibt

### 6. Roster bauen & publishen
Tab **Roster**:
1. Composition + Class Buffs im Blick
2. Signups auswählen, bei Boostern **Selected Role** setzen
3. **Save Roster** (erster Save auf OPEN → ROSTERING)
4. **Publish Roster** → SELECTED / NOT_SELECTED, Status PUBLISHED

Bei Composition-Warnungen Acknowledge anhaken vor Publish.

Hinweise:
• Max. **ein** ausgewählter BOOSTER pro User (+ beliebig Lootbuddies)
• Schedule-Konflikt (< 2h Startabstand) blockt Auswahl
```

Anhänge: `rl-06-run-overview.png`, `rl-02-runs.png`, `rl-05-roster.png`

---

## Nachricht R4 — Start, Attendance, Payout

```
### 7. Run starten
Auf **PUBLISHED**: **Start Run**
→ IN PROGRESS, Signups zu, Attendance-Snapshot, Roster eingefroren

### 8. Attendance & Complete
1. Ausnahmen zuerst (Late, No show, Standby, Excused, …) + Note
2. **Mark all unmarked as Present**
3. **Complete Run** — nur ohne Unmarked

**Standby** = Backup nicht gebraucht (nicht als No-Show).

### 9. Payout (kurz)
Nach COMPLETED → Tab **Payout**:
1. Settlement-Draft (Gold-Pot)
2. Split finalisieren
3. **Mark Paid** macht ein Admin

### Typischer Ablauf
Create Draft → Open Run → Signups → Save Roster → Publish
→ Start Run → Attendance → Complete → Payout

### ✅ Checkliste
1. Discord-Login als RAID_LEAD
2. Create Run → Draft
3. Open Run
4. Roster speichern + Publish
5. Start → Attendance → Complete
6. Payout vorbereiten
```

Anhänge: `rl-08-start-run.png`, `rl-07-attendance.png`

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

Raidlead-Guide (noch append-only):

```bash
sudo -u boostinghub npx tsx --env-file=.env scripts/post-raidlead-guide.mts
sudo -u boostinghub npx tsx --env-file=.env scripts/post-raidlead-guide.mts --post
```

- Booster: ohne `--publish` nur Preview; mit `--publish` edit-in-place / create missing; nie blind duplizieren.
- Raidlead: `--post` sendet weiterhin **neue** Nachrichten (noch nicht idempotent).
- Es gibt keinen „Back to menu“-Button und keine Threads.
