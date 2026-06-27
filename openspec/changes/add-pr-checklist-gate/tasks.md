# Tasks

## 1. PR template
- [ ] 1.1 Add `.github/pull_request_template.md` with the `<!-- pr-checklist:v1 -->` sentinel, a "What & why" section, and the considerations checklist from design D2 (every item worded with its N/A case folded in; no `- [ ]` inside HTML comments).

## 2. Gate workflow
- [ ] 2.1 Add `.github/workflows/pr-checklist.yml` on `pull_request: types: [opened, edited, synchronize, reopened]`, with no `actions/checkout` and no external `uses:`.
- [ ] 2.2 Pass the PR body via `env:` (not shell interpolation); fail if the sentinel is missing; fail listing the count if any `- [ ]` remains; pass otherwise.
- [ ] 2.3 Exempt bot authors (`github.actor` / PR author ending in `[bot]`) with a neutral pass.

## 3. Make it bite
- [ ] 3.1 Document adding the `pr-checklist` check to `main`'s branch protection as a required status check (the file alone doesn't block merge) — in CONTRIBUTING.md and this change's notes.

## 4. Don't stump the agent
- [ ] 4.1 Update `CLAUDE.md` and `CONTRIBUTING.md`: a PR here uses `.github/pull_request_template.md`, fills "What & why," and checks every consideration before the gate goes green.

## 5. Verify
- [ ] 5.1 Self-review: open this change's own PR using the new template, confirm the gate runs, fails on an unchecked box, and passes once fully checked.
- [ ] 5.2 `openspec validate add-pr-checklist-gate --strict` passes.
