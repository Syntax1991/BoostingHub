# Discord-Posts: Anleitungen

Zum manuellen Posten in Discord (Forum/Channel). Jede **Nachricht** ist unter 2000 Zeichen.
Hänge die genannten Screenshots an die jeweilige Nachricht an (Dateien unter `docs/guides/screenshots/`).

App: https://phoenix-star.de

---

## Forum / Channel-Struktur (Empfehlung)

Zwei Threads oder zwei gepinnte Posts:

1. `📘 Anleitung — Booster`
2. `📗 Anleitung — Raidlead`

Oder ein Thread mit zwei klar getrennten Abschnitten.

---

# Booster

## Nachricht B1 — Intro + Login

```
## 📘 Anleitung für Booster

Kurzer Einstieg in **BoostingHub**: anmelden, Characters anlegen, für Runs anmelden und Status unter **My Runs** verfolgen.

App: https://phoenix-star.de

**Wichtig:** Deine Account-Rolle ist meist **USER**.
**BOOSTER** und **LOOTBUDDY** sind keine Account-Rollen, sondern **Teilnahmearten pro Run**.

### 1. Anmelden
Öffne BoostingHub → **Continue with Discord**.
Danach landest du auf dem **Dashboard**.
```

Anhang: `common-01-login.png`

---

## Nachricht B2 — Dashboard + Characters

```
### 2. Dashboard
Hier siehst du auf einen Blick:
• **Your attention** — Termin-Konflikte
• **Upcoming Runs** — offene / laufende Runs
• **Next selected run** — dein nächster SELECTED-Run
• **Characters** — aktive / booster-eligible Chars

### 3. Characters anlegen
Unter **Characters**:
1. Optional Battle.net (EU/US) verbinden
2. Oder **Add Character** (Region / Realm / Name + Spec)
3. **Account Access** und **Availability** prüfen

**Booster-Zugang:** Für Booster-Signups brauchst du eine freigeschaltete Qualification (z. B. Heroic). Beantragung über Discord (**Apply via Discord**) — nicht in der App. Ohne Freigabe kannst du dich weiterhin als **Lootbuddy** anmelden.
```

Anhänge: `bo-01-dashboard.png`, `bo-02-characters.png`

---

## Nachricht B3 — Signup

```
### 4. Für einen Run anmelden
**Runs** öffnen → Runs mit **Signups open** suchen → **Sign up**.

Spalten kurz:
• **RAID** — Titel, Difficulty, Status
• **SCHEDULE** — Datum / Uhrzeit
• **LEAD** — Raid Lead
• **COMP** — z. B. 2T / 4H / 14D
• **YOU** — dein Status
• **ACTION** — Sign up / Signed ×N

**Booster**
1. Character(s) anhaken
2. Rollen wählen (Tank / Healer / DPS)
3. **Save Booster Offers**

**Lootbuddy** (unabhängig, kein Character nötig)
• Class + Mode (Loot only / Play along)
• **Save Lootbuddies**

Tipp: Web und Discord nutzen dieselben Signups — Discord-Buttons: nächste Nachricht.
```

Anhänge: `bo-03-runs.png`, `bo-04-signup.png`

---

## Nachricht B4 — Discord-Bot

```
### 5. Anmeldung über den Discord-Bot
Voraussetzung: Discord mit BoostingHub verknüpft (Discord-Login auf der Website).

Jeder offene Run hat einen Channel mit Signup-Embed und Buttons:

• **Signup** — als Booster (Character + Rollen)
• **Sign as Lootbuddy** — Klassen wählen → speichert als **Loot only**
• **Cancel Signup** — zieht Booster **und** Lootbuddy zurück

**Booster-Flow**
1. **Signup** klicken (Antwort nur für dich sichtbar)
2. Character(s) wählen → **Next**
3. Rollen setzen → **Confirm**

**Lootbuddy:** Mode **Play along** und feinere Sets nur über die Website.

**`/mysignups`** — deine aktuellen Signups (wie My Runs). Es gibt kein `/signup`.

Nach Publish: Roster-Embed im Channel. Beim Start ggf. Raid-Invite-DM.
```

Keine Pflicht-Anhänge (optional: Screenshot vom Signup-Embed + Buttons, Character-Select, `/mysignups`).

---

## Nachricht B5 — My Runs + Checkliste

```
### 6. Status unter My Runs
• **Selected** — im veröffentlichten Roster
• **Pending** — Raid Lead entscheidet noch
• **Not Selected / Withdrawn** — Historie

**Withdraw** zieht ein Angebot zurück, solange erlaubt (Pending meist frei; Selected oft erst vor Publish/Start).

### Ablauf (Booster-Sicht)
Sign up (Pending)
→ Roster
→ Publish (Selected / Not Selected)
→ Start → Attendance → Complete → Payout

### ✅ Checkliste
1. Discord-Login (verknüpft Discord mit BoostingHub)
2. Character(s) anlegen
3. Booster-Zugang über Discord beantragen (**Apply via Discord**)
4. Anmelden: Website **Runs → Sign up** *oder* Discord-Buttons
5. Status prüfen: **My Runs** / `/mysignups`, ggf. Withdraw / **Cancel Signup**
```

Anhang: `bo-05-my-runs.png`

---

# Raidlead

## Nachricht R1 — Intro + Dashboard

```
## 📗 Anleitung für Raidleads

BoostingHub als **RAID_LEAD**: Run anlegen, Signups öffnen, Roster, Start, Attendance, Complete.

Du verwaltest nur **deine** Runs. Admins können alle Runs sehen.

App: https://phoenix-star.de

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

## Posting-Tipp

1. Forum-Post / Thread anlegen
2. Nachrichten der Reihe nach posten
3. Screenshots an die passende Nachricht anhängen
4. Thread pinnen
5. Optional: Link in Willkommens- / Booster-Channel
