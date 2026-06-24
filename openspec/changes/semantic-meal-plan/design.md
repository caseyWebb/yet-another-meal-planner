## Context

Recipe selection today is **dump-and-reason**: the menu pre-pass loads all choice-independent context *plus* the entire active corpus (`list_recipes({status:"active"})`), and the LLM reasons holistically over everything. This is recall-perfect and works because the corpus currently fits in context. Two pressures break that premise:

1. **The corpus is meant to grow autonomously** — week over week, seeded by what each member actually likes, shared across the friend group. An unbounded corpus cannot be dumped.
2. **Free-tier Claude users** matter. Token budgets are tighter, rate limits lower, and the work often runs on a smaller/faster model that reasons *worse* over a large undifferentiated dump (lost-in-the-middle). Dump cost is `O(corpus)` per menu turn, paid by every member every time.

This change is the recipe-selection analog of the storage maturation just delivered by the D1 migration (#69–#72): the system has stopped being a viability experiment and is a daily tool, so retrieval-over-dump becomes worth its complexity. It builds directly on the **now-merged D1 platform**: the recipe index is a queryable D1 table (`recipes`, `migrations/d1/0002`), the per-tenant overlay is a D1 table (`overlay`, `0004`), and `DATA_KV`/`smol-toml` are gone — so the embedding store, the SQL facet-prefilter, and the favorite overlay all have a concrete home. It is delivered as an **experimental, invoke-by-name skill alongside the production flow**, so the retrieval quality can be proven on a real corpus before any core behavior is replaced.

The relevant prior art and constraints: the determinism boundary (`docs/ARCHITECTURE.md`, ADR 0001) — capture LLM judgment once, retrieve deterministically, narrow with live context; recipes stay authored markdown in GitHub (the Obsidian premise) while indexes are derived projections rebuilt by `projectToD1`; the existing token-AND substring search now reading the D1 index (`src/recipe-index.ts`); the per-tenant overlay shipped as `overlay(tenant, recipe, rating, status)` with the `rate_recipe` write tool.

## Goals / Non-Goals

**Goals:**
- Recipe selection scales as `O(K candidates)`, independent of corpus size, with the expensive matching in the Worker (off Claude's token budget).
- Semantic ("vibe") matching of menu requests, with hard constraints (diet, makeability, variety/contrast) still enforced deterministically.
- A corpus that grows through use: preference-matched discoveries are imported in-session, on the subscription, with no API spend and no headless infrastructure.
- A backend-agnostic search contract so the eventual brute-force → Vectorize swap touches no skill.
- Prove it experimentally, beside the real flow, before replacing anything core.

**Non-Goals:**
- Replacing the production `menu-generation` flow now. The new skill is invoke-by-name; dump-and-reason stays the default until the experiment proves out.
- Fully-autonomous cron import. In-session aggressive import covers growth; a headless cron (and its headless LLM for the capture step) is deferred.
- Standing up Cloudflare Vectorize. Brute-force cosine over a D1 column is exact and sufficient at current scale; Vectorize is a deferred, *measured* promotion (see Decisions).
- A negative/dislike anchor for k-NN. Favorite-only; revealed non-repeat in the cooking log is the implicit negative.
- Pushing all of `filterRecipes` into SQL beyond what `d1-recipe-index`/`d1-profile` already do.

## Decisions

### Decision: Embeddings live in a D1 column with brute-force cosine (option B), not Vectorize

Store the 768-dim vector in D1 — in a sibling `recipe_embeddings` table keyed by recipe `slug` (not a column on `recipes`; see the generation-placement decision below). Retrieval is **facet-prefilter on `recipes` in SQL, JOIN the surviving slugs to their vectors, then cosine over those** in the Worker.

- **Why over Vectorize:** at friend-group scale (hundreds, low-thousands of recipes) the three things Vectorize buys — sub-linear ANN, server-side metadata filter, managed scale — are things we don't need, while its costs are real: a second store, an async/eventually-consistent upsert window, dimensions welded to the model, and keeping two copies in sync on every rebuild. Brute-force is **exact** (not approximate) and composes with the SQL filter in one store (no second service, no dimensions welded into a separate store's config). It is not perfectly synchronous — the vector is reconciled by the cron (below), so a just-imported recipe is unembedded for a tick — but that window lives inside the one store and self-heals, rather than being Vectorize's *additional* eventually-consistent upsert on top of a second copy. This mirrors the codebase's standing YAGNI posture ("no premature KV read-cache… add only when measured").
- **Facet-prefilter first** keeps cosine off the whole corpus: `WHERE course=… AND protein NOT IN (recent) AND makeable…` may cut thousands → low-hundreds before any dot products. This is what extends B's runway and is the same shape Vectorize's metadata pre-filter would take.
- **Backend-agnostic contract:** the tool is `recipe_semantic_search(specs[]) → ranked slugs (+score)`. Whether the middle leg is a D1 column scan or a Vectorize query is an implementation detail behind that contract. Skills never know.
- **Deferred Vectorize trigger (write it down now):** promote when a search is *measured* slow, OR loading embeddings through the Worker gets heavy (≈ low-thousands of recipes × 768 × 4B). Mitigations that buy runway before promotion: int8-quantize the column, or only ever cosine the facet-prefiltered subset (already the design).
- **Embeddings via Workers AI** (`@cf/baai/bge-base-en-v1.5`): in-Cloudflare, no external key, query embedding computed in the Worker so Claude only ships a query string.

### Decision: Recipe embeddings are reconciled by the Worker cron, not projected by the build

The recipe vector is derived from the description, so the open question is *where it gets generated*. Two placements were considered:

- **(A) At build time, in `projectToD1`.** The Node build that already replaces the `recipes` table would also embed each description and write the vector into the row — clean atomicity (row + vector rebuilt together). But the build is a Node process with **no `env.AI` binding**; it would have to call Workers AI over the **REST API** with the operator's `CLOUDFLARE_API_TOKEN`, adding a second AI code path, a token scope, and build-time latency/failure surface to a step that today only shuffles rows.
- **(B, chosen) In the Worker, on the existing cron.** The sibling `recipe_embeddings(slug, embedding, description_hash)` table is reconciled by the scheduled handler: each tick embeds — via the **`env.AI` binding**, the *same* path `embedText` already uses for queries — any recipe whose description hash is new or changed, and prunes vectors whose slug is gone. The build stays a pure row projector; there is exactly one embedding code path and no new credential.

**Why B:**
- **One embedding path, one credential.** Reuses `embedText`/`env.AI`; no build-time REST client, no AI scope on `CLOUDFLARE_API_TOKEN`. The public repo's build never touches AI.
- **A different subrequest budget than the flyer's.** The flyer warm became a cron because Kroger calls exhaust the **50 external-subrequest** free-tier cap. `env.AI` is an **internal Cloudflare-services** call (the **1,000**/invocation bucket, shared with D1) — a different budget. And embedding **batches** (`env.AI.run({ text: [...] })` = one subrequest for many rows) and is **change-driven** (the hash gate ⇒ steady-state ≈ 0), so it rides far lighter than the flyer beside it. It keeps the bounded-batch-per-tick discipline anyway — for the 1,000 cap, Workers AI's own rate limit, and tidy wall-clock — under the **one** cron trigger the platform already has.
- **Separate table, not a `recipes` column.** The vector has a different producer and cadence than the rest of the row (cron-reconciled vs build-projected). A sibling table keyed by `slug` lets each rebuild independently: the build's full `DELETE FROM recipes` + re-INSERT can't clobber a vector it doesn't own, and the cron never races the projector. Search JOINs the two — prefilter on `recipes`, cosine over the joined vectors.

**Cost:** a bounded reconcile lag — a recipe imported between ticks is unembedded (so invisible to semantic search) until the next tick. Acceptable for a derived index; the search path treats a missing vector as "not yet indexed," not an error.

### Decision: The AI-written brief description is the single semantic-identity field

One frontmatter field, AI-generated **in the agent's session at import** (not scraped marketing copy), human-editable in Obsidian. It is simultaneously the embed source, the compact per-candidate context rep (~60 tokens vs ~150+ of full metadata), the user-facing "why this dish," and the dedup signal.

- **Why not scraped copy:** marketing register ("BEST EVER!!!") misaligns with how members phrase cravings, and inconsistent length/style degrades the embedding distance metric. An AI description in a consistent, craving-aligned register makes cosine work and lets us *inject the latent axes the embedding model can't extract itself* (e.g. spell out "rich, slow-braised, cold-weather comfort" so the vector captures it).
- **Authored-but-AI-seeded split:** the description is authored content (GitHub frontmatter, editable); the embedding is the *derived* projection (D1, reconciled by the Worker cron from whatever the description currently says). Consistent with "recipes authored, indexes derived."

### Decision: Distill → retrieve → compose, with vibe and constraints split per search

The skill keeps the existing bounded context pre-pass, then: the LLM **distills** context + the user message into K search specs; code **retrieves** a compact ranked candidate set per spec; the LLM **composes** the plate over the union. Each spec is `{ vibe: <semantic query>, facets: <SQL constraints>, label }`.

- **Why the split:** semantic search returns things *close* to the query, but much of the selection signal is *contrast* — "not the chicken I had three times," "different each night." You cannot phrase anti-similarity as a cosine query. So vibe is the lens (embeddings) and constraints — especially the retrospective-driven anti-similarity ones — are the gate (SQL facets). Cross-week variety composition stays LLM-side over the union.
- **Recall is engineered, not free.** Dump-and-reason had perfect recall for free; retrieval trades it for focus + scale-headroom. Bound the loss with generous K (cheap because descriptions are compact), multiple diverse specs (vibe searches + a variety/wildcard spec + a never-cooked×taste novelty spec + pantry-overlap specs), and hard facet gates so diet/makeability are never violated by ranking.
- **Batched tool call:** the K specs go to the search tool in one round-trip (`recipe_semantic_search(specs[])` returns grouped results), so the flow is context → one search call → compose, not K separate calls.
- **Don't regress the holistic plate.** The `course`-facet work made one load reason over mains+sides together. Side specs (`course:side`, driven by the chosen mains' `side_search_terms`) run in the *same* compose pass, not a separate post-hoc round.

