## Context

`storage_guidance/` is a curated, shared, **read-only** markdown corpus at the data-repo root, keyed by ingredient-storage *class*, surfaced at put-away. Its read tools are `list_storage_guidance` / `read_storage_guidance`; it has **no write path** by deliberate spec ("there is no `update_storage_guidance` (or equivalent write) tool") because storage advice is folklore-prone and the team wanted human vetting.

Members also accumulate general *cooking* wisdom from trusted sources (ATK, Serious Eats) that has no home today: recipe notes are per-recipe, and storage guidance is about put-away, not technique. We want that wisdom captured **by the agent on the member's say-so** and referenced during a guided cook.

Two relevant existing postures bound the design:
- **Read/surface posture** — storage guidance: shared corpus, class/slug-keyed, agent maps via world-knowledge (no manifest), 2–3 non-obvious tips, silence over invention.
- **Shared + agent-writable posture** — `stores/`, `feeds.toml`, `discovery_sources.toml`: shared corpus any MCP holder may write with no extra gate.

The new corpus needs the *read* posture of storage guidance and the *write* posture of stores. The member chose to **unify** the read tools into one generic pair over a `guidance/<domain>/` umbrella.

## Goals / Non-Goals

**Goals:**
- A shared, agent-writable `cooking_techniques` corpus, keyed by technique slug, distilled from member-supplied sources.
- A single generic guidance tool surface (`list_guidance` / `read_guidance` / `save_guidance`) over `guidance/<domain>/`, extensible to future domains.
- Relocate the storage corpus under the same umbrella (`guidance/ingredient_storage/`) with zero content/behavior change and its read-only guarantee intact.
- Surface technique memories inline at the matching step during the `cook` flow; capture them via a new skill.

