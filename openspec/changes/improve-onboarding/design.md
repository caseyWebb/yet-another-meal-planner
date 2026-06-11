## Context

`configure-grocery-profile` is an idempotent skill generated from `AGENT_INSTRUCTIONS.md`. It captures six areas (taste, cooking preferences, diet principles, pantry, ready-to-eat, equipment) through existing write tools and "defines no new MCP tool of its own."

Two facts about the multi-tenant model (verified in code) make a freshly-onboarded member's agent non-functional:

- **Per-tenant recipe status.** `mergeOverlay` resolves `status = overlay.status ?? frontmatter.status ?? "draft"` (`src/overlay.ts`). A new member has an empty `overlay.toml`, so every shared recipe is effective-draft for them. `filterRecipes` defaults `wantStatus` to `"active"` (`src/recipes.ts`), so `list_recipes()` returns `[]` until the member dispositions recipes one at a time.
- **Required store location.** `getLocationId()` reads `preferences.toml [stores].preferred_location` and throws `not_found` ("no preferred store location is set") when absent (`src/tools.ts`); `resolveLocationId` only needs a 5-digit ZIP from the label (`src/kroger.ts`). Onboarding never captures it, so the first `kroger_prices` / `place_order` throws.

The bulk-promotion mechanism already exists: `commit_changes` partitions `recipe_updates` and routes `status`/`rating` to the caller's overlay in one commit via `buildOverlayUpdate` (a Map of slug→edit). Adjacent gaps: `stockup.toml` and `feeds.toml` are read by the Worker but have **no write tool**, and the agent has no knowledge of the hosted recipe-site URL.

## Goals / Non-Goals

**Goals:**
- A member who completes onboarding can immediately get a priced menu — both cold-start blockers closed.
- A new member starts with a usable personal corpus (a curated active set) and a path to opt into the rest.
- First-run inventory is thorough (incl. the spice drawer) and voice-friendly; the watchlist and discovery sources are seeded so sale/discovery features work.
- Onboarding is per-area resumable — interrupted setup loses nothing and re-running doesn't re-do completed areas.

**Non-Goals:**
- No change to the recipe status model, the overlay schema, or `last_cooked` derivation.
- No change to Kroger cart/order behavior, the matching pipeline, or stockup's role in sale-checking (price thresholds stay advisory, not gates).
- No removal/edit semantics for the new `update_stockup` / `update_feeds` tools — add-only with dedup in v1.
- No new RSS/HTML parsing or external dependency; the new tools reuse existing TOML serialize/commit plumbing.

## Decisions

### D1 — Corpus bootstrap by promoting a curated set to `active` (not by relaxing the menu filter)

The skill curates a soft-capped (~12–18) set of shared recipes that fit the just-captured taste/diet and pass the equipment makeability gate, presents them for confirmation, and bulk-promotes the confirmed set to `active` via one `commit_changes` `recipe_updates` call (`{slug, updates:{status:"active"}}` each, routed to the overlay).

- **Alternative A — first menu uses `status:"all"`:** rejected. It contradicts the draft model ("drafts don't clutter proposals"), surfaces unvetted recipes every plan, and never actually builds the member's corpus.
- **Alternative B — do nothing / disposition one at a time:** rejected. That's the status quo that leaves the corpus dark; one-by-one is too tedious to bootstrap a working set.
- **Curation is LLM-judged, not a hard query.** `taste.md` is a free narrative, so the agent maps it to `list_recipes` filters (cuisine/protein/dietary) by judgment. The soft cap is guidance, not an enforced limit. Promotion to `active` with no `rating` is the correct "willing to cook, haven't yet" state; rating attaches later when cooked.

### D2 — Reachability of the full corpus via the hosted recipe site, resolved at runtime

To honor "list everything so a member can opt into any one," the skill points to the **hosted GitHub Pages recipe site** rather than dumping hundreds of titles into chat. A member browses there and names anything they want activated.

The site URL is resolved **at runtime by the Worker**, via a new `recipe_site_url` tool that calls the GitHub Pages API (`GET /repos/{owner}/{repo}/pages`) with the existing GitHub App token and returns `{ url, enabled }`.

