# Design

## D1 — "Considerations," not "tasks done": the framing that makes the gate honest

A merge gate that demands every checkbox be `[x]` collides with reality: most PRs touch a slice of the repo, so most checklist items don't apply. If a box means *"I did this thing,"* a docs-only PR is forced to check "new D1 migration added" — a lie — or leave it unchecked and be blocked forever. Conditional logic (only require the migration box if `migrations/` changed) was considered and **rejected**: it needs a path→box mapping that drifts from the checklist and turns a 30-line gate into a brittle diff analyzer.

Instead each box is a **consideration**: checking it asserts *"I considered this,"* and the not-applicable case is folded into the item text ("…or no tool changed"). Now every box is honestly checkable on every PR, "fully checked" means "you weighed every consideration," and the gate stays a dumb `- [ ]` scan. This is the only framing where *all-boxes-required* is both enforceable and non-corrupting.

```
   "[x] docs/TOOLS.md updated"          → forces a lie when no tool changed
   "[x] Tool contract changed?
        → TOOLS.md updated (or no tool changed)"   → always honestly checkable
```

## D2 — The considerations, and why each earns a slot

Each item maps to a rule this repo states explicitly and that **CI does not already enforce** (a checklist that re-asks "did tests pass?" is noise). The line is: CI owns the mechanical gates; the checklist owns the judgment calls.

| Consideration | Source rule | Why not just CI? |
| --- | --- | --- |
| Docs in lockstep (`TOOLS`/`SCHEMAS`/`ARCHITECTURE`) | CLAUDE.md "keep contract docs in lockstep"; stated 3× | No machine check for doc/code drift |
| Tool/skill ownership boundary | CONTRIBUTING.md ownership-boundary test | Pure judgment ("skill-less agent could use it?") |
| D1 via `src/db.ts`, structured errors not throws | CLAUDE.md "tools never touch `env.DB`" | Review judgment, not gated |
| New binding type added to merge allowlist | CLAUDE.md / CONTRIBUTING.md silent-drop trap | Silently drops; no failing signal exists |
| D1 schema → `migrations/d1/NNNN_*.sql` | CONTRIBUTING.md "D1 Migrations" | Easy to omit the file; not gated |
| `plugin/` not hand-edited | CLAUDE.md "generated; never hand-edit" | CI checks `skills/` drift only, not manifest/other hand-edits |
| OpenSpec archived + specs synced | OpenSpec workflow | `no-open-changes` blocks unarchived dirs, not "specs synced" |
| No secrets — repo is public | CLAUDE.md "don't commit secrets" | Irreversible; deserves a deliberate pause |
| Tests/typecheck considered | toolchain | Staple; CI is source of truth, box is the prompt |

The concrete template body (final wording lives in the implemented file):

```markdown
<!-- pr-checklist:v1 -->

## What & why

<!-- One or two sentences: what changes and why. Link the issue / OpenSpec change. -->

## Considerations

Check every box — each means "I considered this." The wording covers the
not-applicable case, so there's no honest reason to leave one unchecked.

- [ ] **Docs in lockstep.** Tool params/returns → `docs/TOOLS.md`; data-file/D1 shape → `docs/SCHEMAS.md`; architectural shift → `docs/ARCHITECTURE.md` (or no such change).
- [ ] **Tool/skill boundary.** A skill-less agent could use any changed tool from its description alone; *when*-to-call choreography stayed in the skill (or no tool/skill change).
- [ ] **D1 access** goes through `src/db.ts`, never `env.DB`; tools return structured errors, not throws (or no D1 access).
- [ ] **wrangler config.** A new binding type was added to the `merge-wrangler-config.mjs` allowlist; code-level vs operator-owned keys respected (or no binding/config change).
- [ ] **D1 migrations.** A schema change ships a `migrations/d1/NNNN_*.sql` file (or no schema change).
- [ ] **Generated plugin.** `plugin/` was not hand-edited; `AGENT_INSTRUCTIONS.md`/quoted-tool-description changes were followed by `aubr build:plugin` (or no such change).
- [ ] **OpenSpec.** If this was an OpenSpec change, it's archived and deltas are synced into `openspec/specs/` (or not an OpenSpec change).
- [ ] **No secrets.** No secrets, tokens, or personal data added — this repo is public.
- [ ] **Code review.** Ran the repo's `/code-review` skill (adversarial review of the *whole* PR diff) and addressed/triaged findings.
- [ ] **Checks.** `aubr typecheck`, `aubr test`, `aubr test:tooling` pass locally or on CI.
```

