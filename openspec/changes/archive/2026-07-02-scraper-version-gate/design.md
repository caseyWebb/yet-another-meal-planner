## Context

`packages/scraper/src/push.ts` resolves `SCRAPER_VERSION` once at module load from `packages/scraper/package.json` `version` (falling back to `"0.0.0"`) and stamps it on every ingest batch as `scraper_version`, alongside the shared `CONTRACT_VERSION`. The Worker records both and the admin liveness view renders a contract-skew chip from them (`build-automation`: "The image SHALL embed the scraper's build version… so a running scraper can report both to the Worker for the admin liveness/skew view").

The release is cut from a `scraper-v*` git tag (`build-automation`: "A scoped release tag (`scraper-v*`) SHALL build the scraper container image…"). The tag and `package.json` `version` are independent, hand-maintained strings, so they can drift: an operator can tag `scraper-v0.2.0` while `package.json` still says `0.1.0`, shipping an image whose running binary reports the wrong version and poisoning the skew view. Nothing in CI catches it.

`ci.yml` has no top-level `paths:` filter; its only path-scoping is a manual `git diff --name-only` inside `trigger-deploy` (and the `admin-ui` publish step), against `HEAD^ HEAD` with `fetch-depth: 2` on the PR merge commit. The deploy path list deliberately omits `packages/scraper/**` (a scraper-only change must not deploy the Worker). The `pr-checklist` gate is a separate, body-only workflow enforcing that every `- [ ]` in the PR body is checked; it exempts authors whose login ends in `[bot]`.

## Goals / Non-Goals

**Goals:**
- One authoritative version for the scraper: `packages/scraper/package.json` `version`.
- A PR that changes the scraper (or the contract it imports) cannot merge without moving that version forward.
- Zero new secrets, zero CI commits, zero coupling to the Worker deploy control plane.

**Non-Goals:**
- Deriving the release tag / image tag from `package.json` (companion `scraper-auto-release`).
- Versioning the Worker or the contract package themselves (the contract carries its own `CONTRACT_VERSION`, governed elsewhere).
- Auto-bumping the version in CI — the human owns the semver decision (patch vs minor vs major) in their PR.

## Decisions

### 1. `package.json` `version` is the single source of truth

The running scraper already reports `package.json` `version`; the companion release will publish from it. Making it authoritative — and gating it — closes the tag/package drift: the reported version, the image, and the release tag all trace to one value. A tag alone can't be the SoT because the running binary reads `package.json`, not the tag; a separate `VERSION` file would just add a third string to keep in sync.

### 2. The gate is a PR-only, diff-vs-base, strictly-greater check

A new job in `ci.yml` gated `if: github.event_name == 'pull_request'` — a push to `main` has no base to compare against, and `workflow_dispatch` likewise. Checkout with `fetch-depth: 0` so the base branch ref is present (the manual `HEAD^ HEAD` / `fetch-depth: 2` trick the other jobs use reads the merge commit's first parent, but comparing package.json versions wants the base tip explicitly). Determine touched paths:

```
git diff --name-only "origin/${{ github.base_ref }}...HEAD" -- packages/scraper packages/contract
```

Three-dot (`...`): the changes introduced since the merge-base — this PR's changes. Empty → pass as a no-op. Otherwise read the base version (`git show "origin/${{ github.base_ref }}:packages/scraper/package.json"`) and the head version (the checked-out file) and FAIL unless head `>` base.

Comparison is **strictly greater by semver** — recommended over "merely changed": the companion release derives the image tag and Release name from this version, so monotonicity is the real invariant. Strict-greater blocks an accidental downgrade or a lateral edit (`0.1.0 → 0.1.0-wip`) that a "changed" check would wave through. The scraper's versions are plain `major.minor.patch`, so a dependency-free inline numeric compare in `node -e` suffices; a `semver` lib is warranted only if prerelease ordering is ever needed (it isn't today). "Merely changed" is the cheaper fallback if the strict compare proves fussy in the runner, but it is a weaker guarantee.

