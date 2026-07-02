## Why

The scraper reports its own version to the Worker on every ingest batch — `readScraperVersion()` in `packages/scraper/src/push.ts` reads `packages/scraper/package.json` `version` and stamps it as `scraper_version`, which the admin liveness/skew view renders. Nothing forces that version to move when the scraper changes. The release path is driven by a `scraper-v*` git tag, so the tag and `package.json` `version` are two hand-maintained strings that can silently drift: an operator can tag `scraper-v0.2.0` while `package.json` still says `0.1.0`, shipping an image whose running binary reports the wrong version and quietly poisoning the admin skew chip. There is no source of truth, and CI never notices. Make `packages/scraper/package.json` `version` the single source of truth and gate every PR that touches the scraper (or the shared contract it imports) on a version bump, so the reported version, the published image, and the release tag can never disagree.

## What Changes

- Establish `packages/scraper/package.json` `version` (semver) as the **single source of truth** for the scraper's version — the value the running scraper reports, and the value the companion release publishes.
- Add a **merge-blocking CI gate** (a new `pull_request`-only job in `.github/workflows/ci.yml`) that FAILS a PR touching `packages/scraper/**` or `packages/contract/**` unless that PR bumps the `version` to a value strictly greater (by semver) than its base. A PR touching neither → the gate is a no-op pass. The gate never commits — the human bumps the version in their PR.
- Fan the contract in: `build-automation` already treats a `packages/contract/**` change as "affecting the scraper image," and the scraper imports it via `workspace:*`, so a contract change must also bump the scraper version.
- Add one `- [ ]` **considerations item** to `.github/pull_request_template.md` so the bump rides the existing `pr-checklist` gate as a human-facing reminder.
- Document the scraper-versioning rule in `CONTRIBUTING.md`.

## Capabilities

### Modified Capabilities

- `build-automation`: gains the scraper-version single-source-of-truth rule and the PR version-bump gate (diff-vs-base, strictly-greater semver, `pull_request`-only, `GITHUB_TOKEN`-only, bot-exempt, no CI commits).

## Impact

- **CI:** a new `scraper-version` job in `.github/workflows/ci.yml` — `pull_request`-only, `actions/checkout` with `fetch-depth: 0`, `permissions: contents: read`. To block merge it is added to `main`'s required status checks (an operator repo-settings step, like the repo's other gates).
- **PR template:** one new considerations checkbox; the `<!-- pr-checklist:v1 -->` sentinel and section structure are unchanged (the `pr-checklist` gate still enforces "every box checked"). No `pr-checklist-gate` spec delta — that spec enumerates its checklist "at minimum," so the set is a floor.
- **Docs:** `CONTRIBUTING.md` gains a short scraper-versioning subsection. No `docs/TOOLS.md` / `docs/SCHEMAS.md` / `docs/ARCHITECTURE.md` change (no tool, data-shape, or architecture change).
- **No code, no migrations, no secrets.** The gate reads git against the checkout only; it uses the built-in `GITHUB_TOKEN` and MUST NOT use `DATA_REPO_ACTIONS_TOKEN`.
- **Out of scope:** deriving the `scraper-v*` tag / GHCR image tag / Release from `package.json` `version` is the companion `scraper-auto-release` change. This change makes the version authoritative and enforced; the companion consumes it.