- **Alternative A — bake the URL at plugin-build** (`--site-url` / `$GROCERY_SITE_URL`, mirroring the connector URL): rejected. It's static (can't reflect a custom domain unless the operator re-bakes), needs per-operator build config, and can't tell whether Pages is actually live.
- **Alternative B — construct `https://<owner>.github.io/<repo>/`** from the wrangler vars: rejected. Zero-config, but **wrong the moment a custom domain is used** (the operator uses custom domains here), and it can't detect a disabled/absent site.
- **Chosen — query the Pages API.** Always correct (the API returns the real `html_url`, custom domain and all), needs no per-operator build config, and a 404 becomes real `enabled: false` data so the agent's "ask your admin to enable Pages" is a checkable fact, not a hedge. Cost: the GitHub App needs the **`Pages: read`** permission (a one-time operator grant); a 403 maps to a structured `insufficient_permission` error the agent relays. Pages is a repo-level property, so the tool reads the shared data repo.

### D3 — Store capture is ZIP-only

The setup area asks only for a ZIP and writes it into `preferences.toml [stores]` (`primary = "Kroger"`, `preferred_location` as `"Kroger - <zip>"`, matching the schema example) via `update_preferences`. The resolver only needs the 5-digit ZIP from the label. Brand defaults are **not** prompted at onboarding — they emerge during ordering, where the existing tri-state `[brands]` flow already handles them.

**`update_preferences` overwrites the whole file** (it takes a single verbatim `content` string; it does not merge). Since preferences are captured across two areas (store ZIP up front, `default_cooking_nights` / `lunch_strategy` later), the flow MUST construct the **complete** `preferences.toml` content on each write — read the current file (or carry an in-memory copy) and include every previously-captured field — so the later cooking-prefs write does not clobber the store ZIP. Equivalently, `commit_changes` `config_updates` also carries verbatim full content. The markdown-file writers (`update_taste`, `update_diet_principles`) are single-narrative whole-file writes, so they have no such merge concern.

### D9 — A new member's profile reads throw `not_found`, not empty

`read_preferences`, `read_pantry`, `read_taste`, and `read_diet_principles` throw a structured `not_found` when their backing file is absent (only `read_kitchen`, `overlay`, `ready_to_eat`, and `stockup` reads degrade to empty). So the skill's opening readback over a brand-new member yields four `not_found` errors. The flow SHALL interpret a `not_found` from a profile read as "that area is empty / not yet set up" — the first-run signal for per-area resumption (D6) — and SHALL NOT treat it as a tool failure or trip the `report-grocery-agent-bug` reflex. This is the concrete mechanism behind "check the area's own backing file."

### D4 — `update_stockup` and `update_feeds` as add-only mirrors of `update_discovery_sources`

Both new tools clone the proven shape: read existing file → pure dedup-merge helper → `stringifyTomlWithHeader` → `commitFiles`. Each returns `{ added, commit_sha }` and is a no-op (no commit) when nothing new is added.

