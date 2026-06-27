# Tasks

## 1. PR template
- [x] 1.1 Add `.github/pull_request_template.md` with the `<!-- pr-checklist:v1 -->` sentinel, a "What & why" section, and the considerations checklist from design D2 (every item worded with its N/A case folded in; no `- [ ]` inside HTML comments).

## 2. Gate workflow
- [x] 2.1 Add `.github/workflows/pr-checklist.yml` on `pull_request: types: [opened, edited, synchronize, reopened]`, with no `actions/checkout` and no external `uses:`.
- [x] 2.2 Pass the PR body via `env:` (not shell interpolation); fail if the sentinel is missing; fail listing the count if any `- [ ]` remains; pass otherwise.
- [x] 2.3 Exempt bot authors (`github.actor` / PR author ending in `[bot]`) with a neutral pass.

## 3. Make it bite
- [x] 3.1 Document adding the `pr-checklist` check to `main`'s branch protection as a required status check (the file alone doesn't block merge) — in CONTRIBUTING.md and this change's notes.

## 4. Don't stump the agent
- [x] 4.1 Update `CLAUDE.md` and `CONTRIBUTING.md`: a PR here uses `.github/pull_request_template.md`, fills "What & why," and checks every consideration before the gate goes green.

## 4b. Code-review skill + subagent
- [x] 4b.1 Add the "Code review" consideration to the template.
- [x] 4b.2 Add `.claude/skills/code-review/SKILL.md` — a thin skill that scopes the full PR diff (`git merge-base origin/main HEAD`, reviewed as `BASE...HEAD`, never `HEAD~1`/working-tree) and delegates to the `code-reviewer` subagent.
- [x] 4b.3 Add `.claude/agents/code-reviewer.md` — an adversarial, read-only reviewer preloaded with the repo's invariants; reports findings by severity, never edits.

## 5. Verify
- [x] 5.1 Self-review: open this change's own PR using the new template, confirm the gate runs, fails on an unchecked box, and passes once fully checked.
- [x] 5.2 `openspec validate add-pr-checklist-gate --strict` passes.
