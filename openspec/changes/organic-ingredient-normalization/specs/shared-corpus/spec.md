## MODIFIED Requirements

### Requirement: Shared reference data

The ingredient identity layer SHALL live in the shared corpus, read by all tenants, as a small set of D1 tables: an `ingredient_alias` front-door (variant → canonical id, with a `source` of `auto` or `human`), an `ingredient_identity` node registry (canonical id → base, detail, reconstructed `search_term`, a `representative` pointer for union-find synonym merges, a `concrete` flag distinguishing concept nodes, and a cron-owned embedding), an `ingredient_edge` table of directed `satisfies` edges (from_id → to_id, kind), and the `novel_ingredient_terms` capture queue plus the `ingredient_normalization_log` audit/evaluated-set. Normalizing a term SHALL resolve it through the alias front-door and follow the `representative` pointer to the surviving canonical id, identically for every tenant. The layer SHALL grow **organically** via the scheduled capture job with no required human action (see the `ingredient-normalization` capability); `update_aliases` remains a `human`-sourced authoritative write into the same store. There are no shared `substitutions` and no per-tenant substitution-override layer — ingredient substitution is LLM reasoning (over the loaded pantry for inventory subs, and over enumerated Kroger searches for sale subs), not a curated rules file. (There is likewise no shelf-life `ingredients` reference — freshness is LLM-judged, not driven by a table.)

#### Scenario: Shared identity resolution applies to all tenants

- **WHEN** any tenant normalizes an ingredient term
- **THEN** the shared alias front-door + identity registry are consulted (resolving through the representative pointer), identically for every tenant

#### Scenario: Existing aliases remain valid after generalization

- **WHEN** the current `aliases` rows are migrated
- **THEN** each existing `canonical` becomes a base-level id (no qualifier) in the identity registry and the alias front-door points at it, so pre-change reads resolve unchanged

#### Scenario: No substitutions reference data is present

- **WHEN** the shared corpus reference data is enumerated
- **THEN** there is no substitutions table and no per-tenant substitution override; substitution candidates are produced by agent reasoning, not read from a file