### Decision: Sides are three-tier; complementarity is captured in memoized terms

`pairs_with` (curated, deterministic, highest confidence) → `side_search_terms` (AI-memoized at import, semantic) → open-world trivial sides (world knowledge, no recipe). The memoized terms describe *the side you want* ("bright acidic salad, crusty bread"), so the LLM does the complementarity reasoning once and the retrieval is plain similarity (terms → side recipes). This resolves "similarity ≠ complementarity": searching with the *main's* embedding returns more mains; searching with side-terms returns sides. Tier 2 improves as the corpus grows — exactly the target regime.

### Decision: Aggressive in-session import collapses disposition

During planning, when the agent judges a discovery matches the member's preferences, it imports it on the spot: `parse_recipe` (Worker, off-budget) → the agent writes description + `side_search_terms` + facets (subscription, full Claude quality) → `create_recipe`. Consequences:

- **Disposition collapses:** `draft` limbo disappears. Import is the "yes" (→ first-class corpus recipe); no-import leaves it a discovery (re-judged next time or ages out); explicit "no" suppresses that URL (per-tenant). This removes the 4-state lifecycle the proposal was going to drop anyway.
- **Free-tier discipline:** triage on the cheap discovery blurb; only `parse_recipe` + describe the *matches*, so per-session cost is proportional to matches, not discovery volume.
- **Dedup graduates onto this path.** Aggressive import × multiple members raises duplicate pressure. Exact-URL dedup already exists (`idx_recipes_source_url` from `d1-recipe-index`); semantic dedup (same dish, different URL) is the polish, reusing this change's embedding infra.
- **Quality gate without explicit disposition:** the agent judged a match *and* the user sees it in a proposal they accept/reject — adequate vetting for a personal tool. No headless judge needed.
- **No API, no cron:** the capture rides the session already running. Growth couples to actual use; a member who stops planning simply imports nothing, which is correct.

