## Context

Two hand-authored context sources reach the agent at runtime: the plugin skills (generated from `AGENT_INSTRUCTIONS.md` by `scripts/build-plugin.mjs`) and the MCP tool descriptions (in `src/`, shipped via the connector). The build only generates skills — it never touches tool descriptions — so the two drift and overlap independently. A duplication audit across all 8 tool files plus `AGENT_INSTRUCTIONS.md` produced a concrete map: pure duplicates, choreography stranded in tool descriptions, and (the higher-value half) arg-contract/field-semantics stranded only in skills.

Separately, the persona library skills (`grocery-core`, `grocery-cart`, `grocery-corpus`) are reference-loaded via each workflow's prerequisite line. Today they avoid auto-triggering only via "intentionally minimal descriptions," but they still appear in user-facing slash discovery. The platform exposes `user-invocable: false` (verified in Claude Code docs) which hides a skill from user discovery while keeping it model-loadable; whether **claude.ai** honors it is undocumented.

## Goals / Non-Goals

**Goals:**
- One canonical home for every description fact: capability/contract/field-semantics in the tool, choreography in the skill.
- Close the off-script gap — field semantics the agent needs become readable from the tool alone.
- Remove the three library skills from user discovery so the slash surface is only real front doors.
- Encode the boundary as a durable maintenance convention, not a one-off pass.

**Non-Goals:**
- No tool behavior, schema, or Worker change — description text only.
- No change to which flows exist or to the persona content itself.
- The `grocery_list_ops` capability (separate change `grocery-list-batch-ops`).
- Reducing tool *count* — the surface is already correctly scoped; this trims description *weight* and entry-point *visibility*.

## Decisions

### D1: The ownership boundary, with guarantees staying tool-side

The test: *could a different agent with no skills use this tool correctly and safely from its description alone?* Everything needed for that is the tool's. The subtle case is **negative guarantees** — "never auto-applies substitutions", "rejects `last_cooked`", "returns facts not freshness verdicts." These read like policy but are **contract**: they stay in the tool. The skill's matching choreography ("offer subs and let me pick") stays skill-side. They are two halves, not a duplicate — so the dedup is bidirectional, not a one-way "move policy to skills."

### D2: The dedup is bidirectional; the reverse direction is the higher-value half

Moving stranded field-semantics *into* tool descriptions (`requires_equipment`, `perishable_ingredients`, `standalone`, `pairs_with`, the "due" definition, the "`not_found` on empty is normal" signal) is worth more than deleting duplicated prose: it closes a latent correctness gap where an off-script or cold MCP caller can't discover how a field is classified. Token savings from the forward direction are modest (~hundreds); the reverse direction is about safety, not size.

### D3: The don't-gut-the-skill guardrail

A skill has two jobs the tool can never do: load its prerequisite library skills, and carry the cross-tool choreography. So a dedup edit MAY remove a pure contract/guarantee sentence from a skill, but MUST NOT remove a prerequisite line or an orchestration step. The `retrospective` period enum is the canonical safe removal — it is pure arg-contract, the tool is its home, and the `cooking-retrospective` skill retains its prerequisite line and its "summarize the patterns that matter, tie to diet principles" choreography.

### D4: `user-invocable: false` on the library skills — gated on a claude.ai live test

`renderLibrarySkill` emits `user-invocable: false`; workflow skills are unchanged. This strengthens the existing "minimal description" mechanism: instead of merely hoping the libraries don't auto-trigger, they are explicitly removed from user discovery while staying model-loadable by reference. Because claude.ai's honoring of the flag is undocumented, the change is **gated on a live test**: install the rebuilt bundle on claude.ai and confirm (a) the libraries no longer appear in `/` and (b) a workflow still pulls in `grocery-core`. The failure mode is benign — if claude.ai ignores the flag, the libraries remain visible exactly as today (no regression).

Alternative considered: `disable-model-invocation: true`. Rejected — it blocks the model from auto-loading, which would break reference loading; the wrong direction.

### D5: The unifying principle — entry points follow triggers

Stated once in `CLAUDE.md`, covering both surfaces: *a capability gets an entry point on a channel iff a real trigger exists for that channel.* Tools: a granular tool iff a single-edit trigger exists; a `commit_changes` field iff it is part of a multi-write flow (the `grocery-list-batch-ops` taxonomy). Skills: `user-invocable` iff a real user trigger exists; otherwise library-only by reference. The same rule files both a new tool field and a hidden library skill.

## Risks / Trade-offs

- **claude.ai silently ignores `user-invocable: false`** → benign: libraries stay visible as today; the dedup half of the change still stands. The live test catches it before we rely on it.
- **A dedup edit removes a load-bearing skill line** → mitigated by the D3 guardrail and by review against the audit map (edits are surgical, not a rewrite).
- **A guarantee gets moved to a skill by mistake** (the D1 trap) → mitigated by the "could a cold caller use it safely?" test applied per edit.
- **Description edits drift `docs/TOOLS.md`** → `docs/TOOLS.md` is updated in the same pass per the repo's no-drift convention.

## Migration Plan

1. Record the ownership boundary + channel-trigger principle in `CLAUDE.md`.
2. Apply the dedup edits (tool descriptions in `src/`, skill/policy text in `AGENT_INSTRUCTIONS.md`), keeping `docs/TOOLS.md` in sync.
3. Emit `user-invocable: false` from `renderLibrarySkill`; add a build-plugin unit test asserting it appears on library skills only.
4. `typecheck` + both test suites; rebuild the plugin.
5. **Gate:** live-test the flag on claude.ai (discovery hidden; reference load intact). If unsupported, keep the dedup, drop/park the flag.
6. Merge; deploy the Worker (description-only, but the connector serves the updated text).

Rollback: description edits and the frontmatter flag are both reversible without data or schema impact.

## Open Questions

- Does claude.ai honor `user-invocable: false`? Resolved by the step-5 live test, not by assumption.