**Non-Goals:**
- No D1 table — this stays GitHub-hosted curated markdown (like recipes / storage guidance).
- No ingredient/step → technique manifest or alias table (mapping is agent world-knowledge, like storage).
- No auto-extraction of techniques from arbitrary recipe imports; capture is member-initiated in v1.
- No per-recipe technique pinning (that overlaps recipe notes); techniques are cross-recipe.
- No relational/`_`-prefixed cross-entry files for techniques in v1 (techniques are naturally flat, unlike storage's `_ethylene`).

## Decisions

### D1. One generic read pair over `guidance/<domain>/`, replacing the storage-specific tools
`list_guidance(domain?)` returns slugs (+ optional `description`) — for one domain when given, or all domains grouped when omitted. `read_guidance(domain, slugs)` returns the named entries' content. `domain` is a small controlled vocabulary (`ingredient_storage`, `cooking_techniques`), validated and path-safe (rejects traversal / unknown domains with a structured error).

- *Why:* the member's explicit choice; collapses two near-identical corpora behind one extensible surface; a future guidance domain needs no new tool.
- *Alternatives:* (a) keep `list_storage_guidance`/`read_storage_guidance` and add a parallel `*_cooking_techniques` pair — rejected as duplicative; (b) per-domain rename without unification — rejected for the same reason. Cost of the chosen path: a **BREAKING** tool rename (mitigated — the agent runs from the regenerated plugin; no external callers).

### D2. Write is generic + domain-gated: `save_guidance(domain, slug, content, source?)` with a writable allowlist
A single write tool, but a **writable-domain allowlist** (initially `{ cooking_techniques }`) governs which domains it accepts. Writing to `ingredient_storage` returns `validation_failed` (not_found-style structured error), making storage read-only **by allowlist** rather than **by tool absence**.

- *Why:* keeps the surface symmetric and extensible while preserving storage's read-only invariant. The guarantee is functionally identical: the agent can never mutate ingredient-storage content.
- *Alternative:* a technique-specific `save_cooking_technique` tool, leaving storage read-only by absence — cleaner invariant, but breaks the generic-surface goal the member chose. Rejected.
- *Consequence:* amends the `storage-guidance` spec requirement "No write tool exists." The delta restates the guarantee in allowlist terms.

### D3. One memory per technique — refine, don't append
`save_guidance` on an existing slug **overwrites/refines** the single file (the agent merges the new advice into the existing prose); a new slug creates it. Unlike recipe notes (append-mostly), there is exactly one `browning-meat.md`.

- *Why:* a technique is a single evolving truth; five "browning" notes would muddy cook-time surfacing ("which one?"). Matches storage's one-file-per-class shape.
- *Trade-off:* loses capture history. Acceptable — git history in the data repo is the audit trail, and the distilled current state is what matters at the stove.

### D4. Capture register: distill, cite, don't dump
The capture skill compresses the source to **imperative, non-obvious, memorable** bullets (the member's browning example is the target register), and records provenance in a `source` frontmatter field.

- *Why:* the value is the distillation, not the article. `source` preserves the anti-folklore principle storage guidance enforces in-prose — a technique memory is traceable to a trusted source, citable at the stove.
- *Note:* fetching is best-effort. These sources are often bot-walled (the same `parse_recipe` paywall problem with Serious Eats/NYT), so the flow accepts pasted text or the member's own distillation; a URL fetch is opportunistic.

### D5. Surface at cook time via world-knowledge mapping
At `cook` start, the agent calls `list_guidance("cooking_techniques")` once (cheap: slugs + descriptions), maps the recipe's steps to techniques by its own knowledge (a step "brown the beef" → `browning-meat`), `read_guidance("cooking_techniques", [...])` the few that fit, and weaves the tip inline **at that step** — non-obvious only, capped like storage's 2–3, not a lecture.

- *Why:* identical posture to storage's class mapping; recipe instructions often name the technique, so mapping is robust without a manifest.
- *Scope:* primary surface is `cook`. Offering capture at the `cooked` feedback moment is a deliberate later add, not v1.

### D6. Relocate storage corpus under `guidance/`, no behavior change
`storage_guidance/` → `guidance/ingredient_storage/` via `git mv` in both data repos. The module's `DIR` generalizes to `guidance/<domain>`. Validation stays existence-only for prose markdown, now globbing `guidance/**/*.md`.

## Risks / Trade-offs

- **Tool rename breaks any cached references** → The agent consumes tools from the regenerated `plugin/` bundle; rebuild (`npm run build:plugin`) lands the new names atomically. No external API consumers. AGENT_INSTRUCTIONS put-away flow updated in the same pass.
- **Data move + code path must land together** → If the data repo moves files before the Worker knows the new path (or vice versa), reads 404. Mitigation: the read path treats an absent tree as empty (no hard error), and the deploy sequence is doc-checked in tasks; ideally the code change deploys and the data move merges close together. A stale `storage_guidance/` left behind is harmless (just unread).
- **save_guidance refine could clobber good prose** → The agent overwrites the file; a bad distillation loses the prior version from the live file. Mitigation: git history in the data repo retains every version; the skill instructs the agent to read the existing entry first and *merge*, not blindly replace.
- **Over-surfacing at the stove** → A multi-technique recipe (sear, deglaze, reduce, rest) could trigger a lecture. Mitigation: the spec caps surfacing to the most valuable couple and requires non-obvious-only, mirroring storage's restraint.
- **Read-only-by-allowlist is a weaker-looking guarantee than tool-absence** → A future allowlist edit could accidentally make storage writable. Mitigation: the allowlist is a single explicit constant with a spec requirement and a test asserting `ingredient_storage` is rejected.

## Migration Plan

1. Land the Worker change (generalized guidance module, unified read tools, `save_guidance` + allowlist, validation glob) on the branch; rebuild `plugin/`; update docs + AGENT_INSTRUCTIONS in the same pass.
2. In the data repos (`groceries-agent-data`, `groceries-agent-data-template`): `git mv storage_guidance/ guidance/ingredient_storage/`, create `guidance/cooking_techniques/` (seed `browning-meat.md` as the worked example), update READMEs.
3. Merge to `main`; CI auto-dispatches the data-repo deploy (Worker-relevant paths changed). No D1 migration runs (no schema change).
4. **Rollback:** revert the Worker commit (restores the old tool names + `storage_guidance` path) and revert the data-repo `git mv`. No data loss — `cooking_techniques/` content simply becomes unread; storage content is unchanged by the move.

## Open Questions

- Should `list_guidance()` with no `domain` enumerate domains, or return all slugs across domains grouped by domain? (Leaning: return all, grouped — one call primes both put-away and cook surfacing.) — resolve in the spec.
- Seed set for `cooking_techniques/` beyond `browning-meat`: worth shipping a small starter (searing, resting meat, salting pasta water) or leave the corpus empty for the member to grow? (Leaning: ship `browning-meat` only as the worked example; let the corpus grow from real use.)
