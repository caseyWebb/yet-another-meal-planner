---
update-when: the determinism boundary decision is revisited or superseded
---

# ADR 0001 — Determinism boundary: capture → retrieve → narrow (thin tools, recipe-side retrieval)

**Status:** Accepted — decisions locked in design conversation 2026-06-12. Phase 0 drafted as the `thin-pantry-and-substitution-path` OpenSpec change.

## Context

The project's determinism boundary was originally drawn to optimize tokens and preserve a provably-correct deterministic core. Real use exposed two problems:

- **Curated tables go uncurated.** `substitutions.toml` (and, more mildly, `aliases.toml`) assume spotless, enumerable data that members never maintain. They sit empty or sparse, so the features they back are effectively dead. Onboarding deliberately doesn't prompt for them.
- **The determinism they bought was mostly illusory.** Substitution *decisions* always routed through the LLM plus a human confirmation anyway; the tables only enumerated candidates — exactly the work LLM world knowledge does well, and does *better* on messy real input.

Two facts shape the response:

- **The corpus is 68 recipes and about to diversify across cooking domains** (incoming friends are largely bakers — flours, leaveners, sugars, fats: a separate ontology). Vocabulary will grow, so *retrieval* has to stay tractable at scale.
- **Capture-and-amortize is already the house style.** A recipe's `protein` / `cuisine` / `perishable_ingredients` are LLM-classified once at import and stored in frontmatter, then read deterministically forever. The system already captures LLM-derived knowledge where it's a stable, context-free property of a durable entity.

## Decision

**Restate the determinism boundary as a `capture → retrieve → narrow` loop**, and lean into LLM world knowledge + reasoning for the *narrow* end while keeping determinism for *retrieve* and the *gates*:

- **Capture** (LLM, cold path) — classify a novel thing once; write it to persistent data. (Recipe metadata at import.)
- **Retrieve** (deterministic, hot path) — indexed lookup / filter over the captured store, plus identity and validation gates.
- **Narrow** (LLM, hot path) — decide *with full context* over the retrieved set.

```
   CAPTURE (LLM, cold)          RETRIEVE (deterministic, hot)      NARROW (LLM, hot)
   ─────────────────────       ──────────────────────────────     ───────────────────────
   classify recipe         →   list_recipes(faceted, active)   →   pick menu (taste/expiry/
   metadata at import          + read_pantry / read_recipe          variety); match pantry;
                               (loadable sets, not the corpus)      sides; subs; to-buy
```

The decisive realization: **the system's scaling pressure is on the recipe side, and it's already solved there.** Recipes are first-class entities with captured metadata and an index. You never reason over the whole corpus at once — `list_recipes` filtering + each member's **active overlay** narrow it to a small candidate set, which loads into context for read-time reasoning. So the path is: **thin tools + rich captured *recipe* metadata + faceted retrieval + LLM reasoning over the loaded active set and pantry.** Ingredients stay strings; the LLM resolves identity, substitution, and freshness at read time over loaded context. Tools shrink (substitutions, `verify_pantry`, and the recipe-ingredient parser all fall out); the center of gravity moves from `src/` to `AGENT_INSTRUCTIONS.md`.

## Locked decisions

1. **Open-world everywhere.** Any captured prior (a `pairs_with` edge, a cached resolution, a future graph) is an *accelerant, never a ceiling*. The LLM can always exceed it from world knowledge and backfill — so an on-sale item from `kroger_flyer`, or a sub nobody recorded, still flows through. Closed-world rebuilds the rule-file brittleness.
2. **Load-and-reason over small per-tenant / per-session state** (pantry, active recipe candidates, brands, the proposed menu); keep deterministic *retrieval* only over what's genuinely unloadable (the Kroger catalog) or large (the corpus index, via `list_recipes`). Most "keys" dissolve where the data is loadable.
3. **Recipe faceting is the tractability lever.** Add a `course` facet (controlled-vocab frontmatter field — `main` / `side` / `dessert` / `baking` / … — classified at import like `protein`/`cuisine`, filterable in `list_recipes`). `meal-plan` fetches mains+sides (excluding dessert/baking), active-filtered, with metadata, in one call. Recipe-centric, lightweight, the proven capture pattern — *not* ingredient infrastructure.
4. **`pairs_with` as an open-world prior.** Surface remembered pairings, let the LLM propose new sides from the loaded side set, and backfill confirmed pairings. Resolves the "new sides never get linked" failure of a pure memoized-edge approach.
5. **`verify_pantry` retired.** Pantry matching, freshness, inventory substitution, and the to-buy list are LLM reasoning over the loaded pantry + the chosen recipes' content (`read_recipe`). The one trade — `verify`'s exhaustive bucketing — is low-stakes (caught by iterate-before-commit) and gains semantic matching (`scallion` ≈ `green onion`). The orphaned recipe-ingredient parser goes too. (Phase 0.)
6. **Vetoes and user-specific preferences stay per-tenant** (`taste.md`, per-recipe notes), never in shared world-knowledge data.
7. **`aliases.toml` stays as-is.** Small, working, the matcher's normalization key. Don't delete a working thing to prove a purity point — that's its own over-engineering. Revisit only if it causes friction.

