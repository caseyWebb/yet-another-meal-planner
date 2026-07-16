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

Every imported recipe SHALL be written conformant to the **authored** required-field
contract (the `recipe-metadata-contract` capability): the required authored fields
(`title`, `source`, `time_total`, `dietary`, `requires_equipment`, `pairs_with`) present
with explicit empty forms (`null`/`[]`) where a value is genuinely empty — `source: null`
for a non-discovery import. The descriptive facets (`protein`, `cuisine`, `course`,
`season`, `tags`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`,
`meal_preppable`) are **not** required in frontmatter — they are derived by the classify
pass and seeded at import (see `recipe-facet-derivation`). There is no `status` field and
no `draft` limbo — an imported recipe is an available corpus recipe by default. The write
SHALL satisfy the shared authored contract with no missing-required-field slack; a missing
required authored field is a hard failure, not a soft warning.

#### Scenario: Fresh import validates the authored contract strictly

- **WHEN** the importer writes a recipe via `create_recipe`
- **THEN** the write succeeds only if every required **authored** field is present (value or explicit empty); a missing required authored field is rejected with a structured `validation_failed` error and no recipe is written

#### Scenario: Available by default, no draft

- **WHEN** a recipe is imported
- **THEN** it carries no `status` and is available to every member by default, rather than landing in a `draft` state to be activated

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

The URL-import parse SHALL, when the page's schema.org `Recipe` carries a `tool` property, surface it **internally** to the import classification stage as a non-authoritative `tools_hint`. `tools_hint` SHALL NOT be written to `requires_equipment` directly; it informs the conservative required-equipment classification only, and it is not returned to the caller (the fused `import_recipe` returns the landed slug, not parse output).

#### Scenario: Tool property informs classification without becoming the verdict

- **WHEN** `import_recipe({ url })` parses a page whose `Recipe` JSON-LD includes a `tool` array naming replaceable utensils
- **THEN** the classification stage sees the hint, applies the conservative rubric, and the written `requires_equipment` stays empty unless a genuinely-vital vocabulary tool is required

### Requirement: Near-duplicate reconciliation without auto-merge

Near-duplicate recipes SHALL be surfaced for human review rather than merged automatically, by an **ongoing scheduled reconcile** over the whole corpus (the `recipe-dedup` capability) — not a one-time import pass. Detected pairs SHALL be reported as pending operator proposals carrying the pair and its evidence; both recipes SHALL be retained until a human decides, and no automated path SHALL merge, delete, or hide either recipe.

#### Scenario: Near-duplicates surfaced, not merged

- **WHEN** two recipes look like variants of the same dish (e.g. stovetop vs. pressure-cooker butter chicken)
- **THEN** both are retained and the pair is reported for the user to decide

#### Scenario: Pre-existing duplicates are eventually surfaced

- **WHEN** two near-duplicate recipes already coexist in the corpus (imported before any dedup ran)
- **THEN** the scheduled reconcile surfaces the pair as a pending operator proposal without either recipe being modified

### Requirement: AI brief description generated at import

At import `create_recipe` SHALL **seed** a `description` for the recipe synchronously: a
brief (≈1–2 sentence) summary in a consistent, craving-aligned register (dish identity,
flavor/texture, when one would want it), generated by the Worker — NOT the scraped
marketing copy from the source page. The `description` is a **derived** field stored in D1
(per `derived-recipe-metadata`), not authored frontmatter; the seed keeps a new recipe
readable before the next reconcile tick, which remains the authority.

#### Scenario: Description is summarized, not scraped

- **WHEN** a recipe is imported from a page with promotional copy
- **THEN** the seeded `description` is the Worker's concise summary stored in D1, and the scraped marketing text is not used as the description

### Requirement: Import populates every required field

The import step SHALL populate every required **authored** field before the write,
deriving each from the source where possible: `time_total` from the source times,
`dietary` and `requires_equipment` classified (the gates stay authored), `pairs_with` set
to its value or `[]`, and `source` recovered or `null`. The **descriptive facets** SHALL
NOT be authored into frontmatter at import; instead `create_recipe` SHALL **seed** them
synchronously via the classify pass (see `recipe-facet-derivation`), so an agent import is
not facet-lagged. A required authored field the importer cannot derive SHALL be written in
its explicit empty form (`null`/`[]`), never omitted.

#### Scenario: The authored gates are populated, never omitted

- **WHEN** a recipe is imported
- **THEN** `dietary` and `requires_equipment` are classified and written (value or explicit `[]`), and `time_total`/`source`/`pairs_with` are present in explicit form

#### Scenario: Descriptive facets are seeded, not authored

- **WHEN** `create_recipe` writes a recipe
- **THEN** it seeds the derived descriptive facets synchronously (so the next projection materializes them) rather than requiring them in authored frontmatter

### Requirement: import_recipe fuses parse, classification, and persistence

The system SHALL provide an `import_recipe` tool taking **exactly one of** `url` or `text` (plus an optional `title` hint), that runs the whole import pipeline in one call and returns the landed slug. The **URL path** SHALL run the egress-guarded fetch and schema.org JSON-LD extraction (handling `@graph`, top-level arrays, multiple script blocks, `@type` string/array, `HowToStep`/`HowToSection`/plain-string instructions), returning the structured acquisition errors on failure — `{ error: "unreachable" }` (fetch failure, or an outbound-guard refusal with no upstream status, indistinguishable from a dead host), `{ error: "no_jsonld" }`, `{ error: "not_a_recipe" }`, `{ error: "incomplete", missing: [...] }`. The **text path** SHALL classify the pasted content through the discovery sweep's classification (`classifyRecipe` — env.AI with corrective retry) into contract-valid frontmatter and body; unclassifiable text SHALL return a structured `validation_failed`, writing nothing. Both paths SHALL populate every required **authored** field before the write (the gates `dietary`/`requires_equipment` classified under the conservative rubric with any `tools_hint` as a non-authoritative input; `time_total`/`source`/`pairs_with` in explicit-empty form when underivable) and SHALL converge on the shared create operation: slug derived from the cleaned dish name (parenthetical gloss excluded), `slug_exists` refusal, `recipe_imports` attribution (`via 'agent'`, the resolved member) recorded beside the write, no `status` stamped, and the synchronous description/facet seed (`recipe-facet-derivation`) so the import is not facet-lagged. A duplicate `source` URL SHALL be **dedup-to-grant**: no second copy, the caller household's grant minted idempotently, and a **success** return `{ slug, already_existed: true }` naming the existing recipe to reuse. A fresh import returns `{ slug }`. The agent supplies no frontmatter: recipe **editing** is not part of this tool (the web app owns member edits; merge review lands on the fast-follow admin merge screen).

#### Scenario: A URL import lands in one call

- **WHEN** `import_recipe({ url })` is called for a reachable page carrying a schema.org Recipe
- **THEN** the recipe is parsed, classified, validated, and written — attribution and facet seed included — and the tool returns `{ slug }` with the recipe immediately findable via a vibe-less `search_recipes` spec

#### Scenario: A pasted recipe imports without a URL

- **WHEN** `import_recipe({ text })` is called with a recipe pasted from a bot-walled site
- **THEN** the classification path produces contract-valid frontmatter and body, the shared create operation persists it, and the tool returns `{ slug }`

#### Scenario: A duplicate source becomes a grant, reported as success

- **WHEN** `import_recipe({ url })` is called with a `source` URL already in the shared corpus
- **THEN** no second copy is written, the caller household's `recipe_imports` grant is minted (idempotently), and the tool returns `{ slug, already_existed: true }`

#### Scenario: Acquisition failures are structured

- **WHEN** the URL is unreachable, guard-refused, has no JSON-LD, carries no Recipe, or yields no ingredients/instructions
- **THEN** the tool returns the corresponding structured error (`unreachable` carrying no upstream status on a guard refusal) and writes nothing

#### Scenario: url and text are mutually exclusive

- **WHEN** `import_recipe` is called with both `url` and `text`, or neither
- **THEN** the tool returns a structured `validation_failed` and writes nothing

