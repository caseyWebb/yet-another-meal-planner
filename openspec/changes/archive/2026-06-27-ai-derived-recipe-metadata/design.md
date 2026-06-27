## Context

The system already runs a scheduled reconcile (`src/recipe-embeddings.ts`) that derives a recipe **embedding** from its `description` and stores it in the sibling D1 `recipe_embeddings` table — change-driven via a `description_hash` gate, bounded per tick, health-tracked, `env.AI`-backed. The `description` itself, however, is authored into frontmatter and projected into the `recipes` table by the Node build. So one derived artifact (description → vector) is split across two tiers and two producers. This change closes that split by making the description a Worker-derived D1 field too — the embedding's prior art is the template.

The data model's three-tier boundary (`cloudflare-data-platform`) already says GitHub/frontmatter is "authored … hand-edited via Obsidian/native apps" and D1 holds "derived projections." A machine-written description is, by that boundary's own definition, D1 data that is currently in the wrong tier.

## Goals / Non-Goals

**Goals**
- Make `description` a derived field: Worker-generated (`env.AI`), D1-resident, regenerated when human-authored content changes, never in frontmatter.
- Improve description **consistency** (one model, one prompt, one voice) — the thing that helps embedding recall and the "why this dish" surface.
- Establish a reusable **frontmatter-vs-D1 placement rule** for derived recipe fields.
- Land on the **current GitHub setup** with no storage migration, de-risking `r2-recipe-corpus`.

**Non-Goals**
- Moving the **classification facets** (`protein`/`cuisine`/`course`/`dietary`) to D1 — they have a human author/corrector of record (and a forthcoming Obsidian dropdown surface), so by the rule below they stay in frontmatter. Discussed as candidates only.
- Migrating `perishable_ingredients` — a strong candidate (the schema already calls it "derived at import"), captured for a follow-up; not moved here to keep this change to one field.
- The R2 storage move, AI **facet** proposal/repair, or any authoring-UI work — separate changes.

## Decisions

1. **The placement rule.** *A recipe field lives in frontmatter iff a human is its author or corrector of record. A field that is purely derived and freely regenerable lives in D1 and never touches the authored file.* `description` is purely derived → D1. Facets have a human corrector → frontmatter. This rule is the change's durable contribution; `description` is its first application.

2. **Generation runs on the reconcile (the cron), not at import.** Authority for the description is the scheduled reconcile, because it is the only producer that also covers **human-direct edits** (today a hand-edited recipe; after `r2-recipe-corpus`, an Obsidian edit) with no agent in the loop — i.e. it is **self-healing**. *Alternative considered:* generate at `create_recipe` time with the big model (higher quality per call) — rejected as authority because it cannot see a later human edit; it may still **seed** a provisional description (see Open Questions). The reconcile being authoritative is also what makes a future model/prompt upgrade a no-touch re-derive.

3. **Co-locate the derived pair.** Store `description` next to its embedding — one row per `slug` in the (renamed) `recipe_derived` table carrying `description`, `embedding`, and a `content_hash`. They share a producer, a cadence, and a key; co-locating them lets one reconcile pass generate-then-embed and one gate (`content_hash`) drive both. *Alternative:* a separate `recipe_descriptions` table — fine, but two tables for two halves of one artifact with identical lifecycle is needless. Either way the projecting build must not own the column (the wholesale `DELETE`+re-`INSERT` on `recipes` would clobber a reconcile-written field — exactly why embeddings are already a sibling).