### Decision: `favorite` boolean replaces the 1–5 star `rating` (BREAKING)

- **Why:** a boolean is exactly the crisp anchor set k-NN wants; stars are poorly calibrated and add disposition friction we're shedding. The lost granularity is recovered, more honestly, from revealed preference (cook frequency in the cooking log).
- **Cascade:** the per-tenant `overlay` table's `rating` column becomes `favorite` (the table shrinks toward a single boolean, maybe `+ hidden`); the group signal (`idx_overlay_recipe` aggregate in `read_recipe_notes`) becomes `COUNT(favorite)` not `AVG(rating)` — a simpler SQL aggregate; and the just-shipped `rate_recipe` tool (which resolved the old `update_recipe`-vs-`rate_recipe` question toward a rating tool) is **replaced** by a trivial `toggle_favorite`.
- **Favorites are the one positive signal everywhere:** retrieval re-rank (Worker), import-match judgment (Claude), and group signal (SQL).

### Decision: Taste personalization is nearest-liked re-rank, not a centroid

Re-rank retrieved candidates by **max cosine similarity to any favorited recipe**, not by distance to an averaged taste centroid. People are multimodal (loves delicate Japanese *and* hearty BBQ); a single centroid lands in a meaningless middle. The favorite set is small and already embedded, so this is cheap and Worker-side. Cold start (no favorites) falls back to the stated taste/diet profile.

### Decision: Favorites set direction, freshness sets rotation — they compose

"Favor what I love" and "favor what I haven't cooked" look contradictory but operate on different axes: favorites shape *which kinds* of recipes rank (taste direction); the freshness boost picks *which instance* among similar ones (cooked-recently → demoted). So "you love braises → here's a braise you've never made" is the intended output, and never-cooked imports get their shot the week after import. The rotation window (`resurface_after_days`, `novelty_boost`) is **user-configurable** in the preferences merge-patch schema, read by the re-rank, reusing existing `last_cooked` / `not_cooked_since` machinery. A "bit outside your usual" allowance in import/surface judgment keeps the import-match + retrieve-match loop from tightening into a filter bubble.

