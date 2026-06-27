## MODIFIED Requirements

### Requirement: Shared data at the repository root

The data repository **root** SHALL hold the data shared by all members: the recipe **content** under `recipes/`, the shared reference data (`aliases.toml` and the default `substitutions.toml`), the shared `skus/kroger.toml` SKU cache, the curated `guidance/` umbrella (with the `guidance/ingredient_storage/`, `guidance/cooking_techniques/`, and `guidance/purchasing/` domain subtrees), and the generated `_indexes/`. The root SHALL NOT contain any per-member subjective or personal data — including ready-to-eat catalogs, which are per-tenant (that lives under `users/<username>/`). The legacy root-level `storage_guidance/` tree is relocated under `guidance/ingredient_storage/` and SHALL NOT remain at the root.

#### Scenario: Root carries content and reference data

- **WHEN** the data repository root is inspected
- **THEN** it contains `recipes/`, the shared reference data and SKU cache, the `guidance/` tree (with `ingredient_storage/`, `cooking_techniques/`, and `purchasing/` subtrees), and `_indexes/`, and no per-member pantry, overlay, notes, or ready-to-eat catalog at the root, and no root-level `storage_guidance/`
