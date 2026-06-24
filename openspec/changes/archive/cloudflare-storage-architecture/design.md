## Context

`unified-user-profile-kv` moved per-tenant state to `DATA_KV`; `recipe-index-kv` moved the derived recipe index there too. `json-profile-bundle` (in flight) would re-shape the KV profile blob from TOML-strings to JSON. Mid-implementation, two realizations reframed the whole substrate question:

- GitHub's *only* irreplaceable value here is Obsidian/native-mobile **markdown** editing — which applies to recipes and nothing else. All other corpus files are TOML data a human never hand-edits.
- An **admin web UI** is on the roadmap, and the system is now a relied-upon tool, not an experiment. That makes *query-ability, relations, partial edits, and strong consistency* first-class requirements — which is D1's job, not KV's.

So the question stopped being "TOML or JSON in KV?" and became "**GitHub, D1, or KV?**" per artifact.

## Goals / Non-Goals

**Goals:**
- One clear placement rule per artifact (the table in `proposal.md`), justified by how the data is read, written, related, and edited.
- Lean into Cloudflare: D1 as the system of record for domain/operational data; KV confined to ephemeral infra; GitHub confined to authored markdown.
- A sequenced, low-risk migration path — each slice independently shippable behind its own migration.

**Non-Goals:**
- Moving recipes out of git (the Obsidian premise is the whole point).
- Building the admin UI itself (separate effort; this makes the data layer ready for it).
- A premature KV read-cache in front of D1 — add only if a hot path is *measured* to need it (YAGNI).

## Decisions

### Decision: Three tiers, two filters

The placement rule is two questions:

```
  1. Is it human-authored MARKDOWN a person curates by hand?      → GitHub   (recipes only)
  2. Otherwise — is it domain/operational data that is queried,
     related, admin-edited, or needs read-after-write consistency? → D1       (almost everything)
     …or is it ephemeral infra (tokens, OAuth, TTL caches, locks)? → KV       (KROGER_KV, OAUTH_KV)
```

Both filters agree on the hard cases: notes/store_notes/stores are *cross-tenant, attributed, multi-author* → database-shaped, not vault-shaped → D1. The SKU cache and discovery inbox are *machine-written* → never GitHub-worthy → D1 (queryable) over KV (opaque).

**Rationale:** KV is eventually consistent, opaque-blob, key-only — great for edge-cached reads of immutable-ish values and TTL'd ephemera, wrong for mutable relational domain data behind an admin UI. D1 gives SQL, indexes, transactions, partial updates, and strong consistency. At friend-group scale D1's limits (db size, single write-region, write throughput) are nowhere near binding.

### Decision: For D1 data, the document-format question is moot

TOML-vs-JSON was a *serialization* debate about opaque blobs. D1 stores typed columns — there is no document. Genuinely freeform sub-structures (`preferences.custom`, `kitchen.notes`, inline cooking-log dimensions) use D1 **JSON columns** (`json_extract`, etc.). So `json-profile-bundle`'s format work is largely subsumed; what survives is its **interface** design (below).

### Decision: `json-profile-bundle` is redirected, not discarded

Its *storage* premise (KV-JSON bundle) is superseded by the D1 profile slice. But its *tool/schema* design is backend-agnostic and validated, and carries forward verbatim:
- `update_preferences` as a deep **merge-patch** over a **defined top-level schema + open `custom`** (the brands tri-state via value/`null` maps just as cleanly onto an UPSERT/DELETE of a `brand_prefs` row).
- Dropping the redundant `commit_changes.config_updates`.

Continuing to *implement* `json-profile-bundle` against KV would be throwaway. It is parked as a design source for the profile slice.

### Decision: `finish-kv-migration` is absorbed

Its scope — cooking_log off GitHub, `commit_changes` retirement, the `update_recipe`-vs-`rate_recipe` decision — lands here, with cooking_log going to **D1** (not KV). The retrospective/last_cooked simplification is one of the strongest D1 arguments, so it belongs in this umbrella.

### Decision: build shrinks to recipes; validation moves to write-time

With only recipes in GitHub, `build-indexes.mjs` becomes "validate recipe markdown + project the recipe index into D1." Every other validator (`validateStore`, `validateDiscoveriesInbox`, `validateDiscoverySources`, `validateCookingArtifacts`, the whole-repo TOML parse-check) moves into the Worker at write time — the same trajectory `recipe-index-kv` and the KV state migrations already set. The stale "Worker has no corpus access on workerd" constraint is already false (the recipe index is queryable), so write-time slug resolution is available.

## Migration Roadmap (sequenced slices)

Each is its own change with its own D1 migration; ordered by value and independence.

```
  0. d1-foundation      Add D1 binding + Worker data-access layer + migration
                        tooling (wrangler d1 migrations). Operator provisioning
                        gains a D1 db. No data moves yet.
  1. d1-recipe-index    index:recipes (KV) → D1. list_recipes SQL-filters;
                        build projects rows. Lowest risk (derived, rebuildable);
                        unblocks the admin recipe browser first.
  2. d1-cooking-log     cooking_log (GitHub TOML) → D1. retrospective + last_cooked
                        become SQL. Write-time slug validation. Pairs with…
  3. retire-commit-changes  …removing commit_changes' last GitHub/sole-writer roles
                        (cooking-log append + recipe rating/status). Decide
                        update_recipe vs rate_recipe.
  4. d1-profile         preferences/taste/diet/kitchen/staples/overlay/ready_to_eat/
                        stockup → D1 tables. Absorbs json-profile-bundle's
                        merge-patch + schema. overlay group-ratings → SQL aggregate.
  5. d1-session-state   pantry/meal_plan/grocery_list → D1. Strong-consistency win.
  6. d1-shared-corpus   notes, store_notes, stores, aliases, feeds,
                        discovery_sources, flyer_terms, sku cache, discoveries_inbox
                        → D1. build-indexes shrinks to recipes-only.
```

Slices 1–6 each leave the system shippable. `json-profile-bundle` → folded into slice 4; `finish-kv-migration` → slices 2+3.

## Risks / Open Questions

- **D1 read latency vs KV edge cache.** KV reads are edge-local; D1 is regional-primary with read replication. At single-household scale, and with Worker+user typically co-located, expected negligible. Mitigation if a hot path proves slow: a thin KV read-cache in front of a specific D1 query — added only when measured, never preemptively.
- **Backup / DR.** GitHub was an implicit backstop for the TOML data. D1 has time-travel + export; define an export/snapshot cadence so losing the recipe-git-backup for non-recipe data is covered. (Recipes remain git-backed.)
- **Migration mechanics.** Shift from the KV REST `run-migrations` ledger to D1 native migrations — or run them in the same deploy step. Idempotency + the deploy-ordering window (new code vs not-yet-migrated data) carry over from the `0001`/`0002` experience; D1 transactions make the cutover cleaner than KV's per-key puts.
- **Worker refactor surface.** KV `get/put` → SQL across many tools. Larger diff, but it *deletes* the parse/serialize/coerce layers (smol-toml leaves the hot path entirely; it stays only for reading recipe-adjacent GitHub content if any remains).
- **Open:** `update_recipe` accepts rating/status (one mental model, re-creates split routing) vs. new `rate_recipe` (clean separation, one more tool). Carried from `finish-kv-migration`; decide at slice 3/4.
- **Open:** does `TENANT_KV` (tenant directory + invites) stay KV or join D1 for admin user-management? Defer to whenever the admin UI defines its needs.
