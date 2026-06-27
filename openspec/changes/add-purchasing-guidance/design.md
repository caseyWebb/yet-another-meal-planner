## Context

The guidance system already has everything this change needs *structurally*. The `add-cooking-techniques-guidance` change generalized the storage corpus into a `guidance/<domain>/` umbrella with a generic tool trio (`list_guidance` / `read_guidance` / `save_guidance`), domain validation against a controlled vocabulary, and a **writable-domain allowlist** — explicitly so a new domain is a vocabulary entry, not new machinery. Two domains exist today:

- `guidance/ingredient_storage/` — **read-only** (off the writable allowlist), curated, keyed by storage *behavior class*, surfaced at **put-away** (the `received` end of `shop-groceries` and the market-haul `update_pantry`).
- `guidance/cooking_techniques/` — **agent-writable**, keyed by *technique* slug, accreted from member-posted articles, surfaced at **cook** time.

What has no home is *buy-side* knowledge. The tell is already in the data: `canned-tomatoes.md` lives in `cooking_techniques`, but every word ("read the ingredient list, not the front of the can; no calcium chloride for sauce") is spent the moment you reach the shelf — at the stove it's inert, the can is already bought. Guidance is **moment-anchored**, and the **SHOP** moment is the gap. Members read buying guides (ATK taste tests, Serious Eats) they want surfaced *in the aisle*; the canonical asks are "what kind of X should I get" and the occasional non-obvious "how do I tell if Y is ripe."

## Goals / Non-Goals

**Goals:**
- A shared, **agent-writable** `purchasing` domain keyed by **product/item slug**, holding "what kind of X" selection wisdom plus the few non-obvious ripeness/quality judgments — captured from member-supplied buying guides.
- Reuse the existing generic tool trio unchanged; the only Worker change is extending `GUIDANCE_DOMAINS` and `WRITABLE_DOMAINS` (plus the domain enumeration in the tool descriptions).
- Surface at **SHOP** time inside `shop-groceries`: per-aisle tips on the in-store walk; a single manual-swap callout on the online flush.
- Re-home the misfiled `canned-tomatoes.md` and seed one more worked example (`olive-oil.md`).
- Inherit `ingredient_storage`'s anti-folklore hedge on top of the writable posture.

