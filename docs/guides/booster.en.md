# Booster Guide

A concise introduction to **Manawyrm Hub**: sign in, manage Characters, sign up for Runs, and track status under **My Runs**.

> **Booster** is a Boosting Role granted by the community/admin. It applies to your **account**, not to a single Character. On each Run you still choose how you participate (Booster and/or Lootbuddy).

App: https://manawyrm-boosting.com

---

## 1. Getting started

Sign in with **Discord**. You land on the **Dashboard**, with shortcuts to **Runs**, **Characters**, and **My Runs**.

![Dashboard](./screenshots/bo-01-dashboard.png)

---

## 2. Characters

Under **Characters**:

1. Connect **Battle.net** (optional) or use **Add Character**.
2. Your **specialization** supplies the default role used by Discord Quick Signup.
3. Set **Availability**.
4. Lockouts are **informational**.
5. Inactive or weekly-unavailable Characters are **skipped** by Quick Signup. Saved Characters and Characters on non-conflicting other Runs are **included**.

The Booster role is **account-wide**.

![Characters](./screenshots/bo-02-characters.png)

---

## 3. Signing up (website)

**Runs** → **Sign up**.

Manual Booster flow:

1. Select one or more Characters
2. Choose offered roles (Tank / Healer / DPS)
3. **Save Booster Offers**

The website is best for fine-grained role choices. There is **no** Web Quick Signup button.

**Lootbuddy** entries are independent and can coexist with Booster offers.

![Signup dialog](./screenshots/bo-04-signup.png)

---

## 4. Discord Signups

Every open Run channel has a persistent **Signups** message with four buttons:

| Button | Effect |
| --- | --- |
| **Signup** | Choose Characters and offered roles manually |
| **Quick Signup** | One click: offers all eligible Booster Characters with specialization default roles. Saved Characters and non-conflicting other-Run usage are included; weekly unavailable, conflicting reservation (&lt; 2h), inactive, and missing default role are skipped. Additive; existing offers unchanged. Does **not** auto-select the Roster — the Raid Lead selects separately. |
| **Sign as Lootbuddy** | Creates **Loot-only** entries (Play along and finer setups are website-only) |
| **Cancel Signup** | Withdraws Booster **and** Lootbuddy participation for this Run |

Use normal **Signup** when you need manual role control.

Quick status: `/mysignups`.

---

## 5. After signing up

Under **My Runs**:

- **Pending** — you offered yourself
- **Selected** — you are in the published Roster
- **Not Selected / Withdrawn** — history / current outcome

Lifecycle:

```text
Signup → Roster → Publish → Start → Attendance → Complete → Payout
```

![My Runs](./screenshots/bo-05-my-runs.png)

### Checklist

1. Sign in with Discord
2. Add Character(s) + Booster role
3. Sign up (website or Discord)
4. Track status in **My Runs** / `/mysignups`
