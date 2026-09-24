# Anleitung für Raidleads

Kurzer Einstieg in BoostingHub als **RAID_LEAD**: Run anlegen, Signups öffnen, Roster bauen, starten, Attendance markieren und abschließen.

> Du verwaltest nur **deine** Runs (Lead = du). Admins können alle Runs sehen und bearbeiten.

---

## 1. Anmelden

Wie jeder User: **Continue with Discord**.

![Login mit Discord](./screenshots/common-01-login.png)

Nach dem Login siehst du oben rechts **RAID LEAD** und in der Sidebar den Bereich **Manage**.

---

## 2. Dashboard — Boosting Control Center

Das **Boosting Control Center** listet Hand-offs für deine zugewiesenen Runs, z. B.:

- **Build Roster** / **Start Run**
- **Mark Attendance**
- **Prepare Payout** / **Review Payout**

![Raidlead-Dashboard](./screenshots/rl-01-dashboard.png)

---

## 3. Run erstellen

1. Gehe zu **Runs** → **Create Run** (oder direkt `/runs/create`).
2. Setze **Shared defaults**: Product, Bosses, Difficulty, Loot Type, Composition (Tanks / Healers / DPS), optional Discord-Role-Ping und Notes.
3. Trage pro Zeile den **Startzeitpunkt** ein (1–25 Runs auf einmal möglich).
4. **Create … Draft** — der Run startet als **DRAFT** mit geschlossenen Signups.

![Create Run](./screenshots/rl-04-create-run.png)

Als Raid Lead ist der Lead fest auf dich gesetzt; du kannst keinen anderen Lead zuweisen.

---

## 4. Manage Runs

Unter **Manage → Runs** siehst du deine Runs inkl. Status, Signup-Fenster und Aktionen (**Build Roster**, **View Run**, **Cancel Run**, …).

![Manage Runs](./screenshots/rl-03-manage-runs.png)

Öffentliche Entdeckung läuft über **Runs**; Drafts erscheinen dort **nicht** für normale User.

---

## 5. Run öffnen und Signups steuern

Auf der Run-Detailseite (**Overview**):

| Aktion | Wirkung |
| --- | --- |
| **Open Run** | DRAFT → OPEN, Signups öffnen |
| **Close Signups** / **Reopen Signups** | Fenster zu/auf (Status bleibt OPEN/ROSTERING) |
| **Edit Run** | Planung ändern (je nach Status/Signup-Historie eingeschränkt) |
| **Cancel Run** | Abbrechen; Historie bleibt erhalten |

![Run Overview mit Manager-Aktionen](./screenshots/rl-06-run-overview.png)

Unter **Runs** siehst du Community-Runs und den Button **Create Run**:

![Runs-Liste mit Create Run](./screenshots/rl-02-runs.png)

---

## 6. Roster bauen und publishen

Tab **Roster**:

1. Composition und **Class Buffs** im Blick behalten (Warnungen, keine harten Blocks).
2. Signup-Karten auswählen und bei Boostern die **Selected Role** setzen.
3. **Save Roster** speichert den Draft (erster Save auf OPEN → Status **ROSTERING**).
4. **Publish Roster** setzt SELECTED / NOT_SELECTED und Status **PUBLISHED**.

Bei Composition-Warnungen musst du das Acknowledge-Checkboxen setzen, bevor Publish geht.

![Roster Builder](./screenshots/rl-05-roster.png)

Hinweise:

- Pro User höchstens **ein** ausgewählter **BOOSTER**; Lootbuddies dürfen zusätzlich ausgewählt werden.
- „Committed elsewhere“ zeigt andere BoostingHub-Commitments — Schedule-Konflikte (< 2 h Startabstand) blocken die Auswahl.

---

## 7. Run starten

Auf einem **PUBLISHED**-Run: **Start Run**.

![Start Run](./screenshots/rl-08-start-run.png)

Danach: Status **IN PROGRESS**, Signups zu, Attendance-Snapshot der SELECTED-Teilnehmer. Roster ist eingefroren.

---

## 8. Attendance und Complete

Tab **Attendance**:

1. Ausnahmen zuerst setzen (**Late**, **No show**, **Standby**, **Excused**, …) inkl. Note.
2. **Mark all unmarked as Present**.
3. **Complete Run** — nur möglich, wenn niemand mehr **Unmarked** ist.

![Attendance](./screenshots/rl-07-attendance.png)

**Standby** ist für Backups, die nicht gebraucht wurden — nicht als No-Show markieren.

---

## 9. Payout (kurz)

Nach **COMPLETED** Tab **Payout**:

1. Settlement-Draft vorbereiten (Gold-Pot manuell)
2. Split berechnen / finalisieren
3. **Mark Paid** macht ein Admin

Details: [run-payouts.md](../features/run-payouts.md).

---

## Typischer Ablauf

```text
Create Draft
  → Edit (falls nötig)
  → Open Run (Signups auf)
  → Signups sammeln / Fenster schließen
  → Roster speichern → Publish
  → Start Run
  → Attendance → Complete
  → Payout
```

---

## Kurz-Checkliste

1. Discord-Login als RAID_LEAD
2. **Create Run** → Draft
3. **Open Run**, Signups beobachten
4. **Roster** speichern und **Publish**
5. **Start Run** → Attendance → **Complete**
6. Payout vorbereiten (Admin markiert Paid)
