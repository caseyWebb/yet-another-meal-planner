## MODIFIED Requirements

### Requirement: Alias-driven normalization

The system SHALL normalize the ingredient by stripping a leading quantity/unit, lowercasing, and resolving the cleaned surface form to a **canonical id** through the shared alias front-door (variant → id) and the identity registry's representative pointer, where a canonical id is a base plus zero or more product qualifiers (`base` or `base::qualifier…`; see the `ingredient-normalization` capability). The quantity strip SHALL remove a leading quantity only when a measurement unit follows, so a **product qualifier** that reads like a fraction (e.g. `80/20`) is NOT discarded as a quantity. A surface form with no alias entry SHALL resolve to the cleaned term unchanged (no regression) and be enqueued for the capture job. The matcher SHALL search Kroger using the canonical id's reconstructed `search_term` when one exists (so `ground-beef::fat-80-20` searches "80/20 ground beef"), and the bare base otherwise. `sku_cache` and `brand_prefs` SHALL key on the canonical id. Normalization SHALL NOT aggressively strip qualifiers beyond the deterministic quantity strip; product-versus-preparation qualifier judgment belongs to the capture job, not the hot path.

#### Scenario: Alias resolves a variant to its canonical id

- **WHEN** an ingredient string matches a `variant` entry in the shared alias table
- **THEN** it is normalized to that canonical id (through the representative pointer) before cache lookup and search

#### Scenario: A product qualifier is preserved, not stripped as a quantity

- **WHEN** `match_ingredient_to_kroger_sku("80/20 ground beef")` normalizes the term
- **THEN** the `80/20` is not stripped as a leading quantity, and the term resolves toward `ground-beef::fat-80-20` (searching "80/20 ground beef") rather than collapsing to bare "ground beef"

#### Scenario: An unmapped term still resolves and is captured

- **WHEN** an ingredient has no alias entry
- **THEN** the matcher normalizes to the quantity-stripped term and proceeds (as today), and the surface form is enqueued so a later capture tick can place it
