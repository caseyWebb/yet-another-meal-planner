# recipe-import Specification

## Purpose

Defines how an external recipe export (the ReciMe corpus) is extracted into conformant `recipes/*.md` files: which cards count as recipes, how duplicate cards collapse and merge tags, which fields are extracted deterministically, how titles and slugs are cleaned to be globally unique, and how a non-destructive enrichment pass recovers sources, gut-checks extracted data, and reconciles components without auto-merging.
## Requirements
### Requirement: Non-recipe cards are excluded

The importer SHALL exclude cards from the ReciMe export that are not recipes. A card with zero ingredients and zero instruction steps SHALL NOT produce a recipe file.

#### Scenario: Exporter landing card is dropped

- **WHEN** the export contains the card "All Your Recipes, In One Place - ReciMe" with no ingredients and no steps
- **THEN** the importer writes no file for it and the recipe count excludes it

### Requirement: Exact-slug dedup with tag merge

The importer SHALL collapse cards that resolve to the same slug into a single recipe file, and SHALL merge the cookbook-section memberships of all collapsed cards into that recipe's `tags`. The `uncategorized` section SHALL NOT contribute a tag. Cards that resolve to different slugs SHALL NOT be merged, even when their titles are similar.

#### Scenario: Same recipe filed in two cookbooks keeps both tags

- **WHEN** a recipe appears in both the `pastas` and `comfort-foods` sections
- **THEN** a single recipe file is written whose `tags` include both `pastas` and `comfort-foods`

#### Scenario: Uncategorized contributes no tag

- **WHEN** a recipe appears only in the `uncategorized` section
- **THEN** the recipe is written with no cookbook tag from that section

#### Scenario: Distinct recipes with similar titles are kept separate

- **WHEN** two cards titled "Pasta e Fagioli" and "Pasta e Fagioli (Italian Bean and Pasta Soup)" have different ingredient and step counts
- **THEN** both are written as separate recipe files and neither is discarded

### Requirement: Deterministic field extraction

The importer SHALL populate, from the export alone, each recipe's `title` (from the card heading), `servings`, `time_active` (from prep minutes), and `time_total`. `time_active` SHALL be the prep minutes, or null when prep is absent. `time_total` SHALL be the sum of whichever of prep and cook minutes are present, and null when neither is present. The recipe body SHALL contain the extracted ingredients and instructions.

#### Scenario: Both times present

- **WHEN** a card's meta line reads "Servings: 6 | Prep: 5 | Cook: 40"
- **THEN** the recipe has `servings: 6`, `time_active: 5`, and `time_total: 45`

#### Scenario: Missing prep time

- **WHEN** a card's meta line reads "Servings: 6 | Cook: 120" with no prep
- **THEN** the recipe has `time_active: null` and `time_total: 120`

#### Scenario: Missing cook time

- **WHEN** a card's meta line reads "Servings: 4 | Prep: 45" with no cook
- **THEN** the recipe has `time_active: 45` and `time_total: 45`

#### Scenario: Neither time present

- **WHEN** a card's meta line carries servings but neither prep nor cook
- **THEN** the recipe has `time_active: null` and `time_total: null`

### Requirement: Imported recipes are active and conformant

Every imported recipe SHALL be written with `status: active`, `source: null`, and `discovered_at` / `discovery_source` null. The output SHALL pass `scripts/build-indexes.mjs --check` (no hard-fail errors); judgment fields left empty before enrichment MAY produce soft warnings.

#### Scenario: Fresh import validates

- **WHEN** the importer has written all recipe files and `build-indexes.mjs --check` is run
- **THEN** the build exits zero, treating only missing recommended fields as warnings

#### Scenario: Library status, not draft

- **WHEN** a recipe is imported from the export
- **THEN** its `status` is `active` rather than `draft`

### Requirement: Importer never overwrites existing recipes

The importer SHALL NOT overwrite an existing recipe file. When a target file already exists, the importer SHALL skip it (or fail loudly) rather than clobber enrichment already applied. A re-run after the enrichment passes SHALL NOT destroy judgment fields, recovered sources, or body edits.