## Risks / Trade-offs

- **Description quality is load-bearing for everything** (search, dedup, the user-facing line, side-term basis) → invest in the generation prompt (describe along craving axes), make it human-editable, validate it's non-empty and not the scraped copy; spike it on the existing corpus and eyeball whether "cozy braise" retrieves the right things before committing.
- **Recall loss from retrieval** (a good recipe no query surfaced is invisible) → generous K, multiple diverse specs incl. a wildcard/variety and a novelty spec, hard facet gates; keep it experimental and A/B against dump-and-reason on a real corpus.
- **Filter-bubble tightening** (import-match and retrieve-match both pull to the same attractor) → the "bit outside your usual" import allowance + the never-cooked boost; rely on curated-feed breadth and Claude's match latitude being broader than a cosine threshold.
- **Embedding-model gaps on niche food terms** (`bge-base-en` may not place "gochujang" as Korean/spicy) → the AI description compensates by spelling out the latent axes explicitly.
- **Brute-force B runway** (loading embeddings through the Worker grows with corpus) → facet-prefilter before cosine, optional int8 quantization, and the written-down Vectorize promotion trigger; the backend-agnostic contract makes the swap a tool-internal change.
- **In-session import adds latency/complexity to planning and does GitHub writes** (recipes stay in GitHub) → conditional on matches only; each import solo-commits like `create_recipe` today (no batching — accepted, see Resolved Questions).
- **BREAKING rating→favorite migration** → a standalone D1 migration adds `overlay.favorite`, backfills `rating >= 4 ⇒ favorite = 1`, and drops `rating` once the group-signal and any rating-weighting consumers switch to favorite-count; retain `rating` through the cutover for rollback.

## Migration Plan

0. **Pre-req (already landed):** the D1 platform (#69–#72) — the `recipes` and `overlay` tables, `projectToD1`, GitHub-recipes-only. No gate remains.
1. **Additive metadata first (breaks nothing — old flow ignores it):** add `description`, `side_search_terms` to recipe frontmatter + schema; a D1 migration adds the `description`/`side_search_terms` columns to `recipes` **and creates the sibling `recipe_embeddings` table**; the build projects the two new columns (no AI), and a Worker-side cron reconcile fills `recipe_embeddings` from each description via `env.AI` (change-driven on a description hash, prunes orphans). Backfill descriptions (and side terms for mains) for the existing corpus (one-time, in-session or scripted — already in progress in the data repo).
2. **Search tool:** ship `recipe_semantic_search(specs[])` (facet-prefilter → cosine) behind the backend-agnostic contract.
3. **Experimental skill:** add the invoke-by-name `semantic-meal-plan` skill (distill → retrieve → compose + in-session aggressive import). Production `menu-generation` untouched. A/B.
4. **Favorite (BREAKING):** D1 migration adds `overlay.favorite` (backfill `rating >= 4 ⇒ 1`); replace `rate_recipe` with `toggle_favorite`; switch the group signal to favorite-count; wire the k-NN re-rank and freshness boost; drop `rating` once consumers move.
5. **Promote when proven:** if the experiment beats dump-and-reason on the real corpus, make retrieval the default selection path; only then revisit dropping `draft`/`status` corpus-wide.

**Rollback:** the skill is invoke-by-name and parallel — stop invoking it. The additive columns/fields are inert to the old flow. The only non-trivial rollback is the favorite migration (reversible by retaining `overlay.rating` through the cutover until the experiment is committed).

## Resolved Questions

- **Reject scope — SHARED.** An explicit reject suppresses the discovery URL group-wide (a shared flag on the `discovery_candidates` URL), so the group curates one noisy discovery stream once rather than each member re-rejecting the same junk. This is deliberately asymmetric with `favorite` (per-tenant: taste is personal): rejection is collective curation, favoriting is personal taste. To keep a shared reject from hiding a recipe another member would favorite, reject is reserved for "not corpus-worthy for the group" (junk/broken/non-recipe/dupe/off-base); a personal not-for-me-this-time is a no-action skip, not a reject.
- **Commit batching — NONE.** Each in-session import solo-commits to GitHub exactly as `create_recipe` does today (`commit_changes` is retired). One commit per imported recipe is accepted — it matches current behavior and gives each recipe its own provenance commit. No batching machinery.

## Open Questions
- **Description generation contract:** fixed prompt vs lightly-structured ("2 sentences: what it is / flavor+texture / when you'd want it"); and whether to auto-regenerate on prompt change (lean: no — treat human edits as authoritative, embedding rebuilds from current text).
- **`hidden` boolean:** keep a per-tenant "never show me this" alongside `favorite`, or is URL-suppression + non-favorite enough?
- **Novelty spec weighting:** how hard the never-cooked boost pushes by default before the user tunes it.
