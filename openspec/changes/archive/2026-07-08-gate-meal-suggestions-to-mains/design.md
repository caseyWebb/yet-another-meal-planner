# Design — gate-meal-suggestions-to-mains

## Production spike findings (read-only D1, 2026-07-08)

All queries were read-only `SELECT`s via `npx wrangler d1 execute DB --remote` against the
production `grocery-mcp` database (binding `DB`, `packages/worker/wrangler.jsonc`).

**Corpus shape.** 205 recipes; 205 `recipe_facets` rows (fully classified). Effective `course`
(the `recipes` column, a JSON array):

| course set | n |
| --- | --- |
| `["main"]` | 135 |
| `["main","side"]` / `["side","main"]` | 18 |
| `["side"]` | 14 |
| `["dessert"]` | 11 |
| `["sauce"]` | 10 |
| other main-containing (`["main","sauce"]`, `["main","breakfast"]`, `["breakfast","main"]`) | 3 |
| other non-main (snack/drink/breakfast/baked_good/appetizer/soup/condiment combos) | 14 |

- **156 of 205 recipes contain `main`** → the gate excludes **49 (24%)**. Correctly sized: those
  49 are sides, desserts, sauces, drinks, snacks, baked goods.
- **Zero recipes have a NULL/empty/`[]` course** — in both `recipes` and `recipe_facets`. The
  classifier's course output is contractually non-empty, and nothing in production is parked
  with empty facets today.

**The defect rows** (`recipes` vs `recipe_facets` — effective equals classified for all three,
i.e. **no authored overrides**; these are pure classifier outputs):

| slug | effective course | classified course | ingredients_key | note |
| --- | --- | --- | --- | --- |
| `fresh-pasta` | `["side"]` | `["side"]` | flour, eggs | the issue's fixture; `side_search_terms: ["a hearty sauce"]` (a contract slip — non-mains should carry `[]`) |
| `homemade-pasta-dough` | `["baked_good"]` | `["baked_good"]` | flour, eggs, olive oil | `side_search_terms: []` |
| `spinach-fresh-pasta` | `["main"]` | `["main"]` | spinach, flour, eggs, salt | a dough classified as a MAIN, with sides suggested ("a simple tomato sauce") — the gate alone cannot catch it |

Three sub-recipes, three different course buckets (`side`, `baked_good`, `main`) — the
classifier has no bucket for a component and scatters. This settles the vocabulary question:
**yes, `component` is needed**, and the corpus must re-converge.

**Cron budget for re-convergence**: the classify pass caps at 6 recipes/tick
(`CLASSIFY_MAX_PER_TICK`, `recipe-classify.ts`) on the `*/5 * * * *` cron → 205 recipes ≈ 35
ticks ≈ **3 hours** (longer if Workers AI quota interleaves; the pass is quota-aware and
resumes).

## Decisions

### D1 — Which surfaces gate (and which deliberately don't)

**Gated by default** (the "system suggests a meal" surfaces):

1. `propose_meal_plan`'s per-vibe pool (`buildPool`) — and therefore, by construction, the
   slot alternates (`alternates`/`alt_similar`/`alt_different`), which are drawn from the pool.
2. `readPickedForYou` (cookbook browse, `GET /api/cookbook/picked-for-you`).
3. `readTrending` (cookbook browse, `GET /api/cookbook/trending`) — trending is presented as
   "cook this"; a dough the group logged twice is real history but not a meal suggestion.

**Deliberately ungated** (explicit-query or news surfaces — the caller states intent):

- `search_recipes` (both modes): an explicit-query tool with an optional `course` facet a
  caller/skill already uses to ask for sides (`recipe-sides`, `menu-generation` specs depend on
  `course: "side"` retrieval). Its `course` filter keeps today's exact fail-closed containment
  semantics (`data-read-tools` spec unchanged).
- The cookbook keyword search (`cookbook-search`): a typed query for "pasta dough" must find it.
- `list_new_for_me`: an inventory/news surface ("what's new in the corpus") — a newly imported
  dessert is legitimately newsworthy; gating it would silently hide discoveries.
- `read_recipe`, all write paths, the retrospective: not suggestion surfaces.

### D2 — One shared predicate, applied per-surface (not inside `filterRecipes`' course filter)

`filterRecipes`' existing `course` filter is an **explicit ask** with exact containment
semantics — it is fail-closed (a recipe with `course: []` does not contain `"main"`) and is
spec'd that way in `data-read-tools`. The default gate needs different semantics (D3 fail-open),
so it is a separate exported predicate (in `recipes.ts`, beside the filter whose data it reads):

```
isMealCourse(course) := courses.length === 0 || courses.includes("main")
```

(normalizing scalar/array/missing exactly as the existing course filter does). Each gated
surface applies it at its candidate-assembly point:

- `buildPool`: filter the `filterRecipes` survivors — unless the effective facet set already
  carries an explicit `course` (D4).
- `readPickedForYou`: in the candidate loop (beside the favorite/reject/avoid skips).
- `readTrending`: in the qualification loop (beside the min-signal and reject guards).

One helper, three call sites, one unit-test matrix — the semantics cannot drift.

### D3 — Fail-open for an empty effective course

A recipe with an empty/missing effective `course` **passes** the gate. Rationale:

- An empty course means *not yet classified* (a direct R2-authored recipe awaiting its classify
  tick, or a parked permanent-failure row whose authored frontmatter carries no course) — it is
  unknown, not known-non-main. Silently hiding unclassified recipes from every suggestion
  surface would make a fresh operator's corpus (or a mid-migration backlog — including the very
  gate-clear this change ships, if a projection ever raced an empty facet row) propose nothing.
- This matches the capability's ethos: transient classify states degrade gracefully
  (`recipe-facet-derivation`, "A transient classify failure does not advance the gate").
