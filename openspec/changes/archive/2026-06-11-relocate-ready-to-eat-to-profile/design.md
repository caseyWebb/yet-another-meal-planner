## Context

Ready-to-eat is the one corpus that skipped the multi-tenant split (see `multi-tenant-friend-group`). Recipes were split into shared **content** (`recipes/*.md`), per-tenant **overlay** (`users/<id>/overlay.toml` — rating/status), and per-tenant **notes**. RTE instead kept everything on shared root files `ready_to_eat/{breakfast,lunch,dinner}.toml`, including the inherently per-member `status` and `sku` cache. Because RTE items carry no objective shared content (an item is a Kroger SKU + a personal willingness to eat it), the right model isn't "shared content + per-tenant overlay" like recipes — it's **wholly per-tenant**, a facet of the personal profile alongside taste/preferences/diet/pantry.

The proposal commits to a full relocation. This document covers how the file is shaped, how items are keyed, how the tools and validation change, and why the index is dropped.

## Goals / Non-Goals

**Goals:**
- One per-tenant file, `users/<id>/ready_to_eat.toml`, owning all RTE catalog/preference state.
- A stable per-item key (`slug`) that the tools, cooking log, and feedback all agree on.
- A real `rating` field, ending the skill/schema drift.
- Onboarding can seed the catalog conversationally.
- No shared RTE state, no RTE index.

**Non-Goals:**
- The **consumption** side (`cooking_log` `type=ready_to_eat`, cook-vs-convenience split, `ready_to_eat_favorites`). Already per-tenant and correct — untouched.
- Data migration. There is no existing RTE data; this is a clean break.
- Changing `ready_to_eat_default_action` (already in `preferences.toml`; stays put).
- Sharing "good frozen finds" across the friend group. Explicitly given up — an RTE item has no shared content worth the cross-tenant coupling.

## Decisions

### One file, items tagged by `meal`
A single `users/<id>/ready_to_eat.toml` holds all items, each with `meal = "breakfast" | "lunch" | "dinner"`, instead of three files. Per-tenant the data is small, so three files would be noise. `variety_rules` move from per-file to a per-meal table within the one file (e.g. `[variety_rules.dinner]`).
*Alternative considered:* three per-tenant files mirroring the old layout — rejected as needless fan-out for a small list.

### Generated `slug` as the stable key
Each item gets a `slug` generated from its `name` (same slugify the recipe corpus uses), unique within the tenant's file. `name` is display-only. All addressing — `update_ready_to_eat(slug, …)`, `ready_to_eat_available()` output, and `cooking_log` `type=ready_to_eat` entries — keys on `slug`.
*Why:* today `update_ready_to_eat` takes a slug while `add_draft_ready_to_eat`/`cooking_log` match by name — a latent mismatch. A generated slug is the one fix that makes every path agree.
*Cooking-log note (revised during apply):* the consumption side is left **entirely** by-name. `ready_to_eat_favorites` already aggregates `cooking_log` `type=ready_to_eat` entries by `name` ([retrospective.ts](../../../src/retrospective.ts)), and the menu-flow restock cross-references those favorites against `pantry.toml` by name too — so nothing in consumption needs the catalog `slug`. Carrying a slug into the log would spread edits into the cooking-history capability the proposal promises to leave untouched, for no correctness gain. The `slug` is therefore catalog-only (where `update_ready_to_eat` addresses items); the cooking log is unchanged.

### `rating` field added to the item
Optional integer `rating`, matching the recipe overlay's rating semantics. The `add-ready-to-eat-feedback` skill already writes one; this makes it real and validated.

### Tools read/write the caller's per-tenant file
`add_draft_ready_to_eat`, `update_ready_to_eat`, and `ready_to_eat_available` resolve `users/<caller>/ready_to_eat.toml` (the same caller-resolution the other per-tenant tools use) instead of the shared root. No new tools are introduced.

### Onboarding adds *active* items via an optional status on the add tool
Discovery adds **drafts**; onboarding adds items the member explicitly named, which are **active** acceptances, not drafts to disposition. Rather than add a tool, `add_draft_ready_to_eat` gains an optional `status` (default `draft`) so onboarding can assert active items directly. This keeps `guided-onboarding`'s "introduce no new MCP tools" constraint intact.
*Alternative considered:* add-then-immediately-update (draft → active) — rejected as two writes and two commits for one intent.

### Drop the `_indexes/ready_to_eat.json` index
`build-indexes.mjs` stops emitting the RTE index; the Worker reads the per-tenant TOML directly (as it already does for pantry/overlay/grocery_list). `build-indexes.yml` stops watching `ready_to_eat/**`.
*Why:* the index existed to aggregate the shared catalogs; per-tenant there is nothing to aggregate, and a per-member list is cheap to parse on read.

### Validation moves with the file
`build-indexes.mjs` (Node validator) and `src/validate.ts` (Worker structural subset) validate `users/<id>/ready_to_eat.toml`: `meal` enum, `status` enum, optional `rating`, required `slug`, slug uniqueness within the file.

## Risks / Trade-offs

- **Wider blast radius than a patch** (schema, three Worker source files, validator, build tooling, three agent skills, the data template, eight spec deltas) → mitigated by the clean break: no migration code, no back-compat shims, no dual-read period.
- **The data template is a separate repo** → the template update is a tracked task here but lands as a coordinated change in `groceries-agent-data-template`; the Worker must tolerate an **absent** `users/<id>/ready_to_eat.toml` (empty catalog) so a not-yet-migrated tenant degrades gracefully rather than erroring.
- **Losing cross-member discovery sharing** → accepted; the value was marginal and the coupling caused the bug.
- **Slug collisions within a tenant** (two items slugify the same) → de-duplicate with a numeric suffix at generation time, same as the recipe slug path.

## Migration Plan

Clean break — no data migration (no RTE data exists). Deploy order:
1. Land schema + Worker + validator + build-tooling changes in this repo; the Worker reads per-tenant and treats a missing file as an empty catalog.
2. Rebuild the plugin from `AGENT_INSTRUCTIONS.md` (`npm run build:plugin`).
3. Update `groceries-agent-data-template` to ship `users/<id>/ready_to_eat.toml` and remove root `ready_to_eat/`.
4. Deploy the Worker via the data-repo `deploy.yml`.
*Rollback:* revert the repo change and redeploy; no data to unwind.

## Open Questions

- None blocking. (Resolved during exploration: drop the index; generated slug; no migration.)
