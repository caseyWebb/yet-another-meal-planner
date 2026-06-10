## Context

`menu-generation-flow` added a `query` filter to `list_recipes` (token-AND case-insensitive substring over title + tags) to stop named dishes being silently missed. It works — but the `tags` array filter (tag-AND) still sits beside it, and in production the agent reached for `tags: ["chicken", "rice"]`. The recipe `recipes/chicken-and-rice.md` is titled "Chicken and Rice" but tagged `[easy-dinners, one-pot, american, chicken]`; "rice" exists only in the title, so tag-AND is structurally incapable of finding it. Two distinct search affordances, one of which can't do the job the user expects, and the agent chose it.

The user's directive: remove tag-based searching as a filter, make name lookup always a text search over title + tags, with stricter (deterministic, not semantic) semantics. No embeddings.

## Goals / Non-Goals

**Goals:**
- One deterministic name/keyword path (`query`) that searches title + tags and cannot be bypassed by a worse filter.
- Phrasing-robust: the natural "chicken and rice" returns the same set as "chicken rice".
- Keep orthogonal structured filters intact.

**Non-Goals:**
- Embeddings / vector / fuzzy / ranked search — `query` stays a deterministic membership test.
- Removing `season`/`dietary` — those are orthogonal facets, not name search.
- Re-tagging the corpus to add "rice" to Chicken and Rice — the point is that title-only keywords must be findable without depending on tag hygiene.

## Decisions

### D1: Remove `tags`, keep the other filters

`tags` is the only array filter that is *name-ish* — it overlaps with what a title+tags text search already covers, and tag-AND's inability to see the title is exactly the failure. `season` and `dietary` are orthogonal structured facets (a "gluten-free summer" filter is not a name search), so they stay. `protein`/`cuisine`/`status`/time filters stay.

**Alternative considered — keep `tags` as an alias into `query`:** rejected; tag-AND and title+tags-substring are different operations, and leaving `tags` on the surface re-invites the same wrong choice. Make the right thing the only thing.

### D2: Stopword stripping in query tokenization

Before token-AND matching, drop a small fixed connective set: `and, or, with, the, a, an, of, in, on, for, &`. Rationale: with token-AND, a connective like "and" becomes a *required* token, so "chicken and rice" demands the literal "and" appear in title/tags — which narrows to the one title that happens to contain it and drops Arroz Caldo / Galinhada (whose tags have chicken+rice but no "and"). Dropping connectives makes "chicken and rice" ≡ "chicken rice" → all three. This stays fully deterministic; it is *stricter* than fuzzy matching, just not literal-on-connectives. The list is intentionally tiny (English connectives/articles + ampersand) to avoid dropping a meaningful content word.

**If a query is *only* stopwords** (e.g. `query: "the"`), it strips to zero tokens → treated as an absent query (no text narrowing), same as empty.

### D3: `query` core unchanged otherwise

Still token-AND, case-insensitive substring, over `title` + `tags`, ANDed with the remaining structured filters, pure function of the index entry, no ranking. Only two deltas: stopword pre-filter, and `tags` no longer exists as a separate filter.

### D4: Removal is BREAKING but low-risk

Removing `tags` from the Zod input schema means a caller passing `tags` has it **stripped** (Zod objects drop unknown keys by default) — no error, but no narrowing either. For a single-user agent this is acceptable; the tool description and `AGENT_INSTRUCTIONS.md` are updated so name searches go to `query`. Worst case during the transition: the agent passes `tags`, it's ignored, the unfiltered active set comes back, and the agent must use `query` — strictly better than today's silent wrong-narrowing.

## Risks / Trade-offs

- **Agent keeps sending `tags`** → ignored (stripped), returns the broader set; mitigated by the description + instructions pointing name search at `query`. No error, no silent wrong answer.
- **Stopword list drops a meaningful token** → mitigated by keeping the list to connectives/articles + `&`; none is a plausible recipe content word. Revisit only if a real collision appears.
- **Spec lineage** → this modifies the `query` requirement that `menu-generation-flow` introduced; it must be archived after that change. Called out in tasks.

## Migration Plan

1. (Prereq) Archive `menu-generation-flow` so `query` is in the live `data-read-tools` spec.
2. `recipes.ts`: drop `tags` from `RecipeFilters` + the tags block in `filterRecipes`; add the stopword set and strip it in query tokenization.
3. `tools.ts`: drop `tags` from `recipeFiltersShape`; update the tool description (name search via `query`; no tag filter).
4. Tests: "chicken and rice" → all three (incl. the title-only match); stopword stripping; `tags` no longer narrows; query still token-AND over title+tags.
5. `docs/TOOLS.md` + `AGENT_INSTRUCTIONS.md` updates.
6. CD deploys on push to `worker/**`. Rollback = revert; `query` keeps working, `tags` returns.

## Open Questions

- Should `season`/`dietary` eventually also become text-search-able (e.g. `query: "gluten-free"`)? Out of scope; they remain structured filters. Revisit only if the agent starts mis-reaching for them the way it did for `tags`.