**Non-Goals:**
- **No SKU-match influence and no auto-`preferences.brands` write in v1.** Online stays a narration-only "check the cart and swap" callout. Feeding `match_ingredient_to_kroger_sku` and hardening a settled choice into a `brands` entry are a deliberate **future arc** (see Decisions D5 / the brands relationship).
- **No produce seasonality** — well understood, fails the phone-out gate.
- No new tool, no D1 table (GitHub-hosted curated markdown like the other domains), no ingredient→entry manifest (world-knowledge mapping, like storage and techniques).
- No relational `_`-prefixed cross-entry file — purchasing is naturally flat per-item (there's no "don't buy together" rule, unlike storage's `_ethylene`).
- No exhaustive produce corpus — the inclusion gate keeps it to the non-obvious few, grown from real use.

## Decisions

### D1. A third domain, not a new capability or tool surface
Add `purchasing` to the `GUIDANCE_DOMAINS` vocabulary and the `WRITABLE_DOMAINS` allowlist in `src/guidance.ts`; extend the domain enumeration carried in the `list_guidance` / `read_guidance` / `save_guidance` tool descriptions. No new tool is registered.

- *Why:* the `guidance/<domain>/` umbrella was built for exactly this — collapsing two near-identical corpora behind one extensible surface so the next domain is cheap.
- *Alternatives:* a bespoke `purchasing`-specific read/write pair — rejected as duplicative of the generic surface (the same reasoning that unified the storage tools).
- *Consequence:* the requirements that enumerate the vocabulary and the writable allowlist live in the `cooking-techniques` capability (it owns the generic surface), so they are MODIFIED there even though `purchasing` is not a cooking technique. Splitting the umbrella into its own capability is a larger refactor, out of scope.

### D2. Writable like techniques, hedged like storage
The corpus is **agent-writable** with no extra gate (the `cooking_techniques` posture — the member accretes it from articles, the exact `canned-tomatoes` origin). But it **inherits** `ingredient_storage`'s anti-folklore discipline: contested tips are pre-hedged in prose, and the agent gives **no** tip for an item with no entry rather than improvising.

- *Why:* buying advice — ripeness especially — is folklore-dense (thump the melon, smell the stem). The write posture and the hedge posture are orthogonal; this domain wants one of each.

### D3. Key by product/item slug, not behavior class
Files are `canned-tomatoes.md`, `olive-oil.md`, `pineapple.md`. A few natural *classes* are allowed where the knowledge genuinely generalizes (`stone-fruit.md`), but the default unit is the item. Mapping a list item → entry is the agent's world-knowledge job over the slugs `list_guidance` returns — no manifest.

- *Why:* selection knowledge is item-specific (San Marzano logic doesn't transfer to olive oil), unlike storage, where one rule covers a whole behavior family (tender-herbs). This mirrors `cooking_techniques`' one-file-per-thing shape more than storage's one-file-per-class.

### D4. Inclusion gate: "would you pull your phone out for it in the aisle?"
An entry earns its place only when the knowledge is **non-obvious enough to consult standing at the shelf** — the buy-side analogue of storage's "skip the obvious (keep milk cold)." This self-limits the corpus without a rulebook.

- *Why:* keeps the corpus high-value and bounded. Ripeness is admitted *through this gate*, not as a separate pillar: "how to pick a pineapple / a melon" clears it; "is this banana brown" does not. Seasonality is excluded — well understood.

### D5. Surface at SHOP, both branches, asymmetric
`shop-groceries` is the home — the trip's **front** bookend, mirroring storage at the `received` **back** bookend.
- **In-store walk:** map list items → purchasing entries by world-knowledge, `read_guidance` the few that fit, and weave a couple of non-obvious selection/ripeness tips in **as the relevant aisle is reached** — capped like storage's 2–3, never a recital.
- **Online (Kroger) flush:** a single consolidated "eyeball these in the cart and swap manually" callout. **Narration only.**

- *Why the asymmetry:* ripeness/selection is an in-hand, at-the-shelf act; you can't squeeze an avocado through Kroger delivery, and biasing the SKU match would cross the determinism boundary (the matcher is plain deterministic code). Keeping online as narration honors that boundary and defers the influence to a future arc.

### D6. Capture skill, disambiguated from its siblings
A new skill (sibling of `save-technique`): the member posts a buying guide / taste test / their own distillation; the agent reads any existing entry, **merges** (one memory per item — refine, don't append), distills to "what to actually grab," and persists via `save_guidance("purchasing", …)` with `source`. Its description **must** route cleanly against its siblings:

```
  a "best olive oil" taste test     → purchasing      (surfaced at SHOP)
  a "how to sear" technique piece    → cooking_techniques (surfaced at COOK)
  "I'd cut the sugar in THIS recipe" → recipe-note      (one recipe)
```

- *Why:* the skill family now has three article-capture-ish flows; without crisp routing in the descriptions the agent will misfile (exactly how `canned-tomatoes` landed in techniques).

### Relationship to `preferences.brands` (deliberately kept separate in v1)
A settled "which product" answer already has a deterministic home: `preferences.brands` ("always the Cobram olive oil"), fed into ordering. Purchasing guidance is the **reasoning** ("*why* no calcium chloride"); a `brands` entry is the **answer**. They are complementary, not redundant, and v1 keeps them independent — no auto-sync. "Guidance hardening into a `brands` preference" is the same future arc as SKU influence, named here so the line stays clear.

## Risks / Trade-offs

- **Online surfacing can't act on the cart** → narration-only callout; accept the manual swap for v1; SKU influence is the named future arc, not a silent omission.
- **Folklore creep in a writable produce corpus** → the hedge requirement + the phone-out gate + "no entry → silence," the same restraint storage enforces, carried in prose and spec.
- **Domain-boundary blur** (is a tip "technique" or "purchasing"? "storage" or "purchasing"?) → the **moment-anchored** rule decides: file by *where the knowledge is actionable* — shelf → purchasing, put-away → storage, stove → technique. An item legitimately appears in several domains (avocado: *pick* it = purchasing, *hold/ripen* it = storage), one entry per moment.
- **Over-surfacing on a big produce trip** → cap to ~2–3 non-obvious, mirroring storage; a light, occasional touch, not every aisle.
- **MODIFYing the `cooking-techniques` capability to admit a non-cooking domain reads oddly** → it's where the generic umbrella + allowlist are specified; the cleaner split (a standalone guidance-infra capability) is out of scope and noted as such.
- **Re-home transient** → until the Worker ships `purchasing`, `canned-tomatoes` still reads from `cooking_techniques` and could surface at the wrong moment (cook); after the data `git mv` but before the Worker knows the domain, `guidance/purchasing/` reads as an empty tree (absent-tree-is-empty, no hard error). Both are harmless; land the Worker change and the data move close in time.

## Migration Plan

1. **Worker + persona (this repo):** add `purchasing` to `GUIDANCE_DOMAINS` + `WRITABLE_DOMAINS`; extend the tool-description domain enumeration; extend `test/guidance.test.ts`; update `docs/SCHEMAS.md` / `docs/TOOLS.md` / `docs/ARCHITECTURE.md` in the same pass; add the capture skill and the `shop-groceries` surfacing to `AGENT_INSTRUCTIONS.md`; `aubr build:plugin`.
2. **Data repos** (`groceries-agent-data`, `groceries-agent-data-template`): `git mv guidance/cooking_techniques/canned-tomatoes.md guidance/purchasing/canned-tomatoes.md`; seed `guidance/purchasing/olive-oil.md`; update READMEs.
3. **Merge to `main`:** CI auto-dispatches the data-repo deploy (a `src/**` change). **No D1 migration** (no schema change).
4. **Rollback:** revert the Worker commit (`purchasing` drops from the vocabulary; the corpus becomes unread) and revert the data `git mv` (restores `canned-tomatoes` to `cooking_techniques`). No data loss — the move is content-preserving and the corpus is just markdown.

## Open Questions

- **Skill name** — `save-purchasing-note`? `internalize-buying-guide`? `save-buying-guide`? Lean: something that reads parallel to `save-technique` and signals *buying guide*. Resolve at apply.
- **In-store fire point** — at the whole-list display (step 6, for the department/unmapped view) or per-aisle during the voice walk (step 7), or both? Lean: both — surface relevant tips when the list is shown and weave them per-aisle on the mapped walk. Resolve in the persona/spec.
- **Seed set beyond `canned-tomatoes` + `olive-oil`** — ship more worked examples or grow from real use? Lean: ship those two (one re-homed, one new), grow from use — matching the `cooking_techniques` "ship `browning-meat` only" call.