## D3 — Why a separate workflow, not a job in `ci.yml`

The gate must re-evaluate when the **PR body** changes, which only fires `pull_request: edited`. `ci.yml` listens on the default `pull_request` types (no `edited`); adding `edited` there would re-run typecheck + both test suites every time someone fixes a typo in the description. A dedicated `pr-checklist.yml` scoped to `[opened, edited, synchronize, reopened]` keeps the expensive jobs off the `edited` trigger. `ci.yml`'s header comment ("the only push-triggered workflow") stays true — the new file is `pull_request`-only.

## D4 — No external action, no checkout, no comment

The body is available as `github.event.pull_request.body`; the job needs nothing from the repo tree, so it skips `actions/checkout` and any marketplace action — which also sidesteps the repo's SHA-pinning convention (no `uses:` to pin) and keeps the gate dependency-free. The body is passed via `env:` (not interpolated into the shell line) so a crafted PR description can't inject commands. Output is gate-only: a clear failing log listing the offending state (sentinel missing / N boxes unchecked), no PR comment — chosen for minimal permissions (no `pull-requests: write`).

## D5 — Edge cases

- **Sentinel absent** (body wiped/replaced) → fail. Without it, an empty body has zero unchecked boxes and would vacuously pass; the `<!-- pr-checklist:v1 -->` marker is the presence proof. Versioned so the template can evolve without silently accepting stale copies.
- **Bot authors** (`endsWith('[bot]')`) → skip with a neutral pass; Dependabot can't fill a template.
- **Boxes inside `<!-- -->` comments** → the template puts no `- [ ]` inside comments, and the scan can ignore commented regions; documented so future edits don't reintroduce the hazard.
- **Required-check bootstrapping** → the workflow only *produces* a check; an admin must add `pr-checklist` to `main` branch protection for it to block merge. Called out in tasks + CONTRIBUTING so it isn't a silent no-op.

## D7 — The "Code review" consideration: a thin skill over an adversarial subagent

One consideration isn't self-attested prose — it points at a tool: `/code-review`. Two artifacts back it:

- **`.claude/skills/code-review/SKILL.md`** — a *thin* orchestrator. It computes the PR's full scope and delegates; it holds no review logic. Keeping it thin means the review criteria have exactly one home (the subagent), matching the repo's "each fact in one place" discipline.
- **`.claude/agents/code-reviewer.md`** — the adversarial reviewer, read-only (`Read`/`Grep`/`Glob`/`Bash`), preloaded with this repo's invariants (determinism boundary, throw-free tools, `src/db.ts` routing, tenant isolation, the wrangler-merge allowlist, docs lockstep, generated `plugin/`, no-secrets). It reports findings by severity; it never edits.

**Whole-PR, not last-commit — the core requirement.** The skill scopes the diff to the merge-base with the default branch:

```
   git fetch origin main
   BASE=$(git merge-base origin/main HEAD)
   git diff "$BASE"...HEAD        # the ENTIRE PR
```

`HEAD~1` / "the latest commit" / the working tree are explicitly forbidden scopes. A per-commit review misses the classic failure mode where a defect is introduced in commit A and half-fixed in commit C — only the cumulative end-state reveals it. Three-dot range (`BASE...HEAD`) gives exactly the branch's divergence regardless of rebases or commit count. For a large PR the skill may fan out several `code-reviewer` agents over disjoint file groups, but each still diffs against `$BASE`, never an intermediate commit.

Note this is a *local pre-merge* skill (a checklist attestation), deliberately **not** wired into `pr-checklist.yml` — the gate verifies the box is checked, not that a review happened. Enforcing "a review actually ran" in CI would mean trusting a self-reported marker anyway; the honest contract is the same as every other consideration.

## D6 — Keep the agent from being stumped

The same gate applies to PRs this repo's own agent opens. `CLAUDE.md` and `CONTRIBUTING.md` gain a short note: a PR here uses `.github/pull_request_template.md`, fills "What & why," and checks every consideration before the `pr-checklist` gate will go green. This turns the gate from a surprise blocker into a known step.
