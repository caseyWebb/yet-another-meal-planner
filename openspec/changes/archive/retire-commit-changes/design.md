## Context

`commit_changes` batches GitHub-backed writes into one commit and also routes several KV-backed writes that were never transactional. Across slices 0–2 its surface shrank: `cooking_log_entries` left for `log_cooked` (slice 2), and its GitHub-backed data is now just shared recipe content + aliases (curatorial, low-frequency, usually one item per turn). Meanwhile `update_recipe` already splits objective vs. subjective via `splitRecipeUpdate` (objective → GitHub recipe; `rating`/`status` → KV overlay). So the only real question for retirement is where the subjective write lands once `update_recipe` is made single-purpose.

## Goals / Non-Goals

**Goals:**
- A dedicated `rate_recipe` for the subjective overlay write; `update_recipe` purely objective.
- Delete `commit_changes`; every former field served by a standalone tool.
- Rewrite the agent flows off `commit_changes`, fixing the pre-existing `grocery_list_ops`/`pantry_operations` drift.

**Non-Goals:**
- Moving the overlay to D1 (slice 4) — `rate_recipe` writes the KV overlay bundle for now.
- Re-introducing cross-write atomicity. The lost property (N recipe edits = N commits) is accepted; it returns naturally for *KV/D1* writes once the overlay/session data are in D1 (a D1 `batch` transaction), but cross-store atomicity (GitHub + D1) is out of scope and not a goal.

## Decisions

### Decision: `rate_recipe` owns subjective; `update_recipe` becomes objective-only

```
  rate_recipe(slug, { rating?, status? })
    1. SLUG_RE + SELECT 1 FROM recipes WHERE slug = ?   → not_found if absent
    2. applyOverlayEdit(currentOverlay, slug, { rating?, status? })
    3. persist the overlay (KV profile bundle this slice; D1 in slice 4)
    4. return { slug, overlay: { rating?, status? } }   // no commit_sha

  update_recipe(slug, updates)   // objective only
    - if updates contains `rating`/`status` → validation_failed:
        "rating/status are personal — use rate_recipe"
    - if updates contains `last_cooked` → validation_failed (use log_cooked)   // unchanged
    - else commit objective frontmatter/body to the shared GitHub recipe
```

**Rationale (clean separation, the chosen option B):** the determinism boundary already says objective recipe content is shared (GitHub) and rating/status is per-tenant (overlay). Two tools that each map to exactly one side make that boundary legible at the tool surface — no single tool silently writing two stores. `splitRecipeUpdate` (which existed only to fork one call into both) is removed; `update_recipe` rejects subjective keys rather than silently routing them, so a mis-aimed write is a clear error, not a surprise overlay edit.

**Alternative (rejected, option A):** keep rating/status in `update_recipe` and just delete `commit_changes`. Fewer tools, but preserves the dual-store split inside one tool and the "edit a recipe" call that quietly touches the caller's overlay — the opposite of the separation this reframe is after.

### Decision: delete `commit_changes`; accept loss of commit batching

Every former field has a standalone home (table in the proposal). The only lost property is one-commit atomicity for multiple GitHub writes in a turn. Recipe/aliases edits are curatorial and typically singular; the high-frequency batch cases the persona describes (grocery + pantry on a receive) are already KV-granular and were mis-documented as `commit_changes` fields that no longer exist. So nothing real is lost at runtime.

### Decision: AGENT_INSTRUCTIONS rework is part of this change (and overdue)

The persona has 9 `commit_changes` references; several instruct `grocery_list_ops`/`pantry_operations` — removed in `unified-user-profile-kv`, so the guidance is already wrong. This change rewrites:
- The "**Persist multi-write turns in one commit**" principle → call the granular KV/D1 tools; drop the "never fire parallel writes at the same file (full-file overwrite)" caution where it no longer applies (D1 row writes don't whole-file-overwrite; the KV session blobs still do, so retain the caution narrowly for those until slice 5).
- Cooked flow ("Log it, in one `commit_changes`") → `log_cooked`.
- Recipe activation / rating ("`commit_changes({ recipe_updates: [{ status }] })`") → one `rate_recipe` per slug.
- Draft imports / `pairs_with` → `create_recipe` / `update_recipe`.
- Received flows (`grocery_list_ops` + `pantry_operations`) → `update_grocery_list` + `update_pantry`.

Then `npm run build:plugin`.

## Risks / Open Questions

- **Multi-write turns get chattier** — several granular calls where one `commit_changes` stood. At conversational scale this is fine; flagged so the persona rewrite is explicit about the new shape rather than leaving the agent to infer it.
- **`rate_recipe` storage churn** — it writes the KV overlay this slice and D1 in slice 4. The tool *contract* is stable across that; only the persistence swaps. Keeping `rate_recipe`'s body behind the overlay helper (`applyOverlayEdit`) localizes the slice-4 change.
