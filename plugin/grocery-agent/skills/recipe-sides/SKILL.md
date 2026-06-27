---
name: recipe-sides
description: "Find sides that complete a plate, as corpus-building — independent of planning a week. Use for free-form side questions — \"what are some good sides for grilled swordfish?\", \"what should I serve with the short-rib ragu?\", \"I need a side for this\", or right after importing a main. NOT a menu request: it never writes the meal plan and never touches the cart. Resolves the subject (a corpus main or a bare dish concept), runs the shared side-resolution ladder, and may import sides and record pairings."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core`, `grocery-corpus` and `grocery-discovery` skills before continuing.

# Sides for a dish (recipe-sides)

Answering "what goes with X" is **corpus-building, decoupled from planning** — this flow finds (and may save) sides, but it never writes the meal plan and never touches the cart. Its only persistent effects are recipe imports (`create_recipe`) and plating-edge writes (`pairs_with` via `update_recipe`). If I then want to cook or shop those sides, that's the `meal-plan` flow's job — hand off, don't do it here.

**Resolve the subject X through one of two entry modes:**

- **X is a corpus main** — resolve it deterministically with a vibe-less `search_recipes({ specs: [{ label: "named", facets: { query: "<dish words>" } }] })`, then drive side resolution from that main's **`side_search_terms`** and existing **`pairs_with`**.
- **X is a bare dish concept** not in the corpus — reason the kind of complementary side from world knowledge (what completes *that* plate), and use that as the basis. No corpus main need exist; the flow never returns empty-handed because the open-world rung always yields something.
- **Just-imported main (the in-session seam):** when X is a main imported earlier this same session, it isn't semantically retrievable yet (its embedding reconciles a tick later on the background build), so use the `side_search_terms` you already hold **from that import's parse** rather than re-searching for the main.

Then **run the shared "Resolving sides for a main" ladder** (corpus tier): curated `pairs_with` → corpus retrieval via a `side_search_terms`-vibe `search_recipes` spec with `facets: { course: "side" }` → propose→confirm→import → open-world trivial side. Stop at the first rung that satisfies the request; don't go to the web when curated or corpus sides already answer it.

**The propose→confirm gate** is the deliberate exception to import-on-sight: whenever the corpus is thin and you'd source new sides from outside it, propose a short list of candidates (a few, never a bulk pull) and wait for me to pick **which** to pursue before any `parse_recipe` / `create_recipe`. The "yes" is at the which-sides granularity; once I pick, each chosen side imports on sight via the shared import mechanics, with no per-recipe re-confirmation.

**This flow is the primary author of `pairs_with`.** When I accept a **corpus** side for a corpus main, record the plating edge by adding the side's slug to the main's `pairs_with` via `update_recipe` — the `meal-plan` flow only backfills the edge opportunistically. Open-world sides have no slug and are never recorded. A side imported here is classified `course: [side]` and carries no `side_search_terms`, so it can't trigger another round of side-resolution — one level deep.
