# pr-checklist-gate — deltas

## MODIFIED Requirements

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