- Production data says the choice is currently free: **0 rows** have an empty course, so
  fail-open admits nothing extra today; it only protects future unclassified windows.

The gate-clear migration does **not** create an empty-course window: the classify pass clears
only `body_hash` — stored facet values (and the projected `recipes` columns) stay intact until
each recipe's re-classification overwrites them.

### D4 — The vibe-facet `course` escape hatch

`night_vibes.facets` already accepts a `course` string (`night-vibe-tools.ts`), threaded into
`buildPool`'s `filterRecipes` call. The default main-gate applies **only when the effective
facet set carries no explicit `course`** — a vibe authored as `facets: { course: "breakfast" }`
(breakfast-for-dinner) gates by that course alone, exactly as today. This keeps the default a
default, with the existing knob as the override; no new parameter surface is added.

### D5 — Locks and recipe pins are exempt; empty pools stay explicit

`lock` and `slots[].recipe` are the caller's *explicit* picks — the spec already resolves them
outside the pool gate (case-insensitive, embedded, non-rejected, not excluded) and the same
holds for the course gate: a member who pins fresh-pasta onto a slot gets fresh-pasta. The gate
constrains what the *system* volunteers, never what the caller demands.

A vibe whose pool the gate empties (e.g. a "fresh homemade pasta night" vibe whose nearest
neighbors are all components) follows the existing contract: an **explicit empty slot** with the
existing "no retrievable candidate for this vibe" reason, never silently dropped — with empty
alternates (there are no gate survivors to offer). The caller's escape hatches are exactly the
existing ones: pin a recipe onto the slot, or author the vibe with an explicit `course` facet.
No new reason string or behavior is introduced; the new spec scenario pins that the gate composes
with the existing empty-slot requirement.

### D6 — The `component` course value (classifier prompt + vault suggestions; no validator change)

The course facet is deliberately **open-vocab** (shape-validated only — `vocab.js` documents
why, and `data-validation`'s "Off-convention course value passes" scenario pins it). So adding
`component` is two anchor edits, not a contract change:

- `discovery-classify.ts` `SYSTEM_PROMPT`: the course line's example list gains `component`,
  with a rule sentence — a **sub-recipe / building block** (fresh pasta dough, stock, a spice
  blend, a base sauce made to be used inside other dishes), something not plated as its own
  course; components get `side_search_terms: []` (they are not mains). One new few-shot exemplar
  (a plain pasta dough: flour + eggs → `course: ["component"]`, `protein: null`,
  `side_search_terms: []`, `meal_preppable: true`) anchors it — the spike-established pattern of
  one exemplar per silent-failure class, and the exact shape `spinach-fresh-pasta` must converge
  to.
- `vocab.js` `COURSE_SUGGESTIONS` gains `"component"` so the vault's Tier-B override dropdown
  offers it (regenerated by `build:vault`; CI's `--check` gate).

`sauce` remains a distinct course: a finished sauce someone looks up (`["sauce"]`, 10 in
production) is not a component; the classifier keeps both words and picks the natural one. Both
are equally excluded by the meal gate, so the distinction costs nothing if the model wavers
between them.

### D7 — Re-convergence: the gate-clear migration (the 0040 precedent)

The classify gate hash covers only body + authored Tier-B overrides (`facetGateHash`,
`recipe-classify.ts`) — a prompt change alone re-classifies nothing. The established lever is a
migration that clears the gate so the bounded pass re-derives the corpus organically
(`migrations/d1/0040_ingredients_full.sql`: `UPDATE recipe_facets SET body_hash = NULL;`):

- Idempotent, value-preserving (facet values stay in place until each re-classification lands —
  no empty-course window, D3), override-safe (authored Tier-B overrides win at projection merge
  regardless), bounded (6/tick, quota-aware, wall-clock-budgeted), self-healing.
- ~3 hours to full convergence at production size.

No manual data surgery. If the re-classified `spinach-fresh-pasta` still lands on `main`
(model risk — the exemplar makes this unlikely but not impossible), the sanctioned corrective is
an **authored `course` override** in the vault (a Tier-B human correction that flips the gate
hash and re-classifies conditioned on the override) — an authoring act through the pipeline, not
a D1 edit. The post-deploy acceptance check (tasks §6) verifies which path was needed.

### D8 — Downstream effects, checked

- **Describe pass** (`derived-recipe-metadata`): its content hash covers `course`, so recipes
  whose course flips get re-described on later ticks. Organic and bounded; no action.
- **Side retrieval** (`recipe-sides`/`menu-generation`, `course: "side"`): once `fresh-pasta`
  re-classifies off `side`, it stops surfacing as a plate side — the same defect class fixed by
  the same convergence, free.
- **`side_search_terms` consistency**: the classifier's existing rule (non-empty iff effective
  course includes `main`) plus the new component anchor means the re-derive also heals
  `fresh-pasta`'s stray `["a hearty sauce"]` terms.
- **Member `/api` shapes**: unchanged (the gates drop rows; the row shape and endpoints are
  identical) — no `run_worker_first` entry, no app rebuild required, ETags change naturally with
  content.
- **Embeddings/semantic search**: untouched — the gate filters candidates; vectors and ranking
  are unchanged.

## Acceptance fixture (verified against production after deploy)

1. **At deploy** (gate, no data change): `fresh-pasta` (`["side"]`) and `homemade-pasta-dough`
   (`["baked_good"]`) appear in no `propose_meal_plan` pool/alternates and no
   picked-for-you/trending response.
2. **After convergence** (pipeline, ≈3 h): `spinach-fresh-pasta`'s classified course no longer
   contains `main` (expected `["component"]`), verified by a read-only production SELECT — and it
   thereby leaves every gated surface. No production row is hand-edited at any point.