- `update_stockup` is **per-tenant** (writes the caller's `users/<id>/stockup.toml` via the prefixed client, like `update_pantry`), belongs to `data-write-tools`, and dedups items by normalized `name`. Input fields: `name` (required), `unit?`, `typical_purchase?`, `notes?`, and optional `baseline_price?` / `buy_at_or_below?` (accepted but never prompted at onboarding); plus an optional top-level `freezer_capacity_estimate`.
- `update_feeds` is **shared** (writes the data-repo-root `feeds.toml` via the shared client, like `update_discovery_sources`), belongs to `recipe-discovery`, and dedups feeds by canonicalized `url`. Input fields per feed: `url` (required), `name?`, `weight?` (default 1), `tags?`.
- **Add-only in v1.** Removal/edit is a rare hand-edit until a future change; this matches `update_discovery_sources` and keeps the surface minimal.

### D5 — Stockup price thresholds stay advisory (no model change)

`kroger_flyer(against_stockup)` only pushes stockup item **names** into the scan terms; it never reads `buy_at_or_below` / `baseline_price`. The only numeric gate is the universal "≥5% off" discount filter. So "is this sale good enough?" is already the agent reasoning over the live flyer price. Onboarding therefore captures items + `typical_purchase` + `freezer_capacity_estimate` and leaves the price fields optional/unprompted; `SCHEMAS.md` is clarified to say so. No change to the sale-check or menu-gen stockup behavior.

### D6 — Per-area resumability replaces a global first-run flag

Each setup area reads its own file and acts on emptiness independently: skip taste if `taste.md` exists, skip the corpus bootstrap if the overlay already has `active` rows, skip equipment if `kitchen.toml owned` is non-empty, etc. This makes the skill naturally resumable (consistent with "persist each piece as gathered") and collapses "first-run vs returning" into the same code path — the returning-member readback is just every area reporting "already set, change anything?".

### D7 — Flow ordering follows the dependency graph

```
ZIP → taste → diet → equipment → STARTER CORPUS → thorough INVENTORY (spices, voice)
    → stockup (optional) → ready-to-eat (optional) → "first menu?" handoff
```

Store-ZIP first (unblocks pricing for everything downstream). Taste/diet/equipment precede the corpus step because they are its inputs — equipment in particular seeds the makeability gate so the curated set only surfaces makeable recipes. Corpus precedes the long inventory walk to front-load the payoff ("here's your collection, the agent works now") before the chore. The handoff to `meal-plan` is now safe to offer.

### D8 — Ready-to-eat items are cross-recorded between the catalog and pantry stock

RTE items live in two files by design: `ready_to_eat.toml` is the **options** catalog (meal-tagged, no stock), and `pantry.toml` carries their **on-hand stock** (the cooked flow decrements pantry on RTE consumption; menu-gen's restock suggestion matches `ready_to_eat_favorites` against pantry on-hand). There is no structural FK — the match is **by name**, agent-side — and no existing flow keeps the two in sync. So onboarding wires them together: the inventory area offers to catalog RTE items it hears about (in addition to recording pantry stock), and the heat-and-eat area records on-hand stock for items the member already has. Both use a consistent name so the restock cross-reference matches; both are **offers**, not silent auto-adds. No new tool — `update_pantry` + `add_draft_ready_to_eat` already exist; this is the missing flow wiring.

- **Alternative — a structural link (an RTE pantry category, or a stock field on the catalog):** rejected for this change. It would duplicate the established two-file split and ripple into the cooked/menu-gen flows; the name-based agent reasoning already works once both sides are recorded.
- **Two capture points, two spec homes.** The onboarding capture points (inventory area + heat-and-eat acceptance area) are onboarding-specific UX and live in `guided-onboarding`. The same situation arises in the **standalone `update_pantry` flow** (e.g. "just stocked the freezer with frozen dinners"), which has no dedicated capability spec — its behavior is realized in `AGENT_INSTRUCTIONS.md`. The RTE-on-hand-in-pantry invariant is canonically owned by `cooking-history` (consumption *decrements* pantry stock), so the capture-side mirror (acquisition *records* pantry stock + offers to catalog) is added there as the sibling of that invariant, covering the non-onboarding path.

## Risks / Trade-offs

- **[Sparse/empty corpus for the first member]** → the corpus step degrades to discovery-source seeding: ask for newsletter senders (`update_discovery_sources`), RSS feeds (`update_feeds`), and specific recipes/URLs to import (`import_recipe`), and say the corpus grows through use. No promotion happens when there's nothing to promote.
- **[Over-promoting recipes a member won't cook]** → the set is confirmed before promotion, soft-capped, and equipment-gated; promotion is reversible (a later `rejected` disposition). Active-but-uncooked recipes correctly show as "underused" in `retrospective` (which reads the cooking log, not overlay status) until cooked.
- **[Pages disabled, or App lacks `Pages: read`]** → `recipe_site_url` returns `enabled: false` (404) or `insufficient_permission` (403) rather than a broken link, and the skill relays the exact setup step (enable Pages / grant the permission). No silent failure.
- **[Writing to shared `feeds.toml` from onboarding]** → `update_feeds` writes shared config, so a first member's feeds affect the group pool — acceptable (anyone trusted with the MCP can already widen `discovery_sources.toml`); the skill frames import-source setup as a group action.
- **[Thorough inventory feels heavy]** → it is opt-in in tone and voice-suggested; the "keep it light" guidance still exists, relocated to the returning-member branch. A member can stop anytime (per-area persistence).

## Migration Plan

No data migration. One-time operator setup: grant the GitHub App the **`Pages: read`** permission (so `recipe_site_url` can resolve the private repo's Pages site). Deploy is the standard two-step: push Worker changes (the three new tools) to `main`, then trigger `deploy.yml` in the operator's data repo; rebuild the plugin (`npm run build:plugin`, connector URL only) and let the marketplace pull-update carry the regenerated onboarding skill. Existing members are unaffected (per-area resumability means a returning member just sees the readback); the new areas only ever add data. Rollback is reverting the Worker deploy and the plugin rebuild — no state to unwind.

## Open Questions

None blocking. Future follow-ups (out of scope): removal/edit semantics for `update_stockup` / `update_feeds`; caching the `recipe_site_url` Pages lookup if it proves chatty (it's called only during onboarding today).
