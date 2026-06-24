## Status

**Draft stub — north-star / ADR.** This is the boundary decision the focused migration changes implement against; it is design-level, not a single implementable unit. It supersedes the storage premise of `json-profile-bundle` (KV-JSON) and absorbs the scope of `finish-kv-migration` (cooking-log relocation + `commit_changes` retirement). Those two are re-pointed here.

## Why

The project has stopped being a viability experiment and is proving useful as a daily agent. That changes what the data layer should optimize for. Two facts now drive the architecture:

1. **The only thing GitHub gives us that nothing else can is Obsidian/mobile markdown editing.** A web admin UI will never match a native markdown app for hand-editing recipes. So *recipes earn their place in git*; nothing else does. Every other corpus artifact is TOML — config, caches, registries, attributed notes — which no human edits in Obsidian and which are written by tools, not by hand.

2. **An admin web UI is coming.** KV is the wrong substrate for an admin UI: you can't query, filter, sort, join, or partially update; whole-blob writes race; and reads are eventually consistent (a write may not be visible for up to ~60s — already a latent smell for the interactive read-modify-write flows now on KV). D1 (SQLite at the edge) is exactly built for what an admin UI and the agent both want: SQL queries, relations, indexes, transactions, strong consistency.

The result is a **three-tier boundary** that finally makes the storage line match the meaning of the data:

```
  GitHub   recipes/*.md only          authored markdown — Obsidian/mobile, source of truth
  D1       all domain & operational    queryable, relational, admin-editable, strongly consistent
           data + derived projections
  KV       ephemeral infrastructure    tokens, OAuth, PKCE, TTL caches, locks — KV's real job
```

A bonus: for everything that lands in D1, the **TOML-vs-JSON question that started this whole thread dissolves** — there's no document to serialize, just typed columns (with JSON columns for the genuinely freeform bits like `preferences.custom` or `kitchen.notes`).

## Placement (the decision)

| Artifact | Today | New home | Rationale |
| --- | --- | --- | --- |
| `recipes/*.md` | GitHub | **GitHub** | Obsidian/mobile markdown editing is unmatched. Source of truth. |
| recipe index (`index:recipes`) | DATA_KV | **D1** | Derived; lets `list_recipes` SQL-filter (status/course/makeability/query) instead of loading the whole blob, and powers the admin recipe browser. Rebuilt by the build on recipe push. |
| preferences, taste, diet_principles, kitchen, staples, overlay, ready_to_eat, stockup | DATA_KV bundle | **D1** | Per-tenant, admin-editable, mutated field-by-field. `overlay` group-ratings ("two others rated 4+") become a single indexed SQL aggregate instead of an O(tenants) KV scan. JSON columns for freeform (`custom`, `kitchen.notes`). |
| pantry, meal_plan, grocery_list | DATA_KV | **D1** | Heavily mutated per session; partial-row updates + strong consistency beat whole-array rewrite on eventually-consistent KV. |
| cooking_log | GitHub TOML | **D1** | An event log. `retrospective` = `GROUP BY protein/cuisine`; `last_cooked` = `MAX(date) GROUP BY recipe`. Write-time slug validation against the recipe index. |
| notes, store_notes | GitHub TOML | **D1** | Cross-tenant, attributed, multi-author — database-shaped, never Obsidian-shaped. FKs to recipes/stores; admin CRUD. |
| stores | GitHub TOML | **D1** | Registry; admin-editable; FK target for store_notes. |
| aliases, feeds, discovery_sources, flyer_terms | GitHub TOML | **D1** | Tool-written config; tiny tables; admin-editable. |
| sku cache (`skus/kroger.toml`) | GitHub TOML | **D1** | A cache, machine-written, queried by ingredient+location, pruned by `last_used` — an indexed table. (KV also defensible; D1 wins for admin inspection + query.) |
| discoveries_inbox | GitHub TOML | **D1** | Email-written; dedup via `UNIQUE(url)`; admin triage queue. |
| kroger tokens, PKCE verifiers, warmed flyer cache, health records (`KROGER_KV`) | KV | **KV** | Ephemeral, TTL'd, key-lookup. KV's actual sweet spot — stays. |
| OAuth provider storage (`OAUTH_KV`) | KV | **KV** | Required by `@cloudflare/workers-oauth-provider`. Stays. |
| tenant directory + invites (`TENANT_KV`) | KV | **KV** (revisit) | Tiny operational mapping; KV fine. Could fold into D1 if the admin UI grows user management. |

## What Changes (umbrella; delivered as focused slices)

- Add a **D1 binding** + a thin Worker data-access layer; adopt D1 schema migrations (`wrangler d1 migrations`) alongside / replacing the KV REST migration runner.
- Migrate the domain data above from GitHub/KV into D1, slice by slice (roadmap in `design.md`), each behind its own migration and independently shippable.
- Shrink `scripts/build-indexes.mjs` to **recipes-only**: validate recipe markdown + project the recipe index into D1. All other build-time validators (stores, discovery, cooking-log, whole-repo TOML parse-check) move to **Worker write-time** validation.
- Retire `commit_changes` once the cooking log and overlay rating/status leave GitHub (its last GitHub-backed, sole-writer capabilities). Open decision carried from `finish-kv-migration`: fold rating/status into `update_recipe` vs. a new `rate_recipe` tool.
- Carry forward the validated `json-profile-bundle` tool/schema design (preferences merge-patch, defined-top-level + `custom`, dropping `commit_changes.config_updates`) onto the D1 profile slice — the *design* survives; only its KV-JSON *storage target* is superseded.
- Rewrite `docs/ARCHITECTURE.md`'s determinism/data-model boundary to the three tiers; update `SCHEMAS.md` (file shapes → D1 table shapes) and `SELF_HOSTING.md` (operator now provisions a D1 db, not just KV).

## Capabilities (sketch — to be detailed per slice)

- New: `cloudflare-data-platform` (the D1 binding, access layer, migration tooling, the tier boundary).
- Modified across slices: `data-read-tools`, `data-write-tools`, `recipe-index` (formerly `recipe-index-kv`; → D1), `cooking-history`, `recipe-notes`, `shared-corpus`, `build-automation`, `operator-provisioning`, `multi-tenancy`.
