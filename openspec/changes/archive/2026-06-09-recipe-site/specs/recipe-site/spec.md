## ADDED Requirements

### Requirement: Static site generation

The system SHALL provide a generator (`scripts/build-site.mjs`) that reads `recipes/*.md` and emits a static `site/` directory containing one index page, one page per recipe, a single stylesheet, and client assets. The generator SHALL use `gray-matter` for frontmatter and `marked` for markdown body rendering, SHALL introduce no client framework or bundler, and SHALL produce deterministic output. The generated `site/` SHALL NOT be committed to the repository.

#### Scenario: Generator emits a page per recipe plus an index

- **WHEN** `scripts/build-site.mjs` runs against the `recipes/` corpus
- **THEN** `site/index.html` is written and one recipe page is written per non-excluded recipe, along with the stylesheet and client assets

#### Scenario: Output is deterministic

- **WHEN** the generator runs twice against an unchanged corpus
- **THEN** the two `site/` outputs are byte-identical

### Requirement: Full markdown rendering with semantic sectioning

The system SHALL render the full markdown body of each recipe, including any H2 sections beyond `## Ingredients` and `## Instructions` (e.g. a future `## Notes`). Each H2 block SHALL be wrapped in a `<section>` labeled by its heading (`aria-labelledby`). The Ingredients list SHALL render as an unordered list and the Instructions list as an ordered list.

#### Scenario: Extra sections render without generator changes

- **WHEN** a recipe contains a `## Notes` section with markdown content
- **THEN** that section renders as a labeled `<section>` in the recipe page with its markdown formatting preserved

#### Scenario: Ingredients and instructions use list semantics

- **WHEN** a recipe page is generated
- **THEN** ingredients render inside a `<ul>` and instructions render inside an `<ol>`

### Requirement: Index ordering and inclusion

The index page SHALL list recipes alphabetically by title, with `status: active` recipes ordered before `status: draft` recipes (drafts sorted to the bottom). Recipes with `status: rejected` or `status: archived` SHALL be excluded from the site entirely.

#### Scenario: Drafts sort to the bottom

- **WHEN** the corpus contains both active and draft recipes
- **THEN** the index lists all active recipes A–Z first, followed by draft recipes A–Z

#### Scenario: Rejected and archived recipes are excluded

- **WHEN** a recipe has `status: rejected` or `status: archived`
- **THEN** no page is generated for it and it does not appear on the index

### Requirement: Pure-CSS faceted filtering

The index SHALL provide faceted filtering over `protein`, `difficulty`, `cuisine`, and `dietary` using only HTML and CSS (no JavaScript). Facets SHALL be keyboard- and screen-reader-accessible form controls. Multiple active facets SHALL combine with AND semantics. `tags` SHALL NOT be a facet control.

#### Scenario: Facets filter without JavaScript

- **WHEN** JavaScript is disabled and the user selects `protein: chicken`
- **THEN** the index visually narrows to chicken recipes

#### Scenario: Facets combine with AND

- **WHEN** the user selects `protein: chicken` and `difficulty: easy`
- **THEN** only recipes that are both chicken and easy remain visible

### Requirement: Checkable ingredients

Each ingredient on a recipe page SHALL be a checkable item that visibly marks as done when toggled, using only HTML and CSS. The control SHALL be a native, accessible checkbox and SHALL NOT require JavaScript. State is not persisted across reloads.

#### Scenario: Tapping an ingredient crosses it off

- **WHEN** the user toggles an ingredient's checkbox
- **THEN** that ingredient is visually marked as completed with no JavaScript involved

### Requirement: Component cross-links

Where `_indexes/components.json` records a component relationship, recipe pages SHALL render bidirectional links: a recipe that produces a component SHALL link to the recipes that use it, and a recipe that uses a component SHALL link to the recipe that produces it. Recipes with no component relationships SHALL render no component link section.

#### Scenario: Producer links to consumers

- **WHEN** a recipe produces a component used by other recipes
- **THEN** its page links to each consuming recipe

#### Scenario: No stub when components are absent

- **WHEN** a recipe has no component relationships
- **THEN** its page renders no empty component-link section

### Requirement: Recipe page content and display surface

Recipe pages SHALL display the title, time, difficulty, cuisine, tags, the rendered body, and a `source` attribution link when present. Recipe cards on the index SHALL display title, time, difficulty, and tags. The site SHALL NOT display `rating` or `last_cooked`. Missing or null optional fields (e.g. a null `time_total`) SHALL be handled gracefully without error.

#### Scenario: Agent-internal signals are not shown

- **WHEN** a recipe has `rating` and `last_cooked` values
- **THEN** neither value appears anywhere on the site

#### Scenario: Null time renders gracefully

- **WHEN** a recipe has `time_total: null`
- **THEN** the page renders without error and shows an "unknown" time placeholder

### Requirement: Accessibility

The site SHALL use semantic landmarks, a skip link, heading hierarchy, labeled regions, keyboard-operable controls, and visible `:focus-visible` styling. Motion SHALL be gated by `prefers-reduced-motion` and color scheme by `prefers-color-scheme`. Filter controls SHALL be real grouped form controls (`<fieldset>` / `<legend>`).

#### Scenario: Reduced motion suppresses animation

- **WHEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** scroll-driven reveals, view transitions, and other non-essential motion are suppressed

#### Scenario: Keyboard-only filtering

- **WHEN** a keyboard-only user tabs to a facet control and activates it
- **THEN** the filter applies and focus remains visible

### Requirement: Zero-JavaScript baseline

The site SHALL be fully functional with JavaScript disabled: browsing, navigation, faceted filtering, checkable ingredients, dark mode, and reading every recipe SHALL all work. Scripted features SHALL be additive enhancements only.

#### Scenario: Site works with scripts disabled

- **WHEN** JavaScript is disabled
- **THEN** the user can browse the index, filter by facet, open any recipe, check off ingredients, and read full content

### Requirement: GitHub Pages deployment with host-neutral output

The system SHALL provide a GitHub Pages deploy workflow (`.github/workflows/build-site.yml`) that builds indexes, builds the site, and publishes `site/` as a Pages artifact using the workflow's built-in token (no external secrets). All internal links and asset references SHALL be relative so the output works unchanged from a subpath or another static host.

#### Scenario: Pages deploy needs no external secrets

- **WHEN** the deploy workflow runs on push
- **THEN** it builds and publishes the site using only the built-in `GITHUB_TOKEN` with Pages permissions

#### Scenario: Output works from a subpath

- **WHEN** the built `site/` is served from a `/<repo>/` subpath
- **THEN** all pages, links, and assets resolve correctly via relative URLs
