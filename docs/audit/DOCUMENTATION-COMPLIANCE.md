# Documentation compliance audit

| Field | Value |
| --- | --- |
| Date | 2026-11-02 |
| Branch | `test/audit-batch-a` |
| Scope | Audit/handover docs vs established project documentation rules |
| Status | Corrections applied; evidence in this file |

Related documents: [README.md](../../README.md) (canonical doc index), [DEVELOPER.md](../DEVELOPER.md) (architecture + rule 10), [HANDOVER.md](../HANDOVER.md), [FINAL-ENGINEERING-HANDOVER.md](FINAL-ENGINEERING-HANDOVER.md).

## Contents

- [Authoritative guidelines](#authoritative-guidelines)
- [Instruction precedence](#instruction-precedence)
- [Compliance matrix](#compliance-matrix)
- [Corrections applied](#corrections-applied)
- [Validation](#validation)
- [Remaining exceptions](#remaining-exceptions)

## Authoritative guidelines

Recovered from the repository (no separate CONTRIBUTING.md or style-guide file exists).

| Source | Rule |
| --- | --- |
| [README.md](../../README.md) | Canonical product docs are the six files under `docs/`: DEVELOPER, API, USER, DEPLOYMENT, OPERATIONS, HANDOVER. README indexes only those. |
| [DEVELOPER.md](../DEVELOPER.md) § Rules for later contributors item 10 | Update documentation in the **same change** that alters architecture or domain behavior. |
| [DEVELOPER.md](../DEVELOPER.md) § Start here | Use established domain terms (Run, Character, Booster, Raid Lead, Account role, Boosting Role, Lane, …). |
| [DEVELOPER.md](../DEVELOPER.md) § Git workflow | Public repository: never commit secrets, production data or personal data. Docs branches use `docs/<topic>`. |
| [API.md](../API.md) intro | API reference lists only what exists in `src/app/**/route.ts` or `src/controllers/*.actions.ts`. |
| Canonical doc shape (DEVELOPER, API, USER, OPERATIONS, DEPLOYMENT, HANDOVER) | Title, purpose sentence, Contents TOC, relative cross-links to sibling docs; factual tone; distinguish unverified live-server claims. |
| [AGENTS.md](../../AGENTS.md) / [CLAUDE.md](../../CLAUDE.md) | Next.js version-specific agent rules only — not a documentation style guide. |
| [.cursor/rules/mvcs.mdc](../../.cursor/rules/mvcs.mdc) | MVCS and role terminology — aligns with DEVELOPER. |
| Audit working records | `docs/audit/*` are session/phase evidence. They must not contradict canonical docs; they are not a second product handbook. Historical phase bodies stay intact; post-phase facts use **Errata**. Canonical product docs remain under `docs/*.md` (see repository [README.md](../../README.md)). |

There is **no** markdownlint / link-check npm script in `package.json`. Validation is manual relative-link resolution plus the usual `lint` / `typecheck` / `build` when code changes.

## Instruction precedence

1. Canonical `docs/*.md` + README index for product/ops truth.
2. DEVELOPER rule 10 for required doc updates with code.
3. Audit phase reports as historical evidence (with Errata when later facts change).
4. Agent instruction files (AGENTS/CLAUDE) do not override documentation structure.

## Compliance matrix

| Document / area | Classification | Rule | Finding |
| --- | --- | --- | --- |
| README six-doc index | COMPLIANT | Canonical locations | Unchanged; audit folder correctly not a seventh product handbook |
| `docs/API.md` `raid-invite` kind | NON-COMPLIANT → corrected | API lists only existing routes/kinds | Documented A19-removed `kind: "raid-invite"` after schema removal |
| `docs/DEVELOPER.md` seed/test paragraph | OUTDATED → corrected | Accurate current paths/status | Claimed suites “still open” in the test audit |
| `docs/DEVELOPER.md` discord-sync test path | OUTDATED → corrected | Paths after `tests/` move | Still cited `src/services/discord-sync.service.test.ts` |
| `docs/DEVELOPER.md` repository / technical decisions | MISSING REQUIRED DOCUMENTATION → corrected | Rule 10 | A18 `tx.orm.public`, A19 co-deploy, security headers not in technical decisions |
| `docs/OPERATIONS.md` CSP / headers | NON-COMPLIANT / MISSING → corrected | Ops security + resolvable links | Vague “see audit acceptance report” without path; headers under-documented |
| `docs/audit/EXECUTION_LEDGER.md` | OUTDATED / DUPLICATED risk → clarified | Distinguish historical vs current | Old continuation text still said Phase 2 unfinished; current status banner added |
| `docs/audit/reports/PHASE-*.md` | COMPLIANT as historical evidence | Do not silently rewrite | Bodies preserved; Errata added where A16/CSP later changed |
| `docs/audit/reports/FINAL-ACCEPTANCE-REVIEW.md` | COMPLIANT | Evidence report | Kept; A16 closure already recorded |
| `docs/audit/FINAL-ENGINEERING-HANDOVER.md` | DUPLICATED risk → clarified | Canonical handover is HANDOVER.md | Freeze note now states it supplements HANDOVER, does not replace it |
| `docs/HANDOVER.md` audit pointers | COMPLIANT after prior A16 update | Owner status | Points at audit freeze + open ops items |
| `docs/audit/hardcoding-findings.md` | DECLINED (owner 2026-11-02) | Ledger promised file | Documentation suggestion closed; does not mark a code defect |
| Phase 5 API/DEVELOPER A19 notes | COMPLIANT | Rule 10 | Raid Invite / `notificationDms` already described; API table gap was residual |

## Corrections applied

| Change | Files |
| --- | --- |
| Remove obsolete `raid-invite` discord-state row | `docs/API.md` |
| Fix test-audit status and discord-sync test path; document A18/A19/headers | `docs/DEVELOPER.md` |
| Security checklist + CSP section with real links | `docs/OPERATIONS.md` |
| Current-status banner; hardcoding note | `docs/audit/EXECUTION_LEDGER.md` |
| Errata for A16 / CSP | `docs/audit/reports/PHASE-3.md`, `PHASE-4.md` |
| Freeze note role + open items | `docs/audit/FINAL-ENGINEERING-HANDOVER.md` |
| This matrix | `docs/audit/DOCUMENTATION-COMPLIANCE.md` |
| CSP inventory (separate commit with code) | `docs/audit/CSP-PREPARATION.md` |

## Validation

- Relative links from corrected docs to `docs/audit/*` and sibling `docs/*.md` resolved by path existence check.
- No documentation lint npm script exists to run.
- Code validation for CSP Report-Only belongs to the CSP commit (`lint` / `typecheck` / `build` / `tests/unit/next-config.test.ts`).

## Remaining exceptions

| Item | Classification | Notes |
| --- | --- | --- |
| `hardcoding-findings.md` absent | DECLINED | Owner closed the documentation suggestion; no fabricated inventory |
| EXECUTION_LEDGER historical continuation paragraphs | OUTDATED (retained) | Banner directs readers to freeze/acceptance for current status; full rewrite would destroy working history |
| Large suite logs under `docs/audit/reports/` | COMPLIANT as evidence | Unusual for product docs; appropriate for audit acceptance |
| Enforcing CSP | NEEDS OWNER DECISION | Report-Only shipped; enforce only after browser observation |
| Canonical doc set | CONFIRMED | Owner: six files under `docs/` only — no new structure |