4. **Gate on a content hash of the authored facets.** Generalize `description_hash` → `content_hash` over the authored frontmatter facets the description is derived from — `title, ingredients_key, course, protein, cuisine, time_total, dietary, season` — **not the body** (the reconcile stays pure D1 + AI; resolved with the user, since the body lives in GitHub markdown the cron doesn't read, and the spike validated facet-level input). A facet change → regenerate description → its hash changes → re-embed. Steady-state work stays ≈ 0. (Post-`r2-recipe-corpus`, when the body is a cheap R2 read, body-aware generation is a natural free enrichment.)

5. **Read-merge, like the facets.** `read_recipe` already composes shared content + overlay + cooking-log `last_cooked`; the D1 description joins the same way. A recipe whose description has not yet been generated (just imported, reconcile not yet ticked) reads with a **null/empty description** — treated as "not yet derived," never an error, mirroring the embedding's "unembedded until the next tick" tolerance.

6. **Model choice is a tunable with an eval, not a guess.** A Workers AI instruct model writes the description. The task is short, constrained, and low-stakes; cost at friend-group volume (a few imports/week, change-driven steady state) is trivial and well inside the Workers AI allowance. A quality eval (below) gates the model pick; the model id is config, swappable without a contract change.

   **Spike finding (live, 2 recipes × 4 models on this account).** All of `llama-3.3-70b-instruct-fp8-fast`, `llama-3.1-8b-instruct-fast`, `mistral-small-3.1-24b-instruct`, and `llama-4-scout-17b-16e-instruct` produced coherent, on-format, consumer-ontology-clean descriptions. The **smaller** models were the better fit: `mistral-small-3.1-24b` (33/32 words) and `llama-3.1-8b-fast` (35/37 words) were tightest and most length-uniform, while the 70B (50/58 words) ran long and risked the ~60-token embed budget. **Shortlist: `mistral-small-3.1-24b-instruct`** (uniform length + structured-output/tool-calling, useful for a later facet-proposal change) **or `llama-3.1-8b-instruct-fast`** (cheapest, nearly as tight); 70B is a fallback only with a hard length clamp. So the cost-optimal model is also the quality-optimal one here. **Caveat (run 1):** descriptions converged on a cliché ("perfect for a cozy weeknight dinner") across recipes *and* models — not merely stylistic: boilerplate in the embed source dilutes semantic-search discrimination.

   **Run 2 (anti-cliché prompt: one sentence 25–40 words, lead with the dish's defining trait, explicit ban on filler/occasion phrases, temp 0.3; 3 recipes × 3 models).** The prompt is the dominant lever — the same models went from cliché-ridden 50-word blurbs to distinct, sensory one-liners (18–31 words), and descriptions were clearly differentiated across recipes (good embed signal). Ranking *flipped* under the tighter prompt: **`mistral-small-3.1-24b` is the lead** — best length/voice balance, keeps finishing details (e.g. "brightened by lime and cilantro"); `llama-3.3-70b` **overcorrected to terse** (18–19w, below the floor, dropping garnish detail); `llama-3.1-8b-fast` was serviceable but **flowery** ("harmonious union…", "lemon-kissed"). **Decision input:** default to `mistral-small-3.1-24b-instruct` + this anti-cliché prompt. Open micro-levers: a louder length *floor* if 70B is ever preferred; trivial post-trim for rare unicode artifacts (Mistral emitted "orégano" once).

   **Run 3 (3-shot exemplars + stress test: control, ultra-sparse, polarizing, near-zero-signal, overloaded; mistral-small-24b vs llama-3.1-8b-fast).** Few-shot worked — it tamed the 8B's floweriness and anchored length (18–25w) for both; **keep it.** The stress test found the decision-relevant failure mode: **under near-zero-signal input the 8B hallucinated concrete details** (invented "carrots" and "green beans" for a vague "assorted vegetables" soup) to satisfy "be sensory," while **mistral-small degraded to generic-but-honest** (no invention). Because the description *is the embed source*, fabricated facts would poison semantic search — so this is a correctness reason (not just style) that **confirms mistral-small-3.1-24b as the lead.** Both handled the ultra-sparse case (buttered toast) honestly (the "don't invent" guard held), stayed accurate on a polarizing dish (natto; the 8B's "slimy" is honest but unappetizing), and went **listy with a minor technique mischaracterization on an overloaded recipe** ("sourdough crust"/"scrambled" for a cubed-bread custard bake). Guardrails for task 6.1's prompt: (1) "if the input lacks detail, stay general rather than inventing specifics"; (2) "name the single most distinctive element; don't enumerate every ingredient or over-specify technique you're unsure of." **Method caveat:** these used one-line summaries; real recipes carry full bodies (ingredients + steps), so the hallucination risk lives at the **sparse tail** — which the eval must therefore include. The eval (task 6.1) still needs 10–20 real recipes to confirm.

## Risks / Trade-offs

- **[Workers AI description quality < big-model]** A small model may write a blander or slightly-off ~60-token blurb. **Mitigation:** consistency (not peak prose) is the goal; it is low-stakes (a search aid + a one-line "why this dish," not user-facing recipe content); a held-out eval compares candidate models against current human descriptions before adoption; the model is swappable config.
- **[Reconcile lag to first description]** A just-imported recipe is description-less (and so embedding-less) until the next tick. **Mitigation:** already the accepted contract for embeddings; bounded by tick cadence; optional import-time provisional seed (Open Questions).
- **[Build/reconcile clobber]** If the derived description lived on the `recipes` table, the build's wholesale rebuild would erase it. **Mitigation:** Decision 3 — it lives in the reconcile-owned sibling table, never projected by the build.
- **[Hash scope error]** If `content_hash` accidentally includes a *derived* field, regeneration could loop. **Mitigation:** hash strictly the human-authored input; unit-test that a derived-field change does not flip the hash.

## Migration Plan

Additive, no data loss:
1. Add the derived column/table (migration) + the `env.AI` text helper + the reconcile description pass (gated by `content_hash`); deploy. The reconcile **backfills** descriptions for the existing corpus over successive ticks (bounded per tick, like a cold embedding backfill).
2. Once backfilled, switch `read_recipe` to the D1 description and drop `description` from the write tools + the frontmatter contract (`recipe-contract.js` / `validate.ts`) and from the build projection.
3. A one-time pass strips the now-dead `description:` line from existing frontmatter (cosmetic; the field is ignored once out of the contract). Optional, can ride a later bulk edit.

Rollback is a redeploy of the prior Worker + reinstating the contract field; the authored descriptions remain in git history until step 3.

## Open Questions

- **First-description latency (the reconcile-lag window).** A just-created recipe has no description until the next reconcile tick. Three ways to handle it, weighed against the *consistency* goal (one voice is the whole point):
  - **(a) Synchronous generation at import** — `create_recipe` calls the **same** `env.AI` model the reconcile uses (one internal subrequest, ~1–2s). No lag, one voice, no downgrade-on-edit. **Leaning option.**
  - **(b) Accept the lag** — do nothing special; the recipe is briefly description-less, exactly as it is briefly unembedded today. Simplest; fine if imports aren't immediately read/planned.
  - **(c) Big-model (agent) seed at import** — Claude, already in the loop at import, writes the first draft. Best prose, but reintroduces a *second voice* and a *downgrade-on-edit* (the reconcile's smaller model overwrites it when the body later changes), which needs a "don't overwrite unless content changed" rule. Only worth it if peak prose beats consistency. **Discouraged** for that reason.
- **`perishable_ingredients` next?** It is already "derived at import." Moving it to D1 is the obvious second application of the rule — but it is consumed by the order/waste path; confirm no consumer needs it inline in the file before relocating. Captured for a follow-up.
- **Facet auto-fill (separate change).** Should the reconcile *propose* missing/blank facets (not author them — they keep a human corrector)? That is the "self-healing for human edits" idea; it belongs with `obsidian-authoring-vault`'s dropdown-confirmation flow, especially for the safety fields (`dietary`), and is explicitly out of scope here.
- **One reconcile vs two passes.** Generate-then-embed in a single tick (simplest; description ready and embedded together) vs. two independent gates. Leaning single pass over the co-located row.
