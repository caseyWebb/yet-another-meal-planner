## Context

The menu-generation flow builds a weekly proposal from mains — recipe-seeded or open-ended — runs a pantry pre-pass, gathers pricing/availability context in parallel, and captures to-buy items + `[[planned]]` rows on agreement. Nothing in that flow considers a *side*. A grilled-protein or pasta night lands on the plan with no starch, vegetable, salad, or bread beside it.

The recipe schema already models two kinds of inter-recipe edges — `uses_components` / `produces_components` — as validated slug arrays (`scripts/build-indexes.mjs` ~L171–181, with reference resolution as a hard-fail in `data-validation`). Those are **production** edges ("this dish consumes that dish's output," surfaced by the future `suggest_sequencing`). A side pairing is a different relation: a **plating** edge ("these are eaten together on one plate"). The plumbing is identical; the semantics are not.

This change was explored and its key decisions locked before drafting (see below). It is intentionally lazy: no upfront pairing table, no corpus backfill.

## Goals / Non-Goals

**Goals:**
- The planner rounds out the plate: for a main that isn't already a complete meal, it surfaces or sources a side and folds that side's ingredients into the same pantry pass, pricing batch, and capture.
- Good pairings become durable, shared **memory** (`pairs_with`) that accretes as the user plans — never a hand-curated upfront table.
- The "is this already a rounded plate?" judgment is cheap: inferred at plan time, optionally persisted (`standalone`), never required.
- Reuse the entire existing side-as-recipe pipeline (verify → import → draft → capture). No new tool, no new data file.

**Non-Goals:**
- Drinks, wine, and dessert pairings (deferred — keep the field generic so they can be added later without a schema change).
- A reverse `paired_by` index in `_indexes/` (an edge is read from the main; no reverse lookup is needed for the planner).
- Backfilling `pairs_with` or `standalone` across the existing corpus.
- Any change to `meal_plan.toml` mechanics — a side is just another planned recipe.
- The future `suggest_sequencing` / component-pairing work (Change 13) — orthogonal.

## Decisions

### D1 — `pairs_with` holds recipe slugs only (a plating edge)

`pairs_with: [slug, ...]` is objective shared content on the main. Each slug is a real corpus recipe.

- **Why slugs over free text:** a side that's a real recipe flows through `verify_pantry_for_recipe`, `import_recipe`/`create_recipe`, draft disposition, and ingredient → pantry → grocery-list capture **with no new code**. Free text ("a simple green salad") would force the agent to re-derive ingredients ad hoc every plan and would never become reusable inventory for the group.
- **Why distinct from `uses_components` — but complementary:** components is a *production dependency* (make a thing once, reuse its output across dishes); `pairs_with` is *plating companionship* (eat these together tonight). They are different edges and must not be conflated — conflating them would corrupt the component graph `suggest_sequencing` reads — but they are **complementary and routinely co-exist on the same node.** Canonical case: a `steamed-rice` recipe is both a `pairs_with` side of a curry/stir-fry *and* the `produces_components: [cooked-rice]` source that fried-rice/stir-fry recipes `uses_components: [cooked-rice]` to drive batch/sequencing suggestions (the seed `suggest_sequencing` reads in Change 13). One answers "what completes this plate tonight?" (this change); the other answers "what do I batch once and reuse all week?" — a *bidirectional* producer⇄consumer suggestion that is `suggest_sequencing`'s job (Change 13), not this change's. This change adds the `pairs_with` edge and never traverses the component graph.
- **A side-as-recipe is a feature, not a tax:** because a side is a real recipe, it inherits far more than the ingredient pipeline — it carries `time_total`/`time_active` and equipment-specific body instructions (pressure-cooker vs stovetop) that the **cook skill** uses to pace the cook, it can be rated / noted / marked `meal_preppable`, and it joins the component graph above. So-called "trivial" sides (steamed rice, dressed greens) are exactly the nodes the rest of the system already wants to exist. The agent can still suggest a truly throwaway side conversationally without persisting an edge; but when a side is worth *remembering*, being a recipe is precisely what makes it useful.
- **Alternative rejected — free-text or a slug-or-text union:** more expressive, but every consumer of the field (validation, pantry walk, capture) would need to branch on the variant, and the ingredient flow would fragment. Not worth it for v1.

### D2 — `standalone` is an optional boolean gate, inferred-then-offered

`standalone` is an optional objective boolean. **Unset by default; never backfilled.**

- When `standalone: true`, the planner does not prompt for a side.
- When **unset**, the agent infers at plan time whether the dish is already a rounded plate (a one-pot chili, a composed grain bowl, a sheet-pan protein-plus-veg) and, if it concludes the dish stands alone, *offers* to persist `standalone: true` — the same learn-and-offer pattern used when the agent proposes an `aliases.toml` entry. It never writes the flag silently.
- **Why not derive it from `style`/`veg_forward`:** unreliable. A one-pot risotto wants a salad; a `veg_forward` salad is a rounded lunch but a thin dinner. The judgment is semantic, so it's stored when known and inferred when not.
- **Why optional/unset rather than a default:** defaulting `false` would make every legacy recipe prompt for a side (noise); defaulting `true` would defeat the feature. "Unset → infer" sidesteps both and needs no migration.
- **Alternative rejected — a richer `plate: complete | needs_starch | needs_veg | needs_side` enum:** it would make the bootstrap search smarter and tie into the "more veg" diet principle, but it adds curation burden and validation surface for marginal v1 value. The agent can reason about *what kind* of side from the main's body at plan time. Revisit if plate-rounding proves too coarse.