#### Scenario: Re-run after enrichment is non-destructive

- **WHEN** the importer is run a second time and an enriched recipe file already exists at the target path
- **THEN** the importer leaves the existing file untouched and does not overwrite its enriched content

### Requirement: Clean titles and globally-unique slugs

The corpus SHALL be named in a single pass that assigns each recipe a clean `title` and a plain slug derived from it. SEO suffixes (trailing "Recipe"), marketing qualifiers (e.g. "the best", "ultimate", "classic"), and editorial framing SHALL be removed from the `title`; editorial-headline and foreign-name-plus-gloss titles SHALL resolve to the underlying dish name; foreign dish names SHALL be preserved over their English gloss. The resulting slug set SHALL be globally unique.

#### Scenario: SEO suffix and marketing qualifier removed

- **WHEN** a recipe's export heading is "The Best Minestrone Soup" or "Channa Masala Recipe"
- **THEN** its `title` becomes "Minestrone Soup" / "Channa Masala" and its slug is `minestrone-soup` / `channa-masala`

#### Scenario: Editorial headline resolved to the dish

- **WHEN** a recipe's export heading is "This Spin on Mississippi Pot Roast Is Seriously Delicious—and Doesn't Require a Slow Cooker"
- **THEN** its `title` becomes a clean dish name such as "Mississippi Pot Roast" and its slug is `mississippi-pot-roast`

#### Scenario: Foreign dish name preserved over its gloss

- **WHEN** a recipe's export heading is "Arroz Caldo (Filipino Chicken and Rice Soup)"
- **THEN** its `title` is "Arroz Caldo" and its slug is `arroz-caldo`

#### Scenario: Slug collisions resolved

- **WHEN** two recipes would clean to the same slug
- **THEN** the naming pass disambiguates them so every recipe file has a unique slug

### Requirement: Disciplined source recovery

The enrichment pass MAY recover a recipe's `source` URL via web search, but SHALL write `source` only when the candidate page's ingredients and steps match the recipe's content. A bare title match SHALL NOT be sufficient, and unconfirmed recipes SHALL keep `source: null`.

#### Scenario: Confirmed source is written

- **WHEN** a candidate page's ingredient list and instructions align with the recipe's extracted content
- **THEN** `source` is set to that page's URL

#### Scenario: Unconfirmed source stays null

- **WHEN** web search returns plausible pages but none whose ingredients/steps match
- **THEN** `source` remains null

### Requirement: Enrichment gut-checks extracted data

The enrichment pass SHALL sanity-check the deterministically-extracted fields against the recipe's content and SHALL flag — not silently "fix" — values that look wrong: implausible `time_total` / `time_active`, mismatched `servings`, or an instruction body that is unsplit or garbled. Flagged items SHALL be reported for the user rather than corrected in place without notice.

#### Scenario: Implausible time flagged

- **WHEN** a recipe's extracted `time_total` is implausible for its method (e.g. a braise reading 5 minutes)
- **THEN** the enrichment pass reports the recipe and the suspect value for the user to confirm

#### Scenario: Wall-of-text instructions re-split

- **WHEN** a recipe's instructions were extracted as a single undivided block (e.g. the egg-salad sandwich)
- **THEN** the enrichment pass splits them into discrete steps in the body

### Requirement: Conservative required-equipment classification on import

The recipe-add path SHALL classify `requires_equipment` as a judgment field during enrichment, under a conservative rubric: it SHALL default to empty and SHALL tag a controlled-vocabulary slug only when the dish is genuinely impossible without that equipment (no recipe-preserving workaround exists). The schema.org `tool` list and the instruction prose SHALL be treated as **hints, never the verdict** — they enumerate every utensil (bowls, whisks, knives) which are not vital and not in the vocabulary. When in doubt, the classifier SHALL leave the equipment out, because a missed requirement is caught later by the `cook` skill's equipment step whereas a wrong "vital" tag silently hides a makeable recipe. The classified `requires_equipment` SHALL be persisted via `create_recipe`, and SHALL be the same for sides imported through the `pairs_with` bootstrap (which reuse the same create pipeline).

#### Scenario: Most recipes get no equipment requirement

