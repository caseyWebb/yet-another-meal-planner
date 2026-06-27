## ADDED Requirements

### Requirement: PR template with a considerations checklist

The repository SHALL provide a `.github/pull_request_template.md` that pre-populates every pull request's body with a free-text "What & why" section and a fixed checklist of project-specific **considerations**. The template SHALL carry a stable HTML-comment sentinel (`<!-- pr-checklist:v1 -->`) used for presence detection. Each checklist item SHALL be phrased as a consideration whose not-applicable case is folded into its own wording, so that every item is honestly checkable on every pull request without forcing a false claim. The checklist SHALL cover, at minimum: contract docs kept in lockstep (`docs/TOOLS.md` / `docs/SCHEMAS.md` / `docs/ARCHITECTURE.md`); the tool/skill ownership boundary; D1 access routed through `src/db.ts` with structured errors; a new wrangler binding type added to the `merge-wrangler-config.mjs` allowlist; a D1 schema change shipping a `migrations/d1/NNNN_*.sql` file; `plugin/` not hand-edited; an OpenSpec change archived with deltas synced; and no secrets committed (the repo is public).

#### Scenario: New PR is prefilled with the checklist

- **WHEN** a contributor opens a pull request against the repository
- **THEN** the PR body is prefilled from `.github/pull_request_template.md`, containing the `<!-- pr-checklist:v1 -->` sentinel, a "What & why" section, and the considerations checklist with every box initially unchecked

#### Scenario: Every consideration is checkable without a false claim

- **WHEN** a pull request touches only a subset of the repo (e.g. docs only)
- **THEN** each checklist item can still be checked truthfully because its not-applicable case ("…or no such change") is part of the item's wording

### Requirement: Merge-blocking checklist gate

The repository SHALL provide a GitHub Actions workflow (`.github/workflows/pr-checklist.yml`) triggered on `pull_request` for the `opened`, `edited`, `synchronize`, and `reopened` types that inspects the pull request body and reports a check status. The workflow SHALL fail the check when the `<!-- pr-checklist:v1 -->` sentinel is absent from the body, or when any unchecked checkbox (`- [ ]`) remains; otherwise it SHALL pass. The workflow SHALL read the pull request body via an environment variable rather than interpolating it into a shell command, and SHALL require no repository checkout and no external (`uses:`) action. The workflow SHALL NOT post a comment on the pull request. This workflow SHALL be separate from `ci.yml` so that editing a PR body re-runs only this gate and not the test suites.

#### Scenario: Unchecked box blocks merge

- **WHEN** a pull request body contains the sentinel but at least one `- [ ]` is left unchecked
- **THEN** the `pr-checklist` check fails with a message naming how many boxes remain unchecked

#### Scenario: Missing template blocks merge

- **WHEN** a pull request body does not contain the `<!-- pr-checklist:v1 -->` sentinel
- **THEN** the `pr-checklist` check fails rather than passing on an empty body

#### Scenario: Fully-checked checklist passes

- **WHEN** a pull request body contains the sentinel and every checkbox is `- [x]`
- **THEN** the `pr-checklist` check passes

#### Scenario: Editing the body re-evaluates without re-running tests

- **WHEN** a contributor edits only the pull request description to check a box
- **THEN** the `pr-checklist` workflow re-runs on the `edited` event and the heavyweight `ci.yml` test jobs do not

### Requirement: Bot pull requests are exempt

The checklist gate SHALL exempt pull requests authored by bots (a PR author whose login ends in `[bot]`, e.g. `dependabot[bot]`) by reporting a neutral pass, so that automated dependency pull requests are not permanently blocked by an unfilled template.

#### Scenario: Dependabot PR is not blocked

- **WHEN** Dependabot opens a pull request whose body does not match the template
- **THEN** the `pr-checklist` check passes instead of failing

### Requirement: Contribution docs reference the template and gate

`CLAUDE.md` and `CONTRIBUTING.md` SHALL document that a pull request against this repository uses `.github/pull_request_template.md`, fills the "What & why" section, and checks every consideration before the `pr-checklist` gate will pass, so that a contributor — human or the repo's own agent — is not stumped by the gate. The documentation SHALL note that the gate blocks merge only once the `pr-checklist` check is added to `main`'s branch protection as a required status check.

#### Scenario: Agent opening a PR knows the template is required

- **WHEN** the repository's agent (or a human) prepares a pull request
- **THEN** `CLAUDE.md`/`CONTRIBUTING.md` instruct it to fill the template's "What & why" and check every consideration, and explain that the `pr-checklist` gate must be a required check to block merge
