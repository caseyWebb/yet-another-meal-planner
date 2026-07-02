# pr-checklist-gate Specification

## Purpose

Defines the pull-request quality gate for the public code repo: a `.github/pull_request_template.md` whose checklist of project-specific **considerations** (each box = "I considered this," with the not-applicable case folded into its wording) is enforced by a merge-blocking GitHub Action that fails on a missing template sentinel or any unchecked box. Includes the bot exemption, the `/code-review` skill + `code-reviewer` subagent that one consideration points at, and the contribution-doc references that keep the repo's own agent from being stumped by the gate.
## Requirements
### Requirement: PR template with a considerations checklist

The repository SHALL provide a `.github/pull_request_template.md` that pre-populates every pull request's body with a free-text "What & why" section and a fixed checklist of project-specific **considerations**. The template SHALL carry a stable HTML-comment sentinel (`<!-- pr-checklist:v1 -->`) used for presence detection. Each checklist item SHALL be phrased as a consideration whose not-applicable case is folded into its own wording, so that every item is honestly checkable on every pull request without forcing a false claim. The checklist SHALL cover, at minimum: contract docs kept in lockstep (`docs/TOOLS.md` / `docs/SCHEMAS.md` / `docs/ARCHITECTURE.md`); the tool/skill ownership boundary; D1 access routed through `src/db.ts` with structured errors; a new wrangler binding type added to the `merge-wrangler-config.mjs` allowlist; a D1 schema change shipping a `migrations/d1/NNNN_*.sql` file; `plugin/` not hand-edited; an OpenSpec change archived with deltas synced; no secrets committed (the repo is public); running the repo's `/code-review` skill (an adversarial review of the whole PR) and addressing or triaging its findings; and the admin-UI testing consideration — an admin-panel change extended the Playwright page objects and specs, the suite was run, and the published screenshots were reviewed (or the PR touches no admin UI).

#### Scenario: New PR is prefilled with the checklist

- **WHEN** a contributor opens a pull request against the repository
- **THEN** the PR body is prefilled from `.github/pull_request_template.md`, containing the `<!-- pr-checklist:v1 -->` sentinel, a "What & why" section, and the considerations checklist with every box initially unchecked

#### Scenario: Every consideration is checkable without a false claim

- **WHEN** a pull request touches only a subset of the repo (e.g. docs only)
- **THEN** each checklist item can still be checked truthfully because its not-applicable case ("…or no such change") is part of the item's wording

#### Scenario: Admin-UI consideration is honestly checkable either way

- **WHEN** a pull request changes the admin panel (or, alternatively, touches no admin UI at all)
- **THEN** the admin-UI checklist item is checkable truthfully in both cases: by having extended the page objects/specs, run the suite, and reviewed the screenshots — or because the "no admin UI change" case is part of the item's wording

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

### Requirement: Adversarial whole-PR code-review skill

The repository SHALL provide a `/code-review` skill (`.claude/skills/code-review/SKILL.md`) and a `code-reviewer` subagent (`.claude/agents/code-reviewer.md`) that together perform an adversarial review of a pull request. The skill SHALL be thin: it SHALL compute the full PR diff against the merge-base with the default branch (`git merge-base origin/main HEAD`, reviewed as `BASE...HEAD`) and delegate the review to the `code-reviewer` subagent, rather than embedding the review logic itself. The review SHALL cover the **entirety of the PR** — every change since the branch diverged from the default branch — and SHALL NOT be scoped to a single commit (e.g. `HEAD~1`) or the working tree alone. The `code-reviewer` subagent SHALL hold the repo-specific review criteria (the determinism boundary, throw-free tools, `src/db.ts` routing, multi-tenant isolation, the wrangler-merge allowlist, docs lockstep, generated `plugin/`, and no-secrets) and SHALL report findings only without editing files. The PR template's "Code review" consideration refers to this skill.

#### Scenario: Review covers the whole PR, not the latest commit

- **WHEN** the `/code-review` skill runs on a branch with multiple commits
- **THEN** it reviews the cumulative diff from the merge-base with the default branch through `HEAD`, not just the most recent commit

#### Scenario: Skill delegates to the subagent

- **WHEN** the `/code-review` skill is invoked
- **THEN** it computes the merge-base range and spawns the `code-reviewer` subagent to perform the adversarial review, rather than reviewing inline

#### Scenario: Reviewer reports without editing

- **WHEN** the `code-reviewer` subagent completes its pass
- **THEN** it returns findings grouped by severity with `file:line` and suggested fixes, and makes no edits to the working tree

### Requirement: Contribution docs reference the template and gate

`CLAUDE.md` and `CONTRIBUTING.md` SHALL document that a pull request against this repository uses `.github/pull_request_template.md`, fills the "What & why" section, and checks every consideration before the `pr-checklist` gate will pass, so that a contributor — human or the repo's own agent — is not stumped by the gate. The documentation SHALL note that the gate blocks merge only once the `pr-checklist` check is added to `main`'s branch protection as a required status check.

#### Scenario: Agent opening a PR knows the template is required

- **WHEN** the repository's agent (or a human) prepares a pull request
- **THEN** `CLAUDE.md`/`CONTRIBUTING.md` instruct it to fill the template's "What & why" and check every consideration, and explain that the `pr-checklist` gate must be a required check to block merge
