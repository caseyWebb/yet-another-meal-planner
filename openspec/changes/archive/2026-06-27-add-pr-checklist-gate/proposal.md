## Why

This repo is rule-dense and several of its most-repeated rules are **drift risks CI cannot catch**: keeping `docs/TOOLS.md`/`SCHEMAS.md`/`ARCHITECTURE.md` in lockstep with code, the tool/skill ownership boundary, routing D1 through `src/db.ts`, adding a new binding type to the `merge-wrangler-config.mjs` allowlist (the silent-drop trap that once shipped the `ai` binding undeployed), and "no secrets — the repo is public." CI already hard-enforces the *mechanical* gates (`no-open-changes`, skills-drift `diff`, typecheck + tests); the *judgment* rules have no checkpoint and live only in `CLAUDE.md`/`CONTRIBUTING.md` prose that a contributor — human or agent — easily skips.

A PR template that lists these as **considerations** (each box = "I considered this," with the not-applicable case folded into the wording so every box is honestly checkable on every PR) gives that checkpoint a home, and a merge-blocking Action makes "I read the considerations" a precondition for merge rather than a hope.

## What Changes

- Add **`.github/pull_request_template.md`**: a short "What & why" free-text section plus a fixed **considerations checklist** drawn from this repo's own rules, carrying an HTML-comment sentinel (`<!-- pr-checklist:v1 -->`) for presence detection. Each item is worded as a consideration with the N/A case built in, so a fully-checked list is always achievable and never forces a false check.
- Add **`.github/workflows/pr-checklist.yml`**: a `pull_request`-only workflow (`types: [opened, edited, synchronize, reopened]`) that reads the PR body and **fails** if the sentinel is absent or any unchecked box (`- [ ]`) remains. Bot authors (`*[bot]`, e.g. `dependabot[bot]`) are exempted. It runs **no external action and no checkout** — it reads the body from an env var to avoid shell-injection and the SHA-pinning surface — and posts **no comment** (gate-only). Making it merge-blocking is a branch-protection setting documented in the change, not a repo file.
- Add a **`/code-review` skill** (`.claude/skills/code-review/SKILL.md`) and a **`code-reviewer` subagent** (`.claude/agents/code-reviewer.md`): a thin skill that scopes the *entire* PR diff (merge-base with the default branch, `BASE...HEAD` — never just the latest commit) and delegates to an adversarial, read-only reviewer preloaded with this repo's invariants. One PR-template consideration ("Code review") attests to having run it.
- Update **`CLAUDE.md`** and **`CONTRIBUTING.md`** so a contributor (human or agent) opening a PR knows the template exists, must fill the "What & why", and must check every consideration — so the agent's own PRs aren't stumped by the new gate.

## Capabilities

### New Capabilities
- `pr-checklist-gate`: the PR template's considerations checklist and the merge-blocking Action that enforces its presence and completeness.

### Modified Capabilities
<!-- None. CLAUDE.md/CONTRIBUTING.md updates are doc edits, not a spec'd capability change. -->

## Impact

- **New:** `.github/pull_request_template.md`, `.github/workflows/pr-checklist.yml`, `.claude/skills/code-review/SKILL.md`, `.claude/agents/code-reviewer.md`.
- **Edited:** `CLAUDE.md`, `CONTRIBUTING.md` (reference the template + gate).
- **Repo setting (manual, documented):** add the `pr-checklist` check to `main`'s branch protection as a required status check — the Action blocks merge only once it's marked required.
- **CI:** independent of `ci.yml`; deliberately a separate workflow so a PR-body edit re-runs only the lightweight gate, not the test suite.
- **Bots:** Dependabot PRs are exempted, so weekly dependency PRs are not permanently blocked.
