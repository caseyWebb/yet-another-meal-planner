## Context

Discovery today runs entirely inside a `meal-plan` conversation: the agent calls `fetch_rss_discoveries` (live feed pull, deduped vs corpus + rejections) and `read_discovery_inbox` (the email-pushed `discovery_candidates` table), then Claude triages cheap-first, `parse_recipe`s the fits, classifies them into frontmatter, and `create_recipe`s — 1–2 per session, human-attended. The determinism-boundary doc (`ARCHITECTURE.md`) already names "taste-profile scoring of new discoveries" as a legitimate LLM job; it simply runs in chat.

The machinery to move it off the conversation already exists:
- **`env.AI`** is bound and already used by `src/description.ts` (text gen, `mistral-small-3.1-24b`) and `src/embedding.ts` (`bge-base-en-v1.5`, 768-dim) — on the **internal** Cloudflare-services subrequest budget (1,000/invocation), distinct from the **external** 50-subrequest cap that fetches contend for.
- **`src/flyer-warm.ts`** is a complete, unit-tested pattern for a tenant-enumerating, cursor-swept, budget-bounded, health-tracked background job over injected deps — the template for the fetch leg.
- **`src/recipe-embeddings.ts`** (the recipe-derived reconcile) is the template for the `env.AI` leg: change-driven (hash gates), per-tick caps, `Promise.allSettled` in `scheduled()`, rethrow-on-failure.
- **`favoriteAffinity()` / `cosineSimilarity()`** (`semantic-search.ts` / `embedding.ts`) already compute "max cosine of a recipe to any of a member's favorited recipes" — the taste-match primitive, verbatim.
- **`recipe_derived`** already holds every corpus recipe's description embedding — a ready-made duplicate detector.
- **`buildNewRecipe` + `validateFile` + `seedRecipeDescription`** are the write path; the cron reuses them, driven by the small model instead of Claude.

So this is composition: a fourth `scheduled()` job that relocates discovery's *capture* from the frontier model in-chat to a small model on-cron, leaving `meal-plan` to *retrieve* what the sweep captured.

## Goals / Non-Goals

**Goals:**
- Make discovery **continuous and autonomous** — recipes are found, classified, embedded, and imported by a background sweep, not by a planning conversation.
- **Auto-import** any candidate that matches **any** member's taste, into the shared opt-out corpus, with the cost of the expensive (classify) leg kept **proportional to matches**, not feed volume.
- Keep the matcher **negation-aware** (a cheap cosine recall filter + a small-LLM confirm) so "I hate cilantro" is respected without an LLM call per candidate.
- Prevent **duplicate imports** — exact-URL (existing) and semantic near-dupes (new) — reusing the embedding machinery.
- Bound corpus growth with a **governor** now that the autonomous matcher is the only gate.
- Reduce `meal-plan` to a **new-for-me read** of recently-imported, taste-matched, undispositioned recipes — and kill the "not retrievable this session" wart (the sweep embeds before you plan).

**Non-Goals:**
- The **manual import path** (a member hands the agent a URL or pastes text → `parse_recipe`/`create_recipe`, frontier-model classification, paste fallback for walled sources) is **unchanged** — only *unprompted* discovery goes background.
- **Vectorize / ANN** — the dedup + match cosines run brute-force over `recipe_derived` and the small favorite/taste vector sets, exactly as `semantic-search.ts` already does; promotion stays measured-and-deferred.
- Reaching **bot-walled / paywalled link-only sources** the cron cannot fetch — see the accepted trade-off below.
- Onboarding/profile UI for taste authoring — the matcher reads the existing `profile.taste` + favorites.

## Decisions

1. **A fourth `scheduled()` job — a two-budget sweep.** Add `src/discovery-sweep.ts` (sweep core over injected `DiscoveryDeps`, mirroring `WarmDeps`) wired into `scheduled()` beside the warm/projection/reconcile. It is the *union* of the flyer's two concerns: a **cursor-swept, bounded-batch fetch leg** (feed polls + recipe-page fetches — external, the 50-cap) and a **per-tick-capped `env.AI` leg** (classify/describe/embed/confirm — internal, the 1,000-bucket). Like the flyer it builds a plan once per sweep, persists a cursor, advances after each idempotent publish, no-ops when caught up, and re-arms on a refresh gate. *Alternative — a separate cron trigger:* rejected; the murky free-tier cron-*count* limit is why everything rides one trigger today, and the budgets don't collide (external vs internal).

