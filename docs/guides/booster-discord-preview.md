# Booster Guide v2 — Discord preview

Local review artifact for the redesigned Manawyrm Hub Booster Guide.
**Not published live in this PR.**

Accent color: `#d4af37` (same gold family as Discord signup embeds).

---

## Card 1 — Getting started

**Title:** 📘 Manawyrm Hub — Booster Guide

**Copy:**

Sign in with Discord, then use the Dashboard to jump into Runs, Characters, and My Runs.

App: https://manawyrm-boosting.com

Booster is a Boosting Role granted by the community/admin. It applies to your account, not to a single Character.

**CTA:** Link button → Open Manawyrm Hub

**Screenshot:** `screenshots/bo-01-dashboard.png`

![Card 1](./screenshots/bo-01-dashboard.png)

---

## Card 2 — Characters

**Title:** 🧙 Characters

**Copy:** Connect Battle.net or Add Character · specialization → default role · Availability · account-wide Booster · lockouts informational · inactive/unavailable skipped by Quick Signup

**Screenshot:** `screenshots/bo-02-characters.png`

![Card 2](./screenshots/bo-02-characters.png)

---

## Card 3 — Signing up

**Title:** 📝 Signing up

**Copy:** Website Runs → Sign up · select Characters · roles · Save Booster Offers · web for fine-grained roles · no Web Quick Signup · Lootbuddy independent

**Screenshot:** `screenshots/bo-04-signup.png`

![Card 3](./screenshots/bo-04-signup.png)

---

## Card 4 — Discord Signups

**Title:** ⚡ Discord Signups

**Fields:** Signup · Quick Signup (highlighted) · Sign as Lootbuddy · Cancel Signup

**Screenshot:** `screenshots/bo-06-discord-signups.png`  
Builder-driven Discord UI preview from `buildSignupEmbed` / `buildSignupButtons` (anonymized fixture, HEROIC + COMMUNITY). Not a live Discord client capture.

![Card 4](./screenshots/bo-06-discord-signups.png)

---

## Card 5 — After signing up

**Title:** ✅ After signing up

**Copy:** Pending / Selected / Not Selected · lifecycle · `/mysignups` · checklist

**Screenshot:** `screenshots/bo-05-my-runs.png`

![Card 5](./screenshots/bo-05-my-runs.png)

---

## Maintainer commands

```bash
npm run guide:screenshots          # Playwright capture (local DEV_AUTH)
npm run guide:booster:preview      # dry-run card listing (no Discord I/O)
npm run guide:booster:publish      # upsert canonical embeds (explicit)
npm run guide:booster:publish -- --retire-legacy   # then remove old unmarked guide posts
```
