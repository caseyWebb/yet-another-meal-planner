---
name: grocery-corpus
description: "Internal shared rules for the grocery agent, loaded by reference from the workflow skills (via their prerequisite line). Not invoked on its own."
user-invocable: false
---

## Shared recipes, my own kitchen

Recipes are shared across the group, but my favorites, notes, and rejections are mine — the tools route that for you, so just call them normally. **Never edit a shared recipe to capture something I'd do differently** — that changes it for everyone. A tweak is a note (`add_recipe_note`); a genuinely different dish is a new personal recipe. The shared recipe body changes only for an objective correction.

When you recommend something I haven't tried, surface **group signal** — what others favorited or noted ("two others favorited it", "Alice cuts the sugar"). A light side channel, not a wall of quotes.

My config is mine — taste, diet principles, cooking preferences, aliases. Don't edit any of it unless I tell you to; if you notice a pattern worth saving, suggest it, don't write it. (One exception: a standing "don't care" — "just get the cheapest onion from now on" — is a direction, so record it: `update_preferences({ patch: { brands: { yellow_onion: [] } } })` — an empty list means "cheapest, don't ask". A standing brand *preference* ("always the Cobram olive oil") is the same path with a ranked list: `{ brands: { olive_oil: ["Cobram"] } }`; to clear one back to "ask me", patch it to `null`.) A standing substitution stance — a veto ("never tilapia for salmon") or a go-to ("reach for arctic char first") — lives in my taste profile, not a rule file: when I voice one, offer to capture it as a line in `taste.md` so you honor it at proposal time.

## Resolving sides for a main — the cheapest-first ladder

These are the shared mechanics for finding a side that completes a main's plate — used by the `recipe-sides` flow (the standalone "sides for X" question) and the `meal-plan` flow (rounding out a main mid-plan). The *mechanics* live here; *when* to run them, and whether a chosen side lands on a plan, are the calling flow's call. Sides here are savory plate-completers — starch, vegetable, salad, or bread — never drinks, wine, or dessert.

Walk the rungs **cheapest- and highest-confidence-first, stopping at the first rung that satisfies the request** — don't go to the web when curated or corpus sides already answer it:

1. **Curated `pairs_with` first.** Surface the main's `pairs_with` corpus sides — deterministic, already-vetted pairings, the highest confidence. If they round out the plate, you're done.
2. **Else corpus retrieval.** Issue a `search_recipes` spec whose **vibe is the main's `side_search_terms`** (the AI-memoized phrases describing the kind of side that completes the plate — they *are* the side-retrieval query, so retrieval returns sides, not more mains) with `facets: { course: "side" }`. Surface the corpus sides it returns.
3. **Else propose → confirm → import.** When the corpus has no or only a few matching sides, *propose* a short list of candidate sides to source and ask before going to the web — the confirmation is at the granularity of *which sides*, not a per-recipe re-prompt. Once I pick, import each chosen side **on sight** via the import mechanics below. This propose-then-confirm gate is the deliberate exception to importing on sight, because these are agent-proposed speculative additions to the shared corpus, not a recipe I handed you; propose only a few, never a bulk pull.
4. **Else open-world.** A trivial preparation named from world knowledge — steamed rice, a dressed-greens salad — is no recipe at all: enumerate its ingredients from world knowledge.

**Recording the pairing.** When I confirm a **corpus** side for a corpus main, record the plating edge by adding the side's slug to the main's `pairs_with` via `update_recipe` — next time it's already there at rung 1. An **open-world** side has no slug, so it is **never** written to `pairs_with` (re-derive it by reasoning each time). A side imported at rung 3 is classified `course: [side]` and, having **no `side_search_terms`** (that field is mains-only), can't itself trigger another round of side-resolution — the recursion is one level deep by construction.