2. **Progressive narrowing — classify last, because classification is the cost.** Matching needs an embedding; an embedding needs a description; a description needs facets; facets need classification — so "match then import" is really "classify, then keep the matches." To keep the expensive leg proportional to matches, the pipeline narrows cheaply first:
   - **[triage]** embed `title + summary` (one `bge` call, **no classification**) and `favoriteAffinity` it against each member's taste vectors; drop candidates near *nobody*.
   - **[classify]** only on triage survivors: fetch the page (or use the inline email body), classify into validated frontmatter + description via `env.AI`.
   - **[confirm]** re-embed the description (higher fidelity than the blurb), re-cosine, apply each member's **dietary hard gate**, then one small-LLM "genuine fit — for whom?" on survivors (the negation-aware step).
   - **[import]** `buildNewRecipe` + `validateFile` + write + `seedRecipeDescription`; stamp `discovered_at`, `discovery_source`, and match attribution.
   This mirrors the Kroger matcher's "deterministic narrowing, LLM only when ambiguity remains."

3. **The matcher is hybrid cosine + small-LLM confirm, over a new per-member taste vector.** Recall is the cheap cosine (reusing `favoriteAffinity` over the member's favorite vectors **plus** a new embedded distillation of `profile.taste`); precision is the small-LLM confirm. *Why both:* pure cosine is **negation-blind** (a "hated" ingredient embeds *close* to a taste that names it), while an LLM-per-candidate scales with volume not matches. *The taste vector* is a new derived artifact — embed `profile.taste`, hash-gated and regenerated when the text changes, stored sibling to the profile (the `recipe_derived` pattern applied to taste). *Cold-start:* a member with no favorites leans on the taste vector; a member with neither is matched by feed-weight/group-default until they have one signal. *Thresholds* (τ for taste, and the confirm prompt) are calibrated by the Phase-0 spike, not guessed.

4. **Per-member match attribution does double duty.** A new `(recipe, tenant)` attribution record (written when a member's cosine clears τ and the confirm agrees) is **both** the import gate (import iff ≥1 member matched) **and** the per-member surfacing filter. The corpus stays shared and opt-out, but "**new for *me***" is filtered to *my* matches — so the group's combined discovery never floods any one member's plan view. *Alternative — surface every import to everyone:* rejected; at background volume that buries each member under the union of everyone's tastes.

5. **Deduplication is the match cosine aimed at the corpus.** Three layers, cheapest first:
   - **[L0, existing]** canonical `source_url` vs corpus (`recipeSourceMap`) + `discovery_rejections`, with `normalizeRecipe` preferring the JSON-LD-declared `source` over the fetch URL (collapses syndication/trackers), plus a new `discovery_evaluated` set so non-matches aren't re-fetched/re-classified each sweep.
   - **[L2, new]** the candidate's description embedding cosined against `recipe_derived`; `max cosine ≥ δ` ⇒ skip as a near-dup (δ ≫ τ — a much tighter bar). Same vectors already in hand; same brute-force cosine `search_recipes` already runs.
   - **[L3, new]** an intra-sweep pass: cosine candidates against each other and against this-tick's imports, because the corpus check can't see uncommitted rows (and the reconcile hasn't embedded them yet). *Optimization:* since the sweep embeds the candidate for matching anyway, it MAY seed that vector into `recipe_derived` at import, closing the reconcile lag so L2 covers later ticks immediately.
   - **[bonus]** rejects *repel* symmetric to how favorites *pull*: a candidate cosine-close to a recipe member M `toggle_reject`ed is **not** attributed to M. Same machinery, free precision.
   Dedup skips are **logged** (a sweep-health counter / `discovery_errors`), never silent, per the "no silent caps" discipline.

6. **A governor, because the matcher is now the only gate.** Two knobs: the taste threshold τ (calibrated), and a **per-window auto-import rate cap** (e.g. N/day) with excess **deferred to the next tick and logged** — so a feed flood can't balloon the corpus in one sweep. *Alternative — no cap, trust τ:* rejected; a single over-prolific feed plus a slightly-loose τ is exactly the failure mode that degrades search precision for everyone, and it is invisible without a cap+log.

7. **The classifier is the load-bearing risk — spike it first (Phase 0).** Description-gen already runs on `env.AI`, but **full frontmatter classification** (controlled-vocab `protein`/`cuisine`/`season`, the conservative `requires_equipment` call, the "would the leftover rot" perishable test, `side_search_terms`) is materially harder and runs **unattended** — no conversational retry, no human. Failures split:
   - *Loud* (off-vocab → `validation_failed` on write): retry N times with a corrective reprompt, then **park** in a `discovery_errors` table (mirror `reconcile_errors`) + `read_discovery_errors` tool + ntfy push.
   - *Silent* (wrong `requires_equipment` hides a makeable recipe; wrong `season` buries it; a bland description that embeds poorly): these never error — they quietly degrade the corpus, and at volume the *rate* matters. Mitigated by opt-out (`toggle_reject`) + the spike's accuracy bar.
   The spike measures, over a held-out real-recipe set: vocab-validity rate, facet accuracy (esp. the silent-failure fields), description quality, **and** the cosine thresholds (τ, δ). A failed bar flips the design toward "background scoring, chat imports" — so it runs before the pipeline is built.

8. **"New for me" = recency ∧ attribution ∧ undispositioned.** The read is `discovered_at > my last_planned_at` **∧** I'm in the attribution set **∧** no overlay row for me **∧** not in my `cooking_log`. Requires: promoting `discovered_at` from `recipes.extra` JSON to a **queryable column + index**; a per-tenant `last_planned_at` (a `profile` column, stamped when `meal-plan` saves); and the attribution table. A **fixed-window floor** (e.g. 21 days) bounds the cold-start case (a brand-new member doesn't get the whole backlog). The disposition/cooking filters mean a recipe falls off the list once you act on it — no separate "mark seen."

9. **Retire the pull tools; keep the manual path; reframe reject.** `fetch_rss_discoveries` + `read_discovery_inbox` leave the agent surface (their logic becomes sweep internals). `parse_recipe`/`create_recipe`/`update_feeds`/`update_discovery_sources` stay (manual import + config). `reject_discovery` is **reframed**: with no pre-import candidate for a human to see, it suppresses a **source URL** group-wide so the sweep won't re-import it (folded into the L0 dedup set), and pairs with `toggle_reject`/recipe removal for an already-imported miss. The newsletter `email()` intake is unchanged; only its *consumer* moves from `read_discovery_inbox` to the sweep.

10. **The determinism boundary shifts, on purpose.** Discovery's "capture" moves from frontier-in-chat to small-model-on-cron — still capture→retrieve→narrow, just autonomous. `ARCHITECTURE.md`'s determinism-boundary section (point 3 already lists discovery taste-scoring as an LLM job) and the discovery/disposition section are rewritten; "three crons" → "four" throughout.

11. **An operator audit log, surfaced in the admin panel.** Because no member watches the sweep run, the sweep records an **auditable outcome for every candidate it processes** (not just imports): timestamp, source, title, outcome (imported / skipped-duplicate / skipped-no-match / skipped-rejected-source / dietary-gated / parked-error), and outcome detail (import slug + attribution, the matched corpus recipe for a dup, the validation failure for a park). This single log can **subsume** `discovery_evaluated` (the do-not-re-evaluate set = entries with a terminal verdict) and `discovery_errors` (the parked subset), so the audit surface and the dedup/error state are one table, not three. The admin SPA reads it through an Access-gated `GET /admin/api/logs/discovery` and renders it in a **new top-level Logs area**: a left submenu (first item Discovery, extensible to future log sources), the entries on the right (the MCP-inspector master/detail shape the tool console already uses), and a **detail dialog** for an entry's full detail. Modeled per `admin/CLAUDE.md` — entries as `RemoteData`, the selected submenu item and the open-dialog state as custom types so impossible states don't typecheck. *Alternative — surface the log only via the agent `read_discovery_errors` tool:* rejected for the operator view; errors are agent-actionable, but the *full* sweep audit (what imported, for whom, what was skipped and why) is an operator concern, and the cross-tenant attribution view belongs behind Access, not in a per-tenant tool.

## Risks / Trade-offs

- **[Unattended classifier quality < frontier-in-chat]** → Phase-0 spike with an accuracy bar gates adoption (Decision 7); loud failures park to a visible error surface; silent failures ride the corpus's existing opt-out safety; the model is swappable config like `DESC_MODEL`.
- **[Corpus bloat — the human gate is gone]** → the governor (τ + rate cap + logged deferrals, Decision 6); per-member attribution keeps each member's *view* clean even as the shared corpus grows; δ-dedup stops near-duplicate accumulation.
- **[Negation-blind matching]** → the small-LLM confirm leg (Decision 3) reads the taste text and excludes; cosine is recall-only.
- **[Paywalled link-only sources can't auto-import]** → **accepted.** The auto-importable universe is `{RSS with JSON-LD} ∪ {emails with inline recipe text}`; email-push remains the paywall workaround, and the manual `import-recipe` flow (with paste fallback) still handles "import this URL I'm handing you." Walled link-only newsletters lose their recipes silently — the known cost of "completely background."
- **[Two budgets in one job]** → bounded batching on *both* axes (flyer-style unit cap on fetches, reconcile-style per-tick cap on `env.AI`); the sweep shares a tick with three other jobs, so its caps are sized against the *shared* per-invocation budgets, not the job's alone.
- **[Reconcile lag hides same-sweep dupes]** → L3 intra-sweep dedup is mandatory, not optional (Decision 5); optional inline embed-seed closes the lag entirely.
- **[`reject_discovery` semantics change]** → **BREAKING** on the agent surface; the reframe (source-suppression + post-import removal) is documented in `recipe-discovery` and the persona.

## Migration Plan

Additive and stageable; nothing is removed before the replacement is live.

1. **Phase 0 — the spike.** Build the classifier prompt + an eval over real recipes; pick the model, set τ/δ and the rate cap. No production wiring. Gate the rest on the accuracy bar.
2. **Schema (additive).** Migrations: promote `discovered_at` to a `recipes` column + index; add the attribution, `discovery_evaluated`, taste-vector, and `discovery_errors` tables; add `profile.last_planned_at`. Sweep-/reconcile-owned; the projection must not clobber them (sibling-table discipline).
3. **The sweep, dark.** Land `discovery-sweep.ts` + the classifier/matcher/dedup helpers + the per-candidate log + the fourth `scheduled()` job, health-tracked, importing for real but with the pull tools still present — discovery runs **both** ways briefly (dedup makes the overlap safe). Watch the health record, the `discovery-errors`, and the new log.
4. **The operator log view.** Add `GET /admin/api/logs/discovery` + the admin SPA's Logs area (left submenu → Discovery, master/detail, detail dialog); rebuild + commit `admin/dist/`. This rides early so the operator can *watch* the dark sweep before the agent surface flips.
5. **Flip `meal-plan`.** Add `list_new_for_me` + `read_discovery_errors`; rewrite the persona's discovery step to the read; stamp `last_planned_at` on save.
6. **Retire the pull tools.** Remove `fetch_rss_discoveries`/`read_discovery_inbox` registrations; reframe `reject_discovery`; update specs + docs in lockstep.

Rollback is a redeploy of the prior Worker; the additive schema is inert without the sweep, and the manual import path is untouched throughout.

## Open Questions

- **Where does the taste vector live** — a `taste_derived(tenant, taste_hash, embedding)` sibling table (clean, matches `recipe_derived`) vs an embedding column on `profile`? Leaning sibling table (different producer/cadence than the rest of the row, same reasoning that put embeddings in a sibling).
- **Confirm granularity** — one small-LLM confirm per candidate against the *union* of matching members' taste texts (cheaper, one call) vs per matching member (more precise attribution, more calls). Leaning union with the model returning the per-member verdict in one shot.
- **Rate-cap scope** — global N/day vs per-feed vs per-member-attributed. Leaning global with a per-feed sub-cap so one prolific feed can't starve others; finalized with spike volume data.
- **Inline embed-seed at import** (Decision 5 optimization) — do it always (kills reconcile lag, couples the sweep to the embed write) vs leave embedding to the reconcile (simpler, L3 covers the gap). Leaning seed-it, since the sweep computes the vector anyway.
- **Should `reject_discovery` of an already-imported source also remove the corpus recipe**, or only suppress re-import? I.e. is there a distinct "remove bad import" surface? Leaning: `reject_discovery` suppresses the source + the agent removes the recipe if asked — keep the two actions explicit.
- **Exploration allowance in the sweep** — the menu-flow's "a bit outside your usual" pull now has to live (partly) in the matcher, or the corpus collapses into a taste bubble. A small fraction of sub-τ imports? Deferred to a tuning pass, flagged in the spec.
