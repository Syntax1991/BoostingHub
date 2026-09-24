# Booster Guide

A quick introduction to BoostingHub: sign in, add characters, sign up for runs and track your status under **My Runs**.

> **Important:** Your account role is usually **USER**. **BOOSTER** and **LOOTBUDDY** are not account roles — they are **participation types per run**.

---

## 1. Sign in

Open BoostingHub and sign in with **Continue with Discord**. Discord is the production login.

![Login with Discord](./screenshots/common-01-login.png)

After signing in you land on the **Dashboard**.

---

## 2. Dashboard

At a glance you see:

- **Your attention** — scheduling conflicts between runs you were selected for
- **Upcoming Runs** — open and ongoing community runs
- **Next selected run** — your next **SELECTED** run, including character and role
- **Characters** — active / booster-eligible characters and lockout hints

![Booster dashboard](./screenshots/bo-01-dashboard.png)

---

## 3. Add characters

Manage your WoW characters under **Characters**. To sign up as a booster you need at least one **active** character.

1. Optionally connect **Battle.net** (EU/US) — for import and item level refresh.
2. Or use **Add Character**: enter region / realm / name and pick a spec (class and ilvl are fetched from Blizzard).
3. Check **Account Access** (e.g. Heroic / Mythic) and **Availability**.

![Characters page](./screenshots/bo-02-characters.png)

### Booster access (qualification)

To sign up as a **Booster** for a difficulty, you need an approved **Booster Qualification** (user + difficulty, e.g. Heroic). You request it through the community's Discord ticket process — there is no self-service form in the app. Without approval you can still sign up as a **Lootbuddy**.

---

## 4. Sign up for a run

Open **Runs**. Filter by difficulty or status and look for runs with **Signups open**.

![Runs list](./screenshots/bo-03-runs.png)

Columns at a glance:

| Column | Meaning |
| --- | --- |
| **RAID** | Title, content, difficulty, status |
| **SCHEDULE** | Date / time |
| **LEAD** | Responsible raid lead |
| **COMP** | Target composition (e.g. 2T / 4H / 14D) |
| **YOU** | Your status (Not signed, Pending, Selected, …) |
| **ACTION** | **Sign up**, or **Signed ×N** if already signed up |

Click **Sign up**. The dialog has two independent sections:

### Booster

1. Tick your character(s).
2. Choose the roles you offer (**Tank** / **Healer** / **DPS**) — whatever your class can play.
3. **Save Booster Offers**.

### Lootbuddy

- No character required.
- Class + mode (**Loot only** or **Play along**).
- Can exist alongside a booster signup.
- **Save Lootbuddies**.

![Signup dialog](./screenshots/bo-04-signup.png)

The website and Discord share the **same** signups — see section 5.

---

## 5. Signing up via the Discord bot

Requirement: your Discord account is linked to BoostingHub (done once by signing in with Discord on the website).

Every open run has its own Discord channel with a **signup embed** and buttons:

| Button | Effect |
| --- | --- |
| **Signup** | Sign up as a booster (character + roles) |
| **Sign as Lootbuddy** | Sign up as a lootbuddy (choose classes) |
| **Cancel Signup** | Withdraw your active booster **and** lootbuddy participation |

### Booster (Signup button)

1. Click **Signup** in the run channel (the reply is only visible to you).
2. Select character(s) → **Next**.
3. Set the offered roles per character → **Confirm**.

Without an approved booster qualification or without eligible characters, the flow stops with a message.

### Lootbuddy (Sign as Lootbuddy button)

1. Click **Sign as Lootbuddy**.
2. Pick one or more classes → confirm.
3. Discord saves this as **Loot only** (one entry per class). The **Play along** mode and finer lootbuddy setups are only available on the website.

### Cancel Signup

Withdraws **both booster and lootbuddy** signups for this run (unlike the web's "Cancel Booster", which only affects booster signups). Protected roster / selected entries may block the action.

### Slash command `/mysignups`

Shows your current signups (ephemeral), grouped like **My Runs** on the website. There is no `/signup` command — signing up only works via the embed buttons.

After publishing, the **roster embed** (selected players only) appears in the same channel. On **Start Run** you may also receive a raid invite DM (if enabled in Settings).

---

## 6. Status under My Runs

**My Runs** shows your signups grouped by status:

- **Selected** — in the published roster
- **Pending** — offer submitted, raid lead hasn't decided yet
- **Not Selected** / **Withdrawn** — history

![My Runs](./screenshots/bo-05-my-runs.png)

**Withdraw** pulls back an offer as long as the rules allow it (e.g. Pending is usually free; Selected often only before publish / start).

---

## 7. Run lifecycle (booster perspective)

```text
Sign up (Pending)
  → Raid lead builds the roster
  → Publish (Selected / Not Selected)
  → Start Run
  → Attendance
  → Complete → Payout
```

The dashboard and **My Runs** show whether you are selected and with which character / role.

---

## Quick checklist

1. Sign in with Discord (links Discord to BoostingHub)
2. Add character(s) under **Characters**
3. Request booster access for the difficulty via Discord ticket
4. Sign up: website **Runs → Sign up** *or* the Discord buttons in the run channel
5. Check your status: **My Runs** / `/mysignups`; withdraw or **Cancel Signup** if needed
