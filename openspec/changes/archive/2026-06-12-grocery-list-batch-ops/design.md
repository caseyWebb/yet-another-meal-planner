## Context

`commit_changes` ([src/write-tools.ts](../../../src/write-tools.ts)) is the established batch-write path: it folds repo updates across many file-domains (recipes/overlay, pantry, meal plan, cooking log, ready-to-eat, config) into **one atomic commit** via the Git Data API. Each domain has a `*_ops`/`*_updates` array field handled by a `build<Domain>Update(...)` helper returning `{ file, applied, conflicts }`; the handler collects the resulting `TreeFile`s and commits once.

The grocery list is the one writable domain with single-item tools (`add_to_grocery_list`, `update_grocery_list`, `remove_from_grocery_list`) but **no `commit_changes` field**. The pure list-transformers in [src/grocery.ts](../../../src/grocery.ts) (`addToGroceryList`, `updateGroceryItem`, `removeGroceryItem`) already take `items` → return `items`, so they chain trivially; only the tool wrappers are single-item (each does load → one mutation → commit).

The commit engine ([src/commit.ts](../../../src/commit.ts)) resolves a non-fast-forward ref (422) by **replaying the precomputed full-file content onto the new base** — safe only because the other writer (the index Action) touches disjoint paths. This is the crux of why parallelism cannot substitute for batching here.

## Goals / Non-Goals

**Goals:**
- Make a multi-item grocery write — a menu capture's to-buy set, a receive's batch removes — persist as one atomic commit alongside the other repo writes it co-occurs with.
- Fulfill the existing AGENT_INSTRUCTIONS.md:95 contract that already places grocery items inside the `commit_changes` call.
- Reuse the existing builder pattern; add no new batch mechanism.
- Steer the agent away from parallel same-file writes via a standing instruction rule.

**Non-Goals:**
- Removing or changing the three single-item grocery tools (kept for one-off live edits).
- Changing the grocery-list item schema, lifecycle, or order-time dedup.
- The broader skill/tool description dedup and library-skill hiding (separate change `tidy-skill-tool-surfaces`).

## Decisions

### D1: A `grocery_list_ops` field on `commit_changes` — not array params on the single-item tools

A menu capture is a single decision that mutates 4–5 **distinct files** (meal_plan, pantry, recipe content, overlay, grocery_list), and grocery rows carry `for_recipes` pointing at the recipes planned in the same act. The transaction boundary therefore *is* the session, not the file. Putting the batch on `commit_changes` lands the whole menu in one commit; array params on the single-item tools would commit the grocery items **separately** from the meal-plan/pantry writes — a torn write that can leave `for_recipes` referencing a recipe that never reached `meal_plan`.

Alternatives considered:
- **Array params on `add_to_grocery_list` / `remove_from_grocery_list`** — lighter, but a *separate* commit from the rest of the menu, does not satisfy the line-95 contract, and overloads two tools instead of adding one field. Rejected: solves the narrow same-file case while worsening the cross-file atomicity it co-occurs with.
- **A new standalone batch tool** — yet another tool, still a separate commit. Rejected as redundant with `commit_changes`.

This also makes grocery-list **conform** to the pattern every other domain already follows (granular tool for single live edits + `commit_changes` field for batches), rather than being the lone domain that batches differently.

### D2: Why parallel single-item calls are not a substitute

Every grocery-list write is a full-file read-modify-write of `grocery_list.toml`. Two concurrent calls both read the same base, each computes the whole file from that stale base, and the engine's 422-replay overlays the **second's stale full content** onto the first's committed tree — a lost update. Parallelism makes multi-item writes *less* safe, not faster. The only race-free shapes are serial single calls (N commits, N sequential round-trips) or one call folding N mutations over one loaded list. `grocery_list_ops` is the latter.

### D3: Builder shape mirrors `pantry_operations`

`grocery_list_ops: [{ op: "add"|"update"|"remove", item?, name? }]`, with `add` carrying `item`, `update` carrying `name` + a partial `item`, `remove` carrying `name`. A new `buildGroceryListUpdate(gh, path, ops)` folds the existing pure functions over one loaded list and returns `{ file, applied, conflicts }` — same as `buildMealPlanUpdate` / `buildPantryUpdate`. Same-name adds within one batch merge (the existing `addToGroceryList` merge semantics apply as the fold accumulates). A `remove`/`update` targeting a missing name is reported as a **conflict**, not a thrown-away commit — matching the partial-apply convention.

### D4: The standing batch rule lives in AGENT_INSTRUCTIONS.md

The agent under-reaches for `commit_changes` partly because it is framed as a git-log nicety and surfaced only inside individual flow steps. A top-level rule — *more than one repo write in a turn → one `commit_changes`; never parallel same-file writes* — generalizes across all single-file domains (pantry, meal_plan, overlay, grocery_list). The receive flows, which today instruct an explicit per-item remove loop, are rewritten to a single `commit_changes({ grocery_list_ops, pantry_operations })`.

## Risks / Trade-offs

- **God-tool growth** — `commit_changes` gains a 9th field. → Accepted: the field set is a 1:1 projection of the writable file-domains (a bounded, fixed set); grocery_list is the missing member, so the addition completes the projection rather than sprawling it.
- **Same-name op ordering within a batch** — an `add` then later `update` for the same name must apply in array order. → The fold applies ops sequentially over the accumulating list; covered by a test.
- **Agent still chooses single-item tools for true one-offs** — desired, not a risk: the standing rule scopes `commit_changes` to multi-write turns; a lone edit keeps using the granular tool.

## Migration Plan

1. Add the schema field + `buildGroceryListUpdate` + handler wiring; unit-test it.
2. Update `AGENT_INSTRUCTIONS.md` (standing rule + receive-flow rewrites) and `docs/TOOLS.md`; rebuild the plugin (`npm run build:plugin`).
3. `typecheck` + `npm test`; merge to `main`.
4. Trigger the operator data-repo `deploy.yml` to deploy the Worker.

Rollback: the field is additive and optional — reverting the Worker leaves existing `commit_changes` callers and the single-item tools unaffected.

## Open Questions

- None blocking. The discovery nudge in `add_to_grocery_list`'s description (pointing at `commit_changes` for multiples) overlaps with the `tidy-skill-tool-surfaces` change; either change may carry that one-line edit, sequenced so the batch rule is the canonical skill-side statement.
