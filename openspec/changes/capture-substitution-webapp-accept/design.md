# Design

## Context

`converge-meal-planning-surfaces` (#247) established the substitution graph: a `substitution` edge kind on `ingredient_edge` (migration 0048, `weight` + optional `qualifier`), operator-global, born a weight-1 candidate, promoting at `SUBSTITUTION_PROMOTE_MIN = 2`, excluded from `satisfies()` reachability and from every edge-audit pass (all keyed on `kind = 'substitution'`). It is written by exactly one producer today — `captureSubstitution(env, ctx, wantedTerm, addedTerm)` (`src/corpus-db.ts`), triggered by an optional `substitutes_for` on `add_to_grocery_list`, hooked into the shared grocery write path `addGroceryRow` (`src/session-db.ts`). The gate is pure set logic: resolve both terms; require distinct survivors; require Y is not already a factual neighbor of X (`satisfiedBy ∪ satisfies ∪ coChildren`); then upsert with `weight = weight + 1`. Capture is best-effort — any failure is swallowed and never fails the grocery add.

The hook is **surface-agnostic**: `addGroceryRow` takes no origin parameter, and both callers reach it identically — the MCP tool (`add_to_grocery_list`) and the REST route `POST /api/grocery/items`, which already reads `body.substitutes_for` and forwards it. Only the callers differ in whether they *send* it. Today the agent sends it; the web app does not.

The member web app surfaces two kinds of alternative, on two separate code paths (`packages/app/src/routes/_app.grocery.tsx`):

- **Cross-ingredient siblings**, rendered inline on each to-buy row from the enriched read's `substitutes[]` (the depth-1 annotator). Accepting one calls `swapSibling(line, sib, rowKey)`, which posts `add_to_grocery_list({ id: sib.id, name: sib.label, note: "swapped from " + line.name })` and, by origin, a real `remove` (explicit row) or a staged order-scoped `exclude` (virtual row). **This is the X→Y taste swap.**
- **Same-identity SKU alternatives**, surfaced in the order dialog at preview. Accepting one calls `acceptAlternative`, which stages a `place_order` override — same canonical identity, a product/price pick, **not** a substitution.

## Goals / Non-Goals

**Goals**
- Capture a cross-ingredient swap accepted in the web app through the same `substitutes_for` hook the agent uses, so the two behavioral surfaces feed one operator-global graph.
- Ship the app-suite (Playwright) coverage that a member-app change requires.
- Preserve the exploration's conclusions on comment-mining (Thread B) as a deferred, revisit-able memo.

**Non-Goals**
- No comment-mining cron, no small-model extraction, no note-processing watermark (Thread B — deferred below).
- No `qualifier` writer (the column still has none; deferred with Thread B).
- No schema change, no new `source`/provenance column, no new tool param, no new `/api` route or shape — everything Thread A needs already exists.
- No change to the same-identity SKU override path, and no change to the matcher's resolve-only / never-substitutes guarantees.

## Decisions

### D1 — Wire `substitutes_for` at the single client accept point

Add `substitutes_for: line.name` to the existing `add_to_grocery_list` `$post` inside `swapSibling` (`_app.grocery.tsx`). That is the whole client change. Everything downstream already exists and is exercised by the agent path: the route forwards it, `addGroceryRow` fires capture for a food add, and `captureSubstitution` guards cross-ingredient-only and is throw-free.

**Why:** `swapSibling` is the sole cross-ingredient accept, and it already holds both endpoints — X is the replaced line (`line`), Y is the chosen sibling (`sib`). No plumbing, no new state, no branching.

> Implementation note (D1): `swapSibling` uses a direct typed-client `$post`, not the offline mutation registry — so the capture rides an online-only accept and won't queue/replay offline. This matches intent: substitutions are an online-only surface (`packages/app/src/lib/mutations.ts`). It also means capture never fires from a replayed offline add, which is correct — a replayed add carries no live substitution context.

### D2 — The same-identity accept stays edge-free, enforced twice

`acceptAlternative` (the order-dialog SKU override) is left untouched and sends no `substitutes_for`. Even if a same-identity term ever reached the hook, `captureSubstitution`'s set-logic gate mints nothing (same survivor, or Y already a factual neighbor of X).

**Why:** a substitute is a taste judgment; a cheaper SKU of the same ingredient is not. Keeping the two accepts as distinct functions means the edge-vs-no-edge distinction is structural, with the server gate as defense in depth.

### D3 — X = the replaced line's ingredient (`line.name`)

`line.name` is already the value the flow treats as X: it is the `remove` key and the `"swapped from …"` note text, and it resolves through the same `IngredientContext` the add uses. Using it keeps the app's notion of "what got replaced" identical to what the capture records.

**Why:** any other choice (e.g. `line.key`) would risk the app's displayed swap and the recorded edge disagreeing on X. Both resolve through `ctx.resolve`, so canonicalization is identical; `line.name` is the least surprising.

### D4 — Coverage asserts the POST body, not a graph read

The app suite can't see the operator-global graph, and the capture is best-effort/async. So coverage asserts behavior at the seam it owns: intercept `**/api/grocery/items` and assert the cross-ingredient accept's `postDataJSON().substitutes_for` equals the replaced ingredient, and that the same-identity order-dialog accept posts an override with no `substitutes_for`. The existing `substitutions.spec.ts` already pins the accept's add+remove / materialize+exclude semantics and has the page-object helpers (`acceptSub`, `addRow(name, extra)`); this extends it.

**Why:** the actual edge accrual is the `ingredient-normalization` capability's concern and is unit-tested there. The app's contract is "the accept sends the right signal," which is exactly the POST body.

## Risks / Trade-offs

- **[One member's taste leaking into the operator-global graph]** → the same risk the agent path already carries; unchanged by this. Promotion still requires repeated observation, and the graph is suggestions-only (excluded from `satisfies()`), so a wrong edge degrades to world knowledge. Standing idiosyncratic stances still belong in per-member `taste.md` (persona), not the shared graph.
- **[Double-count with the agent path]** → if a member accepts the same swap once via Claude and once in the app, weight accrues twice. That is correct — two real acceptances *are* two observations. There is no cross-surface dedup and none is wanted.
- **[Online-only capture]** → an offline-queued accept won't capture (D1). Accepted: substitutions are an online-only surface, and a replayed add has no live substitution context.

## Deferred: mining recipe-note prose for substitutions (Thread B)

This is the explored-but-not-built third capture source, recorded here so the reasoning survives. **It is deferred, not rejected** — the shape is sound; the current corpus does not justify it and it is the one source that touches the determinism boundary.

### What it is

A cron reconcile pass (sibling to the derivation/reconcile jobs in `scheduled()`, phase-5 producer modeled on `runArchetypeDerivationJob`) that reads `recipe_notes.body`, uses a small Workers-AI model (mistral-small-3.1-24b — the tier that already does classify/describe/confirm) to extract `(wanted, replacement[, ratio/caveat])` tuples from prose, resolves both endpoints through `ingredientContext.resolve()`, and mints candidate substitution edges — with the note's caveat as the edge `qualifier`.

### What the data says (production snapshot, 2026-07-10)

- `recipe_notes`: **10 rows, 2 authors, 4 private**, spanning 2026-06-26 → 2026-07-09. This is a friend-group cookbook, not a public review corpus. **There is no other mineable comment data** — discovery-sweep/parse/ingest do not capture JSON-LD reviews/comments; `store_notes` is store logistics.
- `ingredient_edge` `substitution` kind: **0 rows.** The shipped behavioral capture has minted nothing yet (#247 merged 2026-07-09 — one day of history), so there is no behavioral baseline for note-mining to *complement*.
- Of the 6 shared notes, ~5 carry real directed subs (e.g. "Sub parsley for cilantro", "canned diced green peppers instead of poblano", "some of the ketchup for gochujang or sriracha", "fish sauce works in place of anchovies, or MSG if it's all you have"). The **signal rate is high** (notes are the advertised "spin-capture mechanism") but the **volume is tiny**. Building a cron + model activity + watermark + review surface + qualifier writer + tests + docs to mine ten notes is disproportionate today.

### The determinism-boundary resolution

The `ingredient-normalization` spec and ADR-0001 forbid one thing: *"the system SHALL NOT invent substitution edges from a small-model classifier over the corpus."* That guard is aimed at **invention** — a model speculating what *could* substitute from world priors (source = model). Note-mining is different in kind:

```
 PURE OBSERVATION          OBSERVATION, MODEL-MEDIATED         PURE SPECULATION
 member DID it             member SAID it; model transcribes   model GUESSED it
 ├──────────────────────────────┼───────────────────────────────────────────┤
 grocery / web-app accept        note-mining (Thread B)         classifier over corpus
   (behavioral — this change)                                     (SPEC FORBIDS)
```

Extraction ≠ invention: the member is the source, the model only parses their written testimony. So note-mining is **not the prohibited thing in spirit** — but it *is* in letter, and it introduces an error layer behavioral capture lacks. All of these appear in just 6 production notes: **direction** ("Sub parsley *for* cilantro" → X=cilantro, Y=parsley — trivially flipped by a small model), **removal ≠ sub** ("Omit Thai bird chiles"), **same-ingredient form swap** ("skinless thighs instead of skin-on" — the set-logic gate must reject), **multiple targets + partial ratio** ("*some of* the ketchup for gochujang *or* sriracha"), and **fallback qualifier** ("… or MSG *if it's all you have*").

**The guard that would make it admissible: keep the model off the graph-authoring path.** The model may *propose*; a non-model corroborator must ratify before an edge surfaces — either (a) the operator reviews it (a new `pending_proposals` kind, precedent `merge_recipes`, whose accept records a decision but writes nothing itself), or (b) a behavioral observation corroborates it (a mined pair stays an invisible weight-1 candidate until a real grocery/web accept promotes it). Reusing `captureSubstitution` verbatim (mined mention = weight-1, two mentions = promoted+surfaced) is the one posture that **violates** the ADR and must be rejected.

### The self-corroboration defect (a concrete reason the naive posture fails)

Promotion at weight 2 assumes **two independent observations**. The dedup key is `(from_id, to_id, kind)` — no author dimension — and production has only **2 authors**. So one prolific note-writer saying "sub parsley for cilantro" in two notes would self-promote an edge to operator-global truth. Any note-mining producer must therefore either carry a distinct `source` with its own promotion counter, dedup per `(author, pair)`, or route to review — it cannot share the behavioral weight counter.

### The decomposition that de-risks half of it

- **B1 — qualifier enrichment (low risk, already in-spec):** for an edge that *already exists* (behaviorally grounded), attach the note's caveat as the `qualifier`. The model only annotates an already-valid edge; the spec explicitly permits "a qualifier … authored later — by a model when good enough." Zero boundary tension. Caveat: chicken-and-egg — 0 edges exist today, so nothing to enrich yet. **This is also the natural first writer of the `qualifier` column, which has none.**
- **B2 — candidate minting (higher risk):** for pairs *never* behaviorally observed, the model is a (partial) source of the edge's existence. This is the boundary fight, needing the propose→ratify guard above.

### Mechanism reframe: a recurring cron is the *last* tool to reach for

Members write notes two ways — through Claude (`add_recipe_note`) **and** directly in the web app (`POST /cookbook/recipes/:slug/notes`, bypassing the agent). That splits the capture options:

- **Write-time structured capture (ADR-cleaner, cheaper):** the frontier agent writing a note via `add_recipe_note` is already in-context and could pass a structured `substitutes_for` (mirror of the grocery hook). But it misses free-prose subs typed directly into the web-app cookbook, and you *cannot* extract synchronously in the note POST handler — a model call on the hot path violates the cold-path discipline (mistral-small is always bounded/gated, never hot-path).
- **The cron's one genuine niche** is exactly those free-prose subs in directly-authored web-app notes that never see the agent. That is a real ongoing job — but not at 10 notes.

So: extraction *fits* the small-model tier (tension #3 answered: mistral-small already does this class of task), but the *situation* doesn't call for it yet. For the handful of historical notes, the operator's own Claude doing a one-shot pass is cheaper and higher-quality than standing up a recurring cron.

### Composition of the sources

Sources 1 (agent `substitutes_for`) and 2 (web-app accept — this change) are the **same behavioral signal** from two surfaces; they legitimately co-accrue into one edge. A linguistic source (3) is different in kind and must **corroborate/annotate, not author**: enrich qualifiers on grounded edges freely (B1), route new pairs to review/corroboration (B2). Vetoes ("don't sub X, it was terrible") stay out of the operator-global graph — the persona already routes standing substitution stances to per-member `taste.md`.

### Revisit trigger

Reconsider Thread B when the note corpus is large enough that behavioral capture demonstrably misses signal — a rough bar: **notes numbering in the low hundreds across ≥3 authors, or a standing backlog of directly-authored web-app notes carrying subs that never passed through the agent.** When revisited, start with B1 (qualifier enrichment) + the write-time structured path, and treat the recurring small-model cron (B2 via operator review) as the last increment, with a distinct `source` and a non-shared promotion counter.

## Out of scope (explicit)

The comment-mining cron and its small-model extraction, a note-processing watermark, a `qualifier` writer, a `pending_proposals` substitution-candidate kind, any new `source`/provenance column on `ingredient_edge`, the cook-log "what did you actually use" capture field (still deferred from #247), and any change to the same-identity SKU override path or the matcher's resolve-only guarantees.
