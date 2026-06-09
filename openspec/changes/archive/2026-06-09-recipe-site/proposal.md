## Why

The 63 recipes in `recipes/*.md` are only readable as raw markdown or through the agent. There is no human-facing way to browse, filter, or cook from them — especially on the phone or tablet that actually sits in the kitchen. The data is already SSG-shaped (regular frontmatter + a perfectly regular `## Ingredients` / `## Instructions` body, plus a deterministic `_indexes/` already generated), so a static site is a small, self-contained addition that turns the corpus into something you can cook from.

## What Changes

- Add a static site generator (`scripts/build-site.mjs`) that reads `recipes/*.md` and emits a static `site/`: one index page listing all recipes, one page per recipe, and a single hand-written stylesheet. Uses `gray-matter` (already a dependency) plus `marked` (one new dependency) for full markdown rendering; no framework, no bundler, no React.
- **Enforce a structural contract on recipe bodies**: every recipe must contain `## Ingredients` and `## Instructions` H2 sections. Additional H2 sections (e.g. a future `## Notes`) render generically. This becomes a hard-fail validation rule so the generator can reliably locate the ingredient list and step list.
- Index page: all recipes A–Z, `active` first and `draft` recipes sorted to the bottom (`rejected` / `archived` excluded), with pure-CSS faceted filtering (protein, difficulty, cuisine, dietary) and a progressively-enhanced metadata search box.
- Recipe page: checkable ingredients (pure CSS), numbered steps with a tap-to-advance read-aloud mode (Web Speech API), bidirectional component cross-links sourced from `_indexes/components.json`, and a source attribution link.
- Lean hard into modern browser-native CSS: cross-document View Transitions, `:has()`, container queries, subgrid, scroll-driven reveal, `@starting-style`, `oklch()` + `light-dark()`, fluid `clamp()` type — all `prefers-reduced-motion` / `prefers-color-scheme` gated. Accessibility is a first-class requirement (semantic landmarks, labeled regions, keyboard-native controls, `:focus-visible`).
- Offline support: a web app manifest plus a hand-written service worker that precaches the (tiny) site so it works offline and installs to the home screen on iPhone/iPad. Icon is an emoji-derived SVG (🍲), app name "Recipes".
- The entire site is 100% functional with JavaScript disabled. Search, read-aloud, and the service worker are the only scripts and are all progressive enhancements.
- Add a GitHub Pages deploy workflow. The build output is host-neutral (relative URLs throughout), so swapping to Cloudflare Pages later is a one-step change.

## Capabilities

### New Capabilities
- `recipe-site`: The static site generator and its presentation layer — the build pipeline (markdown → semantic HTML), page structure and ordering/inclusion rules, pure-CSS faceted filtering and checkable ingredients, component cross-links, accessibility guarantees, the modern-CSS presentation, the JS-off progressive-enhancement baseline, and GitHub Pages deployment.
- `recipe-site-enhancements`: The optional script and offline layer that progressively enhances the static site — metadata search, tap-to-advance read-aloud (Web Speech API), and offline / installable PWA support (web app manifest + service worker). All degrade gracefully to the static baseline.

### Modified Capabilities
- `data-validation`: Add a hard-fail rule requiring every recipe body to contain `## Ingredients` and `## Instructions` H2 sections, so downstream generation can rely on the structural contract.

## Impact

- **New code**: `scripts/build-site.mjs`, the site stylesheet and client scripts (search, read-aloud, service worker), the web app manifest and icon, a GitHub Pages deploy workflow (`.github/workflows/build-site.yml`).
- **New dependency**: `marked` (markdown rendering). `gray-matter` already present.
- **Modified**: validation logic (the existing index/validation build) gains the required-headings rule; `docs/SCHEMAS.md` documents the recipe body structural contract.
- **Reads existing artifacts**: `recipes/*.md` (frontmatter + body) and `_indexes/components.json` (component adjacency). Does not modify recipe data or other indexes.
- **Generated `site/` is not committed** — it is built in CI and published as a Pages artifact, consistent with how generated output is kept out of the tree.
- **Out of scope**: serving-size scaler, `pairs_with` linking (not in the data), recipe photos, full-text search, custom domain.