### D3 — `pairs_with` is grown by a bootstrap flow, not authored upfront

The edge starts empty and accretes. When a non-`standalone` main has an empty `pairs_with`, the bootstrap runs at plan time:

1. **Search, cheapest source first:** existing corpus recipes that work as sides (via `list_recipes`) → the RSS discovery pool (`fetch_rss_discoveries`) → web import (`import_recipe`).
2. **Propose 1–2** candidate sides in chat (savory plate-rounding only: starch / veg / salad / bread).
3. **On acceptance:** if the side isn't already a recipe, import it as a `status: draft` recipe (the existing discovery path); then record the edge with a plain `update_recipe` adding the side's slug to the main's `pairs_with`.

Next time that main is planned, `pairs_with` is already populated, so the planner just *surfaces* the remembered side(s) instead of bootstrapping again. The edge is shared, so the whole friend group benefits from one member's rounding.

**Scope seam with Change 13 — plate pairing is not component sequencing.** This change is deliberately confined to `pairs_with`, a *spatial* relation (what's on the plate together tonight). The bootstrap selects sides by **plate fit** and does **not** read or reason over the `produces_components` / `uses_components` graph, which is a *temporal* relation (cook a component once, reuse its output across the week). Component-based suggestion is **bidirectional** — a producer suggests consumers and a consumer suggests producers — and belongs entirely to `suggest_sequencing` (Change 13), along with its component-vocabulary seeding. The two compose cleanly: a side like `steamed-rice` can be both a `pairs_with` companion *and*, separately, a `produces_components: [cooked-rice]` node that Change 13 later exploits in both directions. But that coupling is intentionally not wired here — selecting a side by a graph edge would conflate the spatial and temporal relations and leak Change 13's concern into this one.

### D4 — No new tool; `update_recipe` already persists it

`pairs_with` and `standalone` are objective frontmatter. `update_recipe` merges arbitrary objective keys into shared content; `splitRecipeUpdate` peels only `rating`/`status` to the per-tenant overlay. So recording an edge or persisting the gate is an ordinary objective edit. The only worker-side check is that the structural write-time validation subset doesn't reject the two new keys.

### D5 — Flow placement: round the plate *before* the parallel context batch

In the menu-generation pre-pass, the side step slots in **after mains are tentatively chosen but before the parallel `kroger_flyer` / `kroger_prices` / availability batch** — because pricing must see the side's ingredients too. Sequence:

```
pick mains
  └─ for each non-standalone main:
        pairs_with populated?  ── yes ─▶ surface remembered side(s), let user pick
                               └─ no  ─▶ bootstrap (search → propose → import draft + record edge)
  └─ fold chosen sides into the pantry pre-pass (verify_pantry_for_recipe on the side too)
        ▼
parallel context batch (now sees mains' + sides' ingredients)
        ▼
assemble proposal ▶ agree ▶ capture: to-buy items + [[planned]] rows for mains AND sides,
                                       + any new pairs_with edges + side drafts, in one commit
```

A chosen side is a recipe, so it earns its own `[[planned]]` row — no change to `meal_plan.toml` mechanics. The variety/retrospective reasoning is unchanged; sides are nutritional plate-rounding, not a new variety axis.

### D6 — Validation mirrors the component-edge rules

In `build-indexes.mjs`: each `pairs_with` slug must resolve to a real recipe (hard-fail when it can't, exactly as an unresolved `uses_components`/`produces_components` reference fails today). `standalone`, when present, must be a boolean (hard-fail otherwise, consistent with how malformed enum/type values fail). Both fields absent → no warning (they are optional, like the component arrays). Both flow through into `_indexes/recipes.json` via the existing objective-frontmatter passthrough — verify the passthrough carries them rather than special-casing.

## Risks / Trade-offs

- **[Sides enter as draft recipes]** Bootstrapped sides land as `status: draft` and accrete as files. This is reinforcing, not bloat (see D1): a side-as-recipe plugs into the component graph for batch/sequencing and gives the cook skill its pacing metadata, and is only persisted when the user accepts the pairing — truly throwaway sides stay conversational. A side surfacing in `list_recipes` (e.g. `steamed-rice` on a search for `rice`) is correct, not pollution: it is a real recipe that should be findable, and the agent reasons over the returned set rather than proposing plain rice as a main. → No mitigation needed; this is the intended shape.
- **[Bootstrap latency in the flow]** Searching/importing a side mid-plan adds a round-trip before the pricing batch. → The bootstrap only fires for non-`standalone` mains with an *empty* edge; once memory accretes it's a no-op. Cap proposals at 1–2 candidates.
- **[Symmetric-pairing temptation]** One might expect cornbread to point back at chili. → `pairs_with` is read from the main only; no reverse edge or `paired_by` index. Symmetry isn't needed for the planner and would double the write/validation surface.
- **[`standalone` inference is a judgment call]** The agent may misjudge a borderline dish (a hearty soup) as standalone. → It's a *soft* gate that's offered, not enforced; the user can decline persistence or ask for a side anyway. No hard behavior hangs on it.
- **[Scope creep to drinks/dessert]** A generic slug edge invites "pair a wine." → Explicitly out of scope; the persona text constrains `pairs_with` to savory plate-rounding sides for this change.
