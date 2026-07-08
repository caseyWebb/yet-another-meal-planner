# discovery-sweep — spec delta (clean-discovery-import-titles)

## ADDED Requirements

### Requirement: Imported titles are cleaned before slug derivation

The sweep SHALL name every recipe it imports to the same cleaning contract the corpus was named
under (`recipe-import`, "Clean titles and globally-unique slugs"): SEO suffixes (e.g. a trailing
or embedded "Recipe"), marketing qualifiers (e.g. "the best", "easy", "homemade", "classic",
"super soft and tender"), and editorial framing (e.g. "A Better …", "Our Go-To …", "Summer Dinner
Recipe: …") SHALL be removed from the imported `title`; foreign dish names SHALL be preserved
over their English gloss. Identity-bearing words (dietary or method qualifiers that change what
the dish *is*, e.g. "Vegan", "Slow Cooker") and informative parenthetical glosses SHALL NOT be
treated as flowery. The cleaning judgment SHALL ride the sweep's existing per-import
classification call (one additional output field — no additional `env.AI` call), and its output
SHALL be accepted only through a deterministic word-subset guard: a cleaned title may only remove
words from the raw title (compared case- and punctuation-insensitively) and SHALL be rejected if
it introduces any word not present in the raw title. On a rejected, missing, or empty cleaned
title the sweep SHALL fall back to the raw title and proceed — title cleaning SHALL NOT introduce
a new park/failure class. The classifier's cleaned title SHALL NOT be consumed by the
facet-derivation paths (it is not a derived facet and never overrides an authored title).

#### Scenario: A flowery feed title is imported clean

- **WHEN** the sweep imports a candidate whose page title is "A Better Beer Can Chicken"
- **THEN** the recipe is written with `title: Beer Can Chicken` and slug `beer-can-chicken`

#### Scenario: An identity qualifier survives cleaning

- **WHEN** the sweep imports a candidate titled "Vegan Meatballs"
- **THEN** the recipe's `title` remains "Vegan Meatballs" — the dietary qualifier is identity, not marketing

#### Scenario: A cleaned title that invents words is rejected by the guard

- **WHEN** the classifier returns a cleaned title containing a word not present in the raw title
- **THEN** the sweep discards the cleaned title, imports with the raw title, and the import succeeds (no park)

#### Scenario: A missing cleaned title falls back to the raw title

- **WHEN** the classifier omits the cleaned-title field or returns an empty string
- **THEN** the import proceeds with the raw title exactly as before this requirement existed

### Requirement: Import slugs derive from the cleaned dish name

The slug of a newly imported recipe SHALL be derived from the **cleaned** title, with any
parenthetical gloss excluded from the slug basis (the gloss MAY remain in the `title`). The
mechanical slug derivation itself (lowercase, accents stripped, non-alphanumerics to hyphens)
SHALL be unchanged. When the cleaned title consists only of a parenthetical, the full title SHALL
be the fallback slug basis. This naming funnel SHALL be shared with the manual `create_recipe`
path, whose explicit `slug` parameter continues to override derivation.

#### Scenario: A glossed foreign title gets a dish-name slug

- **WHEN** a recipe titled "Jatjuk (Pine Nut Porridge)" is imported
- **THEN** its slug is `jatjuk` and its `title` keeps the informative gloss

#### Scenario: Existing slugs are untouched

- **WHEN** the sweep runs after this requirement ships
- **THEN** no existing recipe's slug or R2 object path is renamed — the derivation applies to new imports only

### Requirement: A cleaned-title slug collision is disambiguated, not parked

Because cleaning maps many raw titles onto fewer slugs, the sweep SHALL treat a `slug_exists`
collision at import time — which, after the sweep's URL and semantic dedup, indicates a
same-name-different-dish — by retrying with a bounded, deterministic numeric suffix (`-2`, `-3`,
…) rather than parking the candidate. When the bounded suffix range is exhausted, the candidate
SHALL park as an error (the existing behavior). The manual `create_recipe` path SHALL keep its
structured `slug_exists` error — auto-suffixing is the unattended path's behavior only.

#### Scenario: Same clean name, different dish, both imported

- **WHEN** the sweep imports a candidate whose cleaned title slugifies to an existing recipe's slug and the candidate survived semantic dedup (it is a different dish)
- **THEN** the recipe is imported under the first free suffixed slug (e.g. `strawberry-icebox-cake-2`) and the import is logged with that slug

#### Scenario: create_recipe still surfaces the collision

- **WHEN** `create_recipe` is called with a title whose derived slug already exists
- **THEN** it returns the structured `slug_exists` error for the agent to resolve conversationally