## Considered and deferred — the ingredient knowledge graph

An earlier draft of this ADR proposed making *ingredients* first-class: a self-growing, LLM-populated graph (`ingredients/<slug>.toml` + index + a `resolve_ingredient` tool + a registration mini-skill) holding identity, aliases, and substitution edges, replacing both `substitutions.toml` and `aliases.toml`.

**Demoted, not adopted.** The feature that most justified it — expiry-driven cooking ("use what's about to go bad") — turns out to be **read-time-solvable**: load the pantry (with `added_at`/`category`/`prepared_from`) and a candidate set carrying ingredient metadata (`perishable_ingredients` is already indexed), and let the LLM match the expiring item to a recipe. And tractability at scale is solved **recipe-side** (faceting + active-filtering), not by an ingredient index. So the graph would be building ingredient infrastructure to solve problems the recipe side already handles — over-engineering against the stated "resist over-engineering" goal.

**Revive only on a concrete trigger**, not speculatively:
- **Ingredient-first-class product features that read-time reasoning genuinely can't serve** (e.g. attaching durable per-ingredient data — nutrition, seasonality windows — that wants a referential anchor), **or**
- **Demonstrated fragmentation pain** — the agent says "buy scallions" while green onions sit in the pantry; duplicate grocery rows; missed perishable overlaps — that read-time reasoning over loaded sets fails to prevent.

**If revived, the design decisions are already settled** (recorded here so they aren't relitigated): open-world (decision #1); **granular nodes joined by edges, not collapsed** (alias / strong-sub / weak-sub as an edge-strength spectrum, which makes identity-granularity low-stakes); **edges carry qualifiers** (a sub ratio like `1:2`, a cook-time or leavening caveat, "not interchangeable for X" — essential for baking, where `baking-soda ≠ baking-powder` and flour protein matters); **stub-on-cascade, enrich-on-encounter** (pools are clusters, not trees, so fanout is shallow); per-file source + generated index. Caching world knowledge also has a standing cost to weigh: it **freezes the answer at the capturing model's competence**, while read-time reasoning rides model improvements for free.

## Roadmap

### Phase 0 — `thin-pantry-and-substitution-path` *(drafted)*
Remove the dead substitution mechanism (`substitutions.toml`, `propose_substitutions`, the engine, the `against_substitutions` flag). **Retire `verify_pantry`** (and its orphaned recipe-ingredient parser): pantry enters via `read_pantry` loaded up front as a *selection* input; inventory subs and the to-buy list become LLM reasoning over the loaded pantry + `read_recipe`. Vetoes/preferences rehome to `taste.md`. This is the beachhead and a strict simplification.

### Phase 1 — recipe faceting *(the real next step)*
Add the `course` controlled field (classified at import, indexed, filterable) and rework `meal-plan` to fetch active mains+sides with metadata in one faceted call, reason holistically (menu + open-world sides + expiry-matching + subs over the loaded pantry), then cost/confirm. Lightweight, recipe-centric. *This replaces the old "ingredient identity registry" as Phase 1.*

### Deferred / conditional — ingredient knowledge graph
Only on a trigger above. Design pre-decided (see "Considered and deferred").

## Risks / trade-offs

- **Loaded-context size at large active sets.** Bounded by the per-member active overlay (a curated fraction of the shared corpus) and further narrowable by faceted pre-filtering (course, season, perishable). Escalate to ingredient-aware retrieval *only* if a power user's active set blows past what loads comfortably — an evidence-gated, not speculative, move.
- **`verify` exhaustiveness loss.** A missed ingredient is recoverable and caught by conversational confirmation before commit.
- **Testability shift.** Deleted deterministic logic was cheaply unit-tested; capture/narrow confidence moves toward evals. Acknowledged; weigh the eval surface before leaning harder on read-time reasoning.
- **Latency is dominated by model tier, not architecture.** Thin tools + tooled retrieval keep the hot path light; the open question is whether `meal-plan` runs acceptably on Haiku (the real token + speed lever). Untested — the first thing to A/B once Phase 0/1 land.

## Consequences

- Supersedes this ADR's own earlier "ingredient knowledge graph" North Star and the `aliases → pure reasoning / matcher refactor` follow-up. Ingredients stay strings; `aliases.toml` stays.
- `verify_pantry` and the recipe-ingredient parser are retired in Phase 0.
- `docs/ARCHITECTURE.md`'s determinism-boundary section reflects the `capture → retrieve → narrow` framing and the recipe-side-retrieval direction.
