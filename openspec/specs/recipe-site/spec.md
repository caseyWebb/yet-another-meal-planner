# recipe-site Specification

## Purpose

Defines the static, zero-JavaScript-baseline recipe site generated from the `recipes/*.md` corpus: how the generator produces deterministic `site/` output, how recipes are rendered and indexed, the pure-CSS faceted filtering and checkable-ingredient interactions, component cross-linking, accessibility requirements, and host-neutral GitHub Pages deployment.
## Requirements
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

The index page SHALL list all shared-corpus recipes alphabetically by title. The per-tenant `status` lifecycle is retired — recipes no longer carry a `status` frontmatter field and there is no `active`/`draft`/`rejected`/`archived` distinction in the shared corpus. All recipes in `recipes/*.md` are included unless explicitly excluded by the operator's site configuration.

#### Scenario: All corpus recipes are listed alphabetically

- **WHEN** the generator runs against the `recipes/` corpus
- **THEN** every recipe is listed A–Z with no status-based exclusion or reordering

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

### Requirement: Recipe page content and display surface

Recipe pages SHALL display the title, time, difficulty, cuisine, tags, the rendered body, and a `source` attribution link when present. Recipe cards on the index SHALL display title, time, difficulty, and tags. The site SHALL NOT display per-tenant disposition or derived fields (`favorite`, `reject`, `last_cooked`). Missing or null optional fields (e.g. a null `time_total`) SHALL be handled gracefully without error.

#### Scenario: Per-tenant signals are not shown

- **WHEN** the site is generated
- **THEN** no per-tenant disposition or derived field (`favorite`, `reject`, `last_cooked`) appears anywhere on the site

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

