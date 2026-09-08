# Git workflow

BoostingHub uses GitHub. The remote is private.

## Stable branch

`main` is the only stable branch.

It represents integrated, validated, usable application state. Do not do normal feature development on `main`.

Each meaningful feature starts from updated `main`:

```bash
git checkout main
git pull --ff-only
git checkout -b feature/<feature-name>
```

Exact Git commands may vary.

## Feature branches

Use `feature/<domain-feature>`.

Branches represent coherent business features, not pages.

A character-management branch may change `/characters`, `/dashboard`, `/profile`, services, the database, and docs, because those surfaces share the same domain.

## Branch granularity

Feature/domain based, not page based.

Good:

- `feature/character-management`
- `feature/run-management`
- `feature/run-lifecycle-attendance`
- `feature/profile-settings`
- `feature/blizzard-integration`
- `feature/warcraftlogs-integration`
- `feature/notifications`
- `feature/payouts`

Bad:

- `feature/dashboard`
- `feature/runs-page-button`
- `feature/profile-card`
- `feature/change-badge-color`
- `feature/change-button`

Dashboard, My Runs, Profile, and Manage copy or layout changes belong to the feature that changes the underlying business behavior.

## Commit granularity

Use meaningful commits. Do not commit after every tiny change. Do not collapse a substantial feature into one unstructured commit either.

Target about 2–5 logical commits for a substantial feature where that split is natural. Small features may need only one or two.

Examples for character management:

```text
feat(characters): add persistent character management domain
feat(characters): add character management interface
test(characters): cover ownership and lifecycle rules
docs(characters): document character management workflow
```

WIP or checkpoint commits are acceptable on the feature branch. History that lands on `main` should stay clean.

## Validation before PR

Before opening or merging a pull request, the branch must pass:

- database / Prisma verification where applicable
- migration checks where applicable
- lint
- typecheck
- production build
- complete test suite

Never intentionally merge failing code into `main`.

Feature branches may be pushed at useful checkpoints. Not every commit has to be production-ready.

## Merge

Default for completed feature branches:

1. Push the feature branch
2. Open a pull request
3. Validate
4. **Squash Merge** into `main`
5. Delete the feature branch

Squash Merge gives `main` one cohesive commit per feature while allowing incremental commits during development.

Do not squash or rewrite the initial baseline commit (`chore: establish BoostingHub baseline through roster management`).

## Cleanup

Delete the merged feature branch after squash merge.

## Emergency / fix branches

Use `fix/<issue-name>` for independent defects that are not part of an in-flight feature.

## Infrastructure

Use `chore/<task-name>` for tooling, documentation, and repository hygiene that is not a product feature.