- **WHEN** a recipe is imported whose steps mention a bowl, whisk, and skillet (all replaceable)
- **THEN** the classifier assigns empty `requires_equipment` and the recipe is makeable by everyone

#### Scenario: A genuinely-vital tool is tagged

- **WHEN** a recipe is imported for churned ice cream that cannot be made without an ice-cream maker
- **THEN** the classifier assigns `requires_equipment: ["ice-cream-maker"]` (a vocabulary slug)

#### Scenario: schema.org tool list is a hint, not the verdict

- **WHEN** an imported page's schema.org `tool` list names "blender, mixing bowl, baking sheet" but the dish can be made by hand
- **THEN** the classifier does not tag those tools and leaves `requires_equipment` empty

### Requirement: Importer surfaces the schema.org tool list as a hint

The `parse_recipe(url)` parse SHALL, when the page's schema.org `Recipe` carries a `tool` property, surface it in the parse result as a non-authoritative `tools_hint` for the classifying agent. `tools_hint` SHALL NOT be written to `requires_equipment` directly; it informs the conservative classification only.

#### Scenario: Tool property surfaced as a hint

- **WHEN** `parse_recipe(url)` parses a page whose `Recipe` JSON-LD includes a `tool` array
- **THEN** the parse result includes `tools_hint` with those tools, distinct from any field that is written to the recipe

### Requirement: Perishable-ingredient classification at import

When a recipe is imported or created, the system SHALL classify which of its ingredients are perishable and write them to the recipe's `perishable_ingredients` frontmatter field, in the same step it derives other objective fields (protein, cuisine, etc.). The classification test SHALL be *"would the leftover rot before it would realistically be used?"* — not botanical perishability — so shelf-stable staples are excluded and a small quantity of a fast-spoiling item is included. Names SHALL be **normalized** using the same normalization the pantry-verify matcher applies, so a perishable lines up across recipes for cross-recipe comparison. The field is objective shared content written via `create_recipe` / `update_recipe`; it SHALL NOT be hand-maintained config and SHALL NOT live in any tenant overlay. A wrong classification is non-fatal (it only costs a dismissed waste nudge) and is corrected by a normal recipe edit.

#### Scenario: Import classifies perishables

- **WHEN** a recipe calling for cilantro, olive oil, and canned chickpeas is imported
- **THEN** `perishable_ingredients` is written with the perishable items (e.g. cilantro), normalized, and excludes the shelf-stable staples (olive oil, canned chickpeas)

#### Scenario: Names are normalized for cross-recipe comparison

- **WHEN** two recipes each call for fresh cilantro under different surface wording
- **THEN** both record the same normalized `perishable_ingredients` entry, so the two recipes' use of that perishable can be compared directly

### Requirement: Course classification at import

When a recipe is imported or created, the system SHALL classify the recipe's `course` and write it to the recipe's `course` frontmatter field, in the same enrichment step that derives the other objective fields (`protein`, `cuisine`, `perishable_ingredients`). `course` SHALL be an **open vocabulary**: the classifier SHALL prefer the documented convention (`main`, `side`, `dessert`, `breakfast`) but MAY assign any descriptive value (e.g. `sauce`, `baked_good`) without a code change, since the vocabulary is not a controlled set. A recipe that genuinely plates as more than one course (e.g. a hearty grain salad that serves as a main or a side) MAY be classified with **multiple** values (`course: [main, side]`). The classified `course` SHALL be persisted via `create_recipe` / `update_recipe`. A wrong or missing classification is non-fatal — `course` absence is warn-free and only leaves the recipe un-bucketed in the meal-plan faceting.

#### Scenario: Import classifies a main dish

- **WHEN** a roast chicken recipe is imported
- **THEN** its `course` is written as `[main]` (or `main`), in the same step that derives `protein` and `cuisine`

#### Scenario: Dual-use dish gets multiple courses

- **WHEN** a hearty grain salad that works as either a main or a side is imported
- **THEN** the classifier MAY write `course: [main, side]`, and the recipe is later returned by both `list_recipes({ course: "main" })` and `list_recipes({ course: "side" })`

