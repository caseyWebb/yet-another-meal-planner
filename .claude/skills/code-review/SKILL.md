---
name: code-review
description: Adversarially review the ENTIRE current PR (not just the latest commit) before opening or updating it. Thin orchestrator — computes the full PR diff against the merge-base with the default branch and delegates to the code-reviewer subagent. Use before checking the "Code review" box in the PR template, or whenever the user asks to review the branch / PR.
license: MIT
metadata:
  author: groceries-agent
  version: "1.0"
---

Run an adversarial review of the **entire pull request** — every change on this branch since it diverged from the default branch, not just the most recent commit. This skill is intentionally **thin**: it scopes the diff and hands off to the `code-reviewer` subagent, which holds the review logic and this repo's invariants.

## Steps

1. **Scope the whole PR.** The PR is the branch's full divergence from `main`, regardless of commit count or rebases. Establish the range up front:

   ```bash
   git fetch origin main --quiet                 # make sure the base ref is current
   BASE=$(git merge-base origin/main HEAD)       # the point the branch forked from
   git diff --stat "$BASE"...HEAD                 # full PR file list (sanity check)
   ```

   Use the three-dot `"$BASE"...HEAD` range (or `git diff origin/main...HEAD`) so the review covers the *cumulative* PR. **Never** scope to `HEAD~1`, the last commit, or only the working tree — a per-commit review misses bugs introduced and then half-fixed across commits, which is exactly what an end-state PR review must catch. If there are also uncommitted changes, mention them but review the committed PR state as the source of truth.

2. **Delegate to the `code-reviewer` subagent.** Spawn it with the Agent tool (`subagent_type: "code-reviewer"`), passing the merge-base SHA and instructing it to review the full `"$BASE"...HEAD` diff. Do not review inline yourself — the subagent runs the adversarial pass with a clean context and the repo's invariants loaded. For a large PR you may fan out several `code-reviewer` agents over disjoint file groups, but each must still diff against `$BASE` (the whole-PR base), never an intermediate commit.

3. **Relay the findings.** Present the subagent's findings to the user grouped by severity (blocker / should-fix / nit), each with `file:line` and a concrete fix. If it found nothing material, say so plainly. Do not auto-apply fixes unless the user asks — this skill reviews, it doesn't rewrite.

## Notes

- This is the skill the PR template's **Code review** consideration refers to. "Ran it and addressed/triaged the findings" is what checking that box attests to.
- The repo-specific review criteria (the determinism boundary, throw-free tools, `src/db.ts` routing, tenant isolation, docs lockstep, generated `plugin/`, no-secrets) live in the `code-reviewer` subagent, not here — keep this skill thin.