### 3. The contract package fans into the gate

`build-automation` already states a `packages/contract/**` change "affects the scraper image" and fans out to both pipelines. The scraper imports the contract via `workspace:*`, so a contract change reshapes the scraper's behavior even with no scraper-package edit. The gate therefore treats a contract change identically: it, too, must bump the scraper's `version`. Bumping the scraper version on a contract change is the correct primitive here; whether the contract also carries its own independent version is out of scope.

### 4. Bot-authored PRs are exempt

Mirroring the `pr-checklist` gate: a PR whose author login ends in `[bot]` (e.g. a dependency bump that edits `packages/scraper/package.json`'s dependency block without touching `version`) gets a neutral pass, so automated PRs aren't permanently wedged behind a gate they can't satisfy. Human PRs are always gated. This keeps the gate consistent with the repo's other author-aware gate and with `dependency-automation`.

### 5. No secrets, no commits, not the deploy token

The check is pure git against the checkout — no API calls — so `permissions: contents: read` and the built-in `GITHUB_TOKEN` are sufficient. It MUST NOT use `DATA_REPO_ACTIONS_TOKEN` (that token is scoped to dispatching the data-repo deploy; this gate has nothing to do with deployment). The gate only ever fails or passes; it never writes a bump back — that would need `contents: write` and would override the human's semver intent, exactly what this change refuses.

### 6. The PR-template item rides the existing checklist gate

One new `- [ ]` considerations item is added to `.github/pull_request_template.md`, phrased with its not-applicable case folded in (per the `pr-checklist-gate` contract): e.g. "**Scraper version.** A change under `packages/scraper/**` or the shared contract (`packages/contract/**`) bumped `packages/scraper/package.json` `version` (or no scraper/contract change)." The `pr-checklist-gate` spec's template requirement enumerates its checklist "at minimum," so adding an item needs **no** `pr-checklist-gate` spec delta — the enumerated set is a floor, not a ceiling. The CI job is the hard enforcement; the checklist item is the human-facing reminder — the same belt-and-suspenders pattern the repo uses for admin-UI tests.

## Alternatives Considered

- **Changesets / release-please.** Full-featured version + changelog + release automation. Rejected: heavyweight for a single private workspace package with no changelog and no npm-publish requirement; both want to own the release/tag flow, which the companion `scraper-auto-release` deliberately keeps as a thin `scraper-v*`-tag workflow. This change needs only a bump gate, not a release manager.
- **Merely-changed (not strictly-greater).** The simplest diff. Rejected as the primary rule — weaker monotonicity, allows downgrades and lateral edits — but retained as the fallback if a semver compare is fussy in the runner.
- **A separate workflow file (like `pr-checklist.yml`).** Rejected: unlike the body-only checklist gate, this check needs a checkout + git history, so it belongs with the other checkout-based jobs in `ci.yml`; a separate file buys nothing.
- **Auto-bump in CI.** Rejected: erases the human's semver choice, needs `contents: write`, and produces CI commits — explicitly out per the change's intent.

## Out of Scope

- **The auto-release itself** — deriving the `scraper-v*` tag / GHCR image tag / Release from `package.json` `version` is the companion `scraper-auto-release` change. This change makes the version authoritative and enforced; the companion consumes it.
- Versioning the Worker or the contract package.
- Editing `docs/*` contract docs (no tool, data-shape, or architecture change).

## Verification

- Fixture PR touching `packages/scraper/**` with no bump → gate fails; add a strictly-greater bump → passes.
- Fixture PR touching `packages/contract/**` with no bump → gate fails.
- A PR touching only `docs/` or the Worker → gate no-ops (pass).
- A bot-authored PR touching scraper paths without a bump → neutral pass.
- `openspec validate "scraper-version-gate" --strict`.
- **Archive before merge:** the `no-open-changes` job fails while `openspec/changes/scraper-version-gate/` is unarchived, so the implementer runs `/opsx:archive` before the PR can merge.
