## 1. CI version-bump gate

- [x] 1.1 Add a `scraper-version` job to `.github/workflows/ci.yml`, gated `if: github.event_name == 'pull_request'` (combined with the bot exemption); `permissions: contents: read`; `actions/checkout` with `fetch-depth: 0` (pinned to the same `@9c091bb…9dddfe3e0 # v7.0.0` SHA the other jobs use).
- [x] 1.2 Detect touched paths: `git diff --name-only "origin/$BASE...HEAD" -- packages/scraper packages/contract`; if empty, echo "no scraper/contract change" and exit 0 (no-op pass).
- [x] 1.3 When touched: read the base version (`git show "origin/$BASE:packages/scraper/package.json"`) and the head version; FAIL via a dependency-free `node -e` strictly-greater semver compare, emitting a clear `::error::` naming both versions and the fix (bump `packages/scraper/package.json` `version`).
- [x] 1.4 Exempt bot authors (login ending in `[bot]`) via `&& !endsWith(github.event.pull_request.user.login, '[bot]')` in the job `if`, mirroring `pr-checklist.yml`.
- [x] 1.5 Uses only the built-in `GITHUB_TOKEN` (git-only, no API calls); does not reference `DATA_REPO_ACTIONS_TOKEN`; the job never commits.

## 2. PR template

- [x] 2.1 Added one `- [ ]` considerations item to `.github/pull_request_template.md` (the 12th; scraper-version bump, not-applicable case folded into the wording). The `<!-- pr-checklist:v1 -->` sentinel and section headings are intact.

## 3. Spec + docs

- [x] 3.1 Applied the `build-automation` spec delta into the living `openspec/specs/build-automation/spec.md` by appending the new `### Requirement:` + its scenarios after the existing requirements (the multi-arch requirement left undisturbed).
- [x] 3.2 `CONTRIBUTING.md`: added a `### Scraper versioning` subsection after `### Deployment` (package.json `version` is the SoT; a scraper/contract PR bumps it strictly-greater; the `scraper-version` gate enforces it; merge-blocking once added to `main`'s required checks).

## 4. Verification

- [x] 4.1 Version-compare logic exercised in isolation against the required pairs (`0.1.0`→`0.1.0` fails, `0.1.0`→`0.2.0` passes, `0.1.0`→`0.1.1` passes, `0.2.0`→`0.1.0` fails). `ci.yml` parses as valid YAML. Live fixture PRs against the real gate are covered once the check runs on a PR.
- [ ] 4.2 `openspec validate "scraper-version-gate" --strict` — the `openspec` CLI is not installed in this environment; heading levels + scenario shape hand-verified. Run `/code-review` on the diff before opening the PR.
- [x] 4.3 Archived: `openspec/changes/scraper-version-gate` → `openspec/changes/archive/2026-07-02-scraper-version-gate`; no open change dir remains, so `no-open-changes` passes. To make the gate merge-blocking, add the `scraper-version` check to `main`'s required status checks (operator repo-settings step, as with the other gates).
