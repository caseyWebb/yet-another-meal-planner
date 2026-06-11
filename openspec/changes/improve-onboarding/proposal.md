## Why

The `configure-grocery-profile` skill collects taste/diet/preferences but leaves a freshly-onboarded member with a **non-functional agent**, because of two silent cold-start blockers in the multi-tenant model:

1. **The shared corpus is dark to a new member.** Recipe `status` went per-tenant (it lives in `users/<id>/overlay.toml`); an absent row means effective `status: "draft"`. A new member's overlay is empty, so *every* shared recipe reads as draft — and `list_recipes` defaults to `status: "active"`. The first `list_recipes()` returns `[]`, so a menu request has nothing to propose from.
2. **No store location, no pricing.** `kroger_prices` / `place_order` resolve a `locationId` from `preferences.toml [stores].preferred_location` and hard-throw when it is unset. Onboarding never captures a store or ZIP.

The skill even ends by offering "want me to put together a first menu?" — which hits *both* blockers. Onboarding's real job is to make the agent work on day one; today it sets up preferences but leaves the agent unable to plan or price. This change closes both gaps, deepens the first-run inventory (the one moment a member is motivated and standing in their kitchen), and seeds the bulk-buy watchlist and discovery sources so the sale/discovery features aren't dead on arrival.

## What Changes

- **Capture the store ZIP first.** A new setup area writes `preferences.toml [stores]` (ZIP only — the Kroger resolver needs only a 5-digit ZIP), unblocking all Kroger pricing/ordering before anything else runs.
- **Bootstrap a starter corpus.** After taste/diet/equipment are captured, the skill curates a soft-capped (~12–18, LLM-judged) set of fitting, makeable shared recipes and **bulk-promotes them to `active`** in the member's overlay via one `commit_changes`, turning the dark corpus on. The full known corpus is reachable too: the skill **points the member at the hosted recipe site** to browse everything and opt in any specific recipe (noting their admin may need to enable GitHub Pages if it isn't live).
- **Seed discovery for the first/sparse-corpus member.** When the corpus is near-empty, the skill asks for import sources and specific recipes to add — wiring newsletter senders via `update_discovery_sources`, RSS feeds via the new `update_feeds`, and ad-hoc URLs via `import_recipe`.
- **Deepen the first-run inventory.** First-run inventory becomes thorough and open-ended — a room-by-room walk (fridge → freezer → pantry → **spice drawer**) with an explicit suggestion to use **voice/dictation**. The "keep it light, it self-corrects" guidance moves to the returning-member branch.
- **Seed the bulk-buy watchlist.** A new (optional) stockup area captures the items a member buys in bulk plus `typical_purchase` and `freezer_capacity_estimate`, persisted via the new `update_stockup`. Price thresholds (`buy_at_or_below` / `baseline_price`) are **not** prompted — they are already advisory-only (nothing in the Worker gates on them; the agent reasons over the live flyer price), so they stay optional.
- **Per-area resumability.** Each setup area checks its own file and skips if already populated (don't re-promote a corpus that already has active overlay rows, don't re-walk a `taste.md` that exists), collapsing the "first-run vs returning" branch into per-area checks. Two flow-correctness details this surfaces: profile reads (`read_preferences`/`read_pantry`/`read_taste`/`read_diet_principles`) throw `not_found` for a brand-new member and must be read as "empty area," not failures; and `update_preferences` overwrites the file verbatim, so writes that span areas must carry the complete content (the cooking-nights write must preserve the store ZIP).
- **Cross-record ready-to-eat with pantry stock.** RTE items are tracked as catalog options (`ready_to_eat.toml`) *and* on-hand stock (`pantry.toml`), but no flow keeps them in sync. Onboarding's inventory and heat-and-eat areas — and the standalone `update_pantry` flow — now cross-record (offer to catalog an RTE item heard during inventory; record on-hand stock for an accepted item) so the menu-gen restock cross-reference works. No new tool — wiring `update_pantry` + `add_draft_ready_to_eat`.
- **Two new mirror-tools.** `update_stockup` (per-tenant) and `update_feeds` (shared) — both add-only with dedup, mirroring the existing tested `update_discovery_sources`.
- **Runtime site-URL resolution.** A new `recipe_site_url` read tool resolves the hosted-site URL at runtime from the data repo's GitHub Pages config (honoring a custom domain, detecting whether Pages is enabled), so the onboarding flow points the member at the live browse view with no build-time-baked URL.
- **Docs cleanup.** `SCHEMAS.md`: quote the malformed `feeds.toml` `tags` example, note that stockup price fields are advisory/LLM-reasoned (not gates), and fix the stale "five areas" count.

## Capabilities

### New Capabilities
<!-- none — this change extends existing capabilities -->

### Modified Capabilities
- `guided-onboarding`: adds store-ZIP capture, starter-corpus bootstrap (overlay promotion + hosted-site pointer), first/sparse-corpus discovery-source seeding, a deepened thorough first-run inventory (spice drawer + voice), an optional stockup-watchlist area, and per-area resumability; relaxes the "defines no new MCP tool" constraint to "consumes the existing write tools plus `update_stockup` and `update_feeds`."
- `data-write-tools`: adds the per-tenant `update_stockup` write tool (writes `users/<id>/stockup.toml`).
- `recipe-discovery`: adds the shared `update_feeds` write tool (writes the data-repo-root `feeds.toml`).
- `data-read-tools`: adds the `recipe_site_url` read tool, which resolves the hosted-site URL from the data repo's GitHub Pages config at runtime.
- `cooking-history`: adds the capture-side mirror of the RTE-on-hand invariant — when physical inventory is recorded outside onboarding (the standalone `update_pantry` flow), heat-and-eat items are offered for cataloging and their on-hand stock recorded.

## Impact

- **`AGENT_INSTRUCTIONS.md`** — the `configure-grocery-profile` flow is rewritten (the bulk of the change), and the `Pantry update` flow gains the RTE cross-record offer; plugin rebuild regenerates the skill bundle under `plugin/`.
- **Worker (`src/`)** — three new tools: `update_stockup` (per-tenant) and `update_feeds` (shared), each a pure dedup-merge helper + thin tool; and `recipe_site_url` (a read tool backed by a new `getPagesUrl()` on the GitHub client). The GitHub App needs the **`Pages: read`** permission granted once (operator setup) for `recipe_site_url` to resolve a private repo's Pages URL.
- **`docs/TOOLS.md`** — entries for `update_stockup` and `update_feeds`; **`docs/SCHEMAS.md`** — the three cleanups above.
- **No data-model or migration impact** — the cold-start fixes are behavioral (the overlay/`preferred_location` mechanisms already exist). No Kroger/cart behavior changes.
