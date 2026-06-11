## Context

Roadmap Change 16 originally scoped a `kitchen.toml` purely to stop the `cook` skill asking about equipment every time. This change keeps that, but adds a second, load-bearing job: a **deterministic makeability gate** so recipes a member physically can't make never get suggested.

Two facts shape the whole design:

1. **Two kinds of equipment data, never conflated.** *Gating* equipment (controlled vocab, binary presence — you own a pressure cooker or you don't) vs. *cook-reasoning* equipment (free-text — oven count, pan sizes — that informs parallelization but never makes a dish impossible). Everyone has *some* way to apply heat; pan sizes must never gate.
2. **The error asymmetry is the design's spine.** A false "this is vital" tag *silently hides* a recipe the member could have improvised — an invisible loss, the worst outcome. A missed-but-actually-vital requirement merely lets a recipe surface that the `cook` skill's equipment step will catch. So every judgment biases **conservative**: tag/own nothing you're unsure about; `cook` is the backstop.

Existing patterns this rides on: `protein`/`cuisine` are controlled vocabs validated in `build-indexes.mjs` (off-vocab = hard build fail, absent = fine); `list_recipes` already joins per-tenant `overlay.toml` + cooking-log `last_cooked` onto shared index content at read time; pantry has a read/write tool pair with a structured-error posture.

## Goals / Non-Goals

**Goals:**
- A per-tenant record of owned equipment and a per-recipe record of required equipment, combined into a deterministic subset gate on `list_recipes` (browse + search).
- "Unmakeable recipes never surface" for open-ended browse/suggestion, while an explicit **named** request can still surface (flagged with what's missing).
- The add-recipe path populates `requires_equipment` so the gate has data to act on; onboarding seeds the inventory; `cook` consumes it.
- Zero forced migration: every new field/file is additive with a safe default.

**Non-Goals:**
- Tracking *quantity* or *condition* of equipment (binary presence only for gating; free-text for the rest). No `last_verified_at` churn like pantry.
- Gating on cook-reasoning equipment (oven count, pan sizes) — those inform `cook`, never the filter.
- Auto-detecting equipment from recipe prose at write time. The agent classifies; the schema.org `tool` list is at most a hint.
- A separate search surface. `list_recipes`' `query` param **is** the search; the gate applies to it uniformly.
- Backfilling the existing corpus in this change (lazy, via `update_recipe`, over time).

## Decisions

### D1 — `kitchen.toml` splits `owned` (gates) from `notes` (cook-only)

```toml
# users/alice/kitchen.toml — what Alice owns to cook WITH.
owned = ["pressure-cooker", "blender"]   # EQUIPMENT_VOCAB slugs — these GATE

[notes]                                   # free-text — cook reasons over, gate IGNORES
ovens = 2
toaster_oven = true
free_text = "10-inch cast iron, half-sheet trays"
```

`owned` is a flat array of vocab slugs — the gate reads only this. `notes` is an open table the gate never touches. The structural split (not a convention) guarantees free-text can never accidentally gate. **Alternative considered:** one flat list with a "gates: true/false" flag per item — rejected; it invites mis-flagging and makes the gate read free-text. **Alternative considered:** two separate files (`kitchen.toml` + `equipment.toml`) — rejected as needless; one file, two regions is clearer and matches the single-concept capability.

### D2 — `requires_equipment`: controlled-vocab array, objective shared content, default `[]`

New recipe frontmatter key `requires_equipment: []`. Validated in `build-indexes.mjs` exactly like `protein`/`cuisine`: a value **present but off-vocab** is a hard build failure; **absence** is fine and reads as `[]`. It flows into `_indexes/recipes.json` (objective, shared — like `pairs_with`/`standalone`, not a per-tenant overlay field). Most recipes need nothing vital, so `[]`/absent is the overwhelming common case.

Write-side posture mirrors the precedent: `create_recipe`/`update_recipe` accept `requires_equipment` as a loose array (no Worker-side vocab enforcement), because `list_recipes` only ever reads `_indexes/recipes.json`, which only the build regenerates — so an off-vocab slug can't reach the gate without the build, which fails first. No new write-time validation needed.

### D3 — The gate lives in `list_recipes`, default-on, with an annotated opt-out

`list_recipes` joins the caller's `kitchen.toml` (alongside the overlay + cooking-log joins it already does) and applies the makeability rule:

```
makeable(recipe) ≡ recipe.requires_equipment ⊆ owned

default                        → drop ¬makeable recipes          (browse / suggest)
include_unmakeable: true       → return them, annotated          (named-dish path flags)
                                  missing_equipment: [slugs ∉ owned]
owned empty / kitchen.toml absent → gate is a NO-OP              (unknown ≠ doesn't-own)
```

This reconciles "never surface unmakeable" (the default drop honors it) with "a named request surfaces flagged" (menu-generation's *no silent under-counting* — the named-enumeration path passes `include_unmakeable: true` and the agent surfaces the recipe with a workaround offer). The empty-inventory no-op is what makes a default-on gate safe for un-onboarded members; it works precisely *because* the vocab is small enough that onboarding can fully enumerate it, so a populated `owned` really means "I asked you about all of them." **Alternative considered:** opt-in `makeable_only: true` param — rejected; "never surfaced" then depends on every caller remembering to pass it. **Alternative considered:** silent drop with no opt-out — rejected; it would vanish a named recipe, violating menu-generation guarantees.

### D4 — Add-recipe path classifies under the conservative rubric

The `import-recipe` flow's classification step (step 2 — where the agent already owns `protein`, `cuisine`, `tags`, `meal_preppable`) gains `requires_equipment`. Rubric, stated in the skill:

> **Default to `[]`.** Tag a vocab item only when the dish is genuinely *impossible* without it — no recipe-preserving workaround. The schema.org `tool` list and the instruction prose are **hints, never the verdict** (they list every utensil — bowls, whisks, knives — which are not vital and not in the vocab). When unsure, leave it out: the `cook` skill catches a missed requirement; a wrong "vital" tag silently hides a makeable recipe.

`import_recipe(url)` optionally adds the parsed schema.org `tool` array to its return as `tools_hint` — surfaced to the classifying agent, explicitly non-authoritative. `update_recipe` is the path to set/correct `requires_equipment` on an existing recipe (the lazy backfill path). Side-dish bootstrap inherits classification free, since `pairs_with` sides go through the same `create_recipe` pipeline.

### D5 — `read_kitchen` / `update_kitchen`, parallel to pantry

Two new tools mirroring the pantry pair's shape and structured-error posture. `read_kitchen()` → `{ owned: [...], notes: {...} }`. `update_kitchen(operations)` applies add/remove of `owned` slugs and sets `notes` fields, agent-editable on user direction (same posture as `update_pantry`). `update_kitchen` is what onboarding's checklist and ad-hoc "I got an Instant Pot" messages both write through. Off-vocab `owned` slugs surface a structured conflict rather than being silently written (so the inventory stays vocab-clean even though recipe write-side is loose — the inventory is the gate's left operand and is worth keeping honest at the tool boundary).

### D6 — Starter `EQUIPMENT_VOCAB` (settled: Core 4)

Curated by the single test: *no recipe-preserving workaround exists.* Deliberately minimal; doubles as the onboarding checklist. **Settled during apply on the "Core 4":**

| slug | vital because |
|---|---|
| `pressure-cooker` | for *fundamentally*-pressure dishes (true pressure-canning/quick pressure braises) — **not** "faster than stovetop" recipes, which are makeable without it and stay `[]` |
| `sous-vide-circulator` | precise low-temp water-bath cooking has no substitute (the disambiguated "immersion-cooker") |
| `blender` | a blended/emulsified/puréed result with no hand path — covers both countertop and stick (immersion) blender; not split, since a recipe needing a smooth blend can use either |
| `ice-cream-maker` | churned ice cream / gelato — no workaround |

Explicitly **excluded** (replaceable → never gate, and considered but cut from the starter set): `immersion-blender` (folded into `blender`), `food-processor` (most "use a food processor" steps are knife- or blender-replaceable), stand mixer (hands/hand-mixer), wok (skillet), dutch oven (any heavy pot), deep-fryer (pot + thermometer), grill, smoker. Any of these can be added later if a real recipe proves a true no-workaround case, but the bias is to keep the list short. Extending the vocab is a deliberate edit to `EQUIPMENT_VOCAB` (same ceremony as extending the cuisine set).

### D7 — Onboarding adds a finite checklist area

`configure-grocery-profile` gains a sixth area after heat-and-eat: walk the `EQUIPMENT_VOCAB` as a short checklist ("Do you have any of these: pressure cooker, sous vide, blender, …?"), writing answers via `update_kitchen`. Skippable like the rest — and skipping leaves `owned` empty, which (D3) makes the gate a no-op, so skipping degrades gracefully to today's behavior. The `notes` region is *not* interrogated at onboarding (oven count etc. surface naturally during `cook`); onboarding seeds only the gating `owned` list.

## Risks / Trade-offs

- **Over-tagging silently hides makeable recipes.** → The conservative rubric (D4) + the controlled vocab (only truly-irreplaceable slugs exist to tag) + `cook` as backstop. The vocab being short *limits the blast radius* — you can't over-tag with gear that isn't in the list.
- **Incomplete onboarding under-populates `owned`, hiding recipes the member actually can make.** → The vocab is short enough to fully enumerate in one checklist; and the empty→no-op rule means partial/skipped onboarding errs toward *showing more*, not less. A member can always `update_kitchen` later.
- **Existing corpus has no `requires_equipment`, so genuinely-gated dishes under-gate until backfilled.** → Accepted: under-gating only means a recipe surfaces that `cook` will catch; lazy backfill via `update_recipe`, no migration blocking this change.
- **schema.org `tool` is noisy and tempting to trust.** → It's surfaced as `tools_hint` only, with the rubric explicitly subordinating it to agent judgment; it never writes `requires_equipment` directly.
- **`immersion-cooker` ambiguity** (circulator vs. stick blender) → resolved by two distinct slugs (`sous-vide-circulator`, `immersion-blender`) in D6.

## Migration Plan

1. Land `EQUIPMENT_VOCAB` + validation + index field in `build-indexes.mjs` (absent `requires_equipment` → `[]`; existing corpus validates unchanged).
2. Land `read_kitchen`/`update_kitchen` + the `list_recipes` kitchen-join/gate/`include_unmakeable` in the Worker; deploy via the data-repo `deploy.yml`.
3. Update `import-recipe`, `configure-grocery-profile`, `cook` in `AGENT_INSTRUCTIONS.md`; rebuild the plugin.
4. Update `docs/SCHEMAS.md` + `docs/TOOLS.md` in the same pass.
5. Backfill `requires_equipment` on the few existing recipes that need vital gear, opportunistically via `update_recipe` — not gating on it.

**Rollback:** the gate is inert without `kitchen.toml` data; removing/ignoring `owned` reverts to today's unfiltered behavior with no data loss.

## Open Questions

- ~~Final `EQUIPMENT_VOCAB` membership~~ — settled on the **Core 4** (D6).
- Whether `update_kitchen` should reject off-vocab `owned` slugs hard (D5's structured conflict) or coerce/suggest the nearest vocab slug — leaning reject-with-suggestion, settle in apply.