#### Scenario: Novel course value is accepted without a code change

- **WHEN** a chimichurri recipe is imported and the classifier assigns `course: [sauce]`, a value outside the documented convention
- **THEN** the value is written and indexed as-is — no controlled-vocabulary check rejects it

### Requirement: One-time perishable backfill of the existing corpus

The system SHALL provide a one-time backfill that populates `perishable_ingredients` across the existing recipe corpus by running the same classification used at import, written as normal recipe edits. The backfill SHALL be idempotent (re-running it SHALL NOT duplicate or corrupt entries) and SHALL leave a recipe's other content unchanged.

#### Scenario: Backfill populates legacy recipes

- **WHEN** the backfill runs over recipes that predate the field
- **THEN** each gains a `perishable_ingredients` list derived by the import-time classifier, with no other content altered

### Requirement: Near-duplicate reconciliation without auto-merge

A final pass SHALL surface near-duplicate recipes for human review rather than merging them automatically.

#### Scenario: Near-duplicates surfaced, not merged

- **WHEN** two recipes look like variants of the same dish (e.g. stovetop vs. pressure-cooker butter chicken)
- **THEN** both are retained and the pair is reported for the user to decide

### Requirement: Protein and cuisine classification draws from the controlled vocabulary

When a recipe is imported or created, the system SHALL classify `protein` and `cuisine` to their **coarse controlled buckets** (the sets enforced at write and build time — e.g. `fish` not `salmon`, `shellfish` not `shrimp`), in the same enrichment step that derives the other objective fields (`course`, `perishable_ingredients`, `requires_equipment`). A specific ingredient SHALL be mapped to its bucket rather than written verbatim (shrimp → `shellfish`, salmon/cod/tuna → `fish`). When a dish has **no protein focus** — a vegetable side, a plain noodle or grain dish, a condiment — the classifier SHALL **omit** `protein` (absence is warn-only and legitimate) rather than invent an off-vocabulary value such as `none`. The controlled sets SHALL be surfaced to the classifying agent (the `create_recipe`/`update_recipe` tool descriptions and `AGENT_INSTRUCTIONS.md`), and an off-vocabulary value that nonetheless reaches a write SHALL be rejected by the write tool with a structured error, prompting reclassification, rather than being persisted.

#### Scenario: Specific protein is mapped to its bucket

- **WHEN** a shrimp curry is imported
- **THEN** the classifier writes `protein: shellfish` (the bucket), not `protein: shrimp`

#### Scenario: No-protein-focus dish omits protein

- **WHEN** a radish condiment or a plain cold-noodle dish is imported
- **THEN** the classifier omits `protein` (leaving it absent) rather than writing `protein: none`

#### Scenario: An off-vocabulary value is corrected, not persisted

- **WHEN** the classifier nonetheless emits an off-vocabulary `protein`/`cuisine`/`requires_equipment` value on a write
- **THEN** the write tool returns a structured `validation_failed` error and the recipe is not committed until the value is reclassified to a legal bucket (or, for `protein`/`cuisine`, omitted)

### Requirement: AI brief description generated at import

At import the agent SHALL generate and persist a `description` for the recipe: a brief (≈1–2 sentence) summary in a consistent, craving-aligned register (dish identity, flavor/texture, when one would want it), written by the agent — NOT the scraped marketing copy from the source page. The description is authored frontmatter (human-editable); the embedding is derived from it (reconciled Worker-side on the cron).

#### Scenario: Description is summarized, not scraped

- **WHEN** a recipe is imported from a page with promotional copy
- **THEN** the persisted `description` is the agent's concise summary, and the scraped marketing text is not used as the description

### Requirement: Memoized side search terms generated at import

When a main-course recipe is imported, the agent SHALL generate `side_search_terms` describing the kind of side that complements it (capturing the complementarity judgment once). These terms become the query for semantic side retrieval; curated `pairs_with` is unaffected and remains the deterministic high-confidence pairing.

#### Scenario: Side terms are written for a main

- **WHEN** a main-course recipe is imported
- **THEN** `side_search_terms` is populated with terms describing complementary sides, and `pairs_with` (if any) is left intact

