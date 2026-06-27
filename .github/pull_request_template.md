<!-- pr-checklist:v1 -->

## What & why

<!-- One or two sentences: what this changes and why. Link the issue / OpenSpec change if there is one. -->

## Considerations

Check every box — each means "I considered this." The not-applicable case is part
of each item's wording, so there's no honest reason to leave one unchecked.

- [ ] **Docs in lockstep.** Tool params/returns → `docs/TOOLS.md`; a data-file/D1 shape → `docs/SCHEMAS.md`; an architectural shift → `docs/ARCHITECTURE.md` (or no such change).
- [ ] **Tool/skill boundary.** A skill-less agent could use any changed tool from its description alone; *when*-to-call choreography stayed in the skill (or no tool/skill change).
- [ ] **D1 access** goes through `src/db.ts`, never `env.DB`; tools return structured errors, not throws (or no D1 access).
- [ ] **wrangler config.** A new binding type was added to the `merge-wrangler-config.mjs` allowlist; code-level vs operator-owned keys respected (or no binding/config change).
- [ ] **D1 migrations.** A schema change ships a `migrations/d1/NNNN_*.sql` file (or no schema change).
- [ ] **Generated plugin.** `plugin/` was not hand-edited; `AGENT_INSTRUCTIONS.md` or a quoted tool-description change was followed by `aubr build:plugin` (or no such change).
- [ ] **OpenSpec.** If this was an OpenSpec change, it's archived and the deltas are synced into `openspec/specs/` (or not an OpenSpec change).
- [ ] **No secrets.** No secrets, tokens, or personal data added — this repo is public.
- [ ] **Code review.** I ran the repo's `/code-review` skill (adversarial review of the *whole* PR diff, not just the latest commit) and addressed or triaged its findings.
- [ ] **Checks.** `aubr typecheck`, `aubr test`, and `aubr test:tooling` pass locally or on CI.
