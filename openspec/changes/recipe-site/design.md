## Context

The repo already generates deterministic JSON indexes from `recipes/*.md` via `scripts/build-indexes.mjs` (gray-matter + smol-toml, hand-rolled, validated in CI). The recipe corpus is small (63 active recipes) and remarkably regular: every body is exactly `## Ingredients` (a `-` list) followed by `## Instructions` (an ordered list), with no other sections today. Frontmatter carries clean facet axes — `protein` (7 values), `difficulty` (3), `cuisine` (16), `dietary` (4) — plus 74 long-tail `tags`. `_indexes/components.json` already holds the component adjacency graph (currently one entry: `fresh-pasta` → three consumers). There are no image assets and no `pairs_with` field.

This change adds a human-facing site that is read mostly on a phone or tablet in the kitchen. The guiding constraint from the user: exceptionally simple, lean hard into browser/DOM natives, htmx-or-similar only if truly needed (it isn't), accessibility first, pretty but not audacious, readability paramount. It is for cooking, not vanity.

## Goals / Non-Goals

**Goals:**
- Turn the corpus into a browsable, cookable site: an A–Z index with filtering/search, and a clean per-recipe page.
- Be functional with **zero JavaScript**. Every script is a progressive enhancement over a working static baseline.
- Exercise modern browser-native CSS as the primary tool (View Transitions, `:has()`, container queries, subgrid, scroll-driven animation, `light-dark()`).
- First-class accessibility: semantic HTML, labeled landmarks, keyboard-native controls, reduced-motion/contrast respect.
- Useful kitchen features: cross-off-able ingredients, tap-to-advance read-aloud, offline/installable on iPhone/iPad.
- Stay in the repo's grain: hand-rolled Node build script, deterministic output, CI-built (not committed), minimal dependencies.

**Non-Goals:**
- No serving-size scaler (ingredient quantities are freeform text, not structured — out of scope).
- No `pairs_with` recipe pairing (the field does not exist in the data; do not invent it).
- No recipe photos / image pipeline (no image data; the design is deliberately text-forward).
- No full-text instruction search (metadata search is sufficient; avoids a separate search index).
- No client framework, no bundler, no htmx, no React.
- No custom domain in v1.

## Decisions

### Generator: hand-rolled `build-site.mjs` with `marked`, not a SSG framework
Mirrors the existing `build-indexes.mjs` pattern exactly (one Node script, ESM, deterministic). Eleventy/Astro would also be "simple" but add a framework to learn and pin, and cede control over output HTML — which matters because accessibility and the checkable-ingredient injection both depend on emitting exact semantic markup. One new dependency, `marked`, gives full GFM markdown rendering for current and future content (e.g. a `## Notes` table). Alternatives considered: remark/unified (heavier dep tree, more than needed); markdown-it (fine, but `marked` is smaller and fits the "exceptionally simple" bar); hand-rolled markdown parser (rejected — was viable when bodies were trivially regular, but the user explicitly wants full markdown capability for future sections).

### Structural contract enforced in validation, consumed by the generator
Rather than have the generator guess where ingredients live, validation hard-fails any recipe missing `## Ingredients` or `## Instructions` (added to the `data-validation` capability). The generator runs `marked.lexer()`, groups tokens by H2 into `<section aria-labelledby="…">` regions, and trusts the contract to find the ingredient list (to inject checkboxes) and the step list (for read-aloud + numbering). Extra H2 sections render generically — so adding `## Notes` later needs no generator change. Wrapping each H2 block in a labeled `<section>` is simultaneously a styling hook and an a11y win (screen readers announce each labeled region). Alternative considered: post-processing rendered HTML with regex (rejected — fragile; token walking is robust and gives clean injection points).

### Two capabilities split along the progressive-enhancement seam
`recipe-site` owns the static output and its pure-CSS behaviors (generation, page structure, ordering, faceted filter via `:has()`, checkable ingredients via `:has()`, component links, a11y, styling, deploy). `recipe-site-enhancements` owns the optional JS/SW layer (search, read-aloud, offline PWA). This mirrors the central design principle — a working zero-JS site, enhanced — and keeps each spec focused and under the line cap.

### Faceted filtering is pure CSS via `:has()`; tags are not a facet
Each facet (protein, difficulty, cuisine, dietary) is a `<fieldset>` of radio inputs. A checked radio drives `body:has(#facet-x:checked) .recipes li:not([data-x="x"]) { display:none }`. Facets AND together cleanly (a card hidden by any active facet stays hidden). This is keyboard- and screen-reader-native with zero script. Cuisine (16 values) lives in a collapsible `<details>` radio group. **Tags are display + searchable only, not a facet** — 74 distinct tags, mostly single-use, are unworkable as filter controls. Known limitation: pure-CSS facets are single-select per axis (`protein=chicken AND difficulty=easy`, but not `chicken OR beef`); multi-select is deferred to the search box rather than abandoning the zero-JS facet model.

### Checkable ingredients via `:has()`, no JS, no persistence
`<li><label><input type="checkbox"> …</label></li>` with `.ingredients li:has(:checked){ text-decoration:line-through; opacity:.55 }`. Real checkboxes are natively accessible; state intentionally resets on reload (a fresh cook, not durable state).

### Read-aloud: Web Speech API, step-walk, tap-to-advance (no autoplay)
`speechSynthesis` is browser-native, offline, free, no keys. A play control reads the current step and highlights it; the user taps to advance to the next step. **No `onend` auto-advance** — chained autoplay reads ahead of the cook and is the exact behavior that makes TTS annoying; manual advance is both more robust and less code. The first user gesture satisfies iOS's speech-requires-gesture rule; `getVoices()` is resolved via the `onvoiceschanged` event. This is for hands-busy *sighted* cooks and is explicitly not a substitute for screen-reader accessibility (which the semantic markup handles independently).

### Metadata search, progressive, URL-synced
~30 lines of vanilla JS filtering cards by their already-present `data-*` attributes (title, tags, `ingredients_key`, cuisine, protein). This catches ingredient queries like "chorizo" via `ingredients_key` with no separate search index, and works offline once `index.html` is cached. State syncs to the URL (`?q=…`) so a filtered view is shareable/bookmarkable. CSS cannot read text input values, so search is the one genuinely-needs-JS feature; it degrades to "no search box" with JS off while facets keep working.

### Offline via web app manifest + hand-written service worker
The site is tiny (~64 small HTML files + one CSS + a few small scripts), so the generator emits a precache list (stamped with a content hash) and a ~35-line service worker: cache-first for static assets, network-first for navigations so new recipes land. A `manifest.webmanifest` (`display: standalone`, theme color, 🍲 emoji-SVG icons at 192/512, name "Recipes") makes it installable. On iOS/iPadOS 16.4+, service workers + Cache API work, installed home-screen apps are first-class, and install is via Share → Add to Home Screen (manual, no auto-prompt). No Workbox, no build tooling. **iOS PWA behavior to verify at build time** — Apple's posture has wobbled — rather than trusting documentation blindly.

### Deploy: GitHub Pages, host-neutral output
GH Pages needs zero secrets (built-in `GITHUB_TOKEN`, `pages: write` + `id-token: write`) — strictly less config than Cloudflare Pages, which needs either dashboard Git-integration or `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` secrets. The generator emits **relative URLs throughout**, so the output is identical for either host and a later swap to Cloudflare is a one-task change (replace the deploy step only). Build runs indexes → site (the site reads `components.json`).

### Presentation: text-forward, system fonts, restrained warm palette
No web-font downloads — `ui-serif` for recipe body/instructions (warm, readable for long cooking text), `system-ui` sans for chrome/metadata. Fluid `clamp()` type, ~62ch measure, `text-wrap: pretty`. `oklch()` warm-paper neutral + a single appetizing accent, `light-dark()` for automatic dark mode (warm charcoal, not pure black). Responsive `auto-fill` card grid (1 col phone → 2–3 tablet, no media queries). On tablet landscape, the recipe page's ingredients become a `position: sticky` side rail beside the steps. Motion (View Transitions, scroll-driven reveal, `@starting-style` transitions) is short, soft, and `prefers-reduced-motion` gated.

### Display surface
`rating` and `last_cooked` are **hidden** — agent-internal signals, and the site is for cooking, not vanity. Recipe cards show title · time · difficulty · tag row. Recipe pages show full metadata minus those two, plus the `source` attribution link.

## Risks / Trade-offs

- **Pure-CSS facets are single-select per axis** → Multi-value queries deferred to the search box; documented as a known limitation, not a defect.
- **`marked` passes raw HTML through by default** → Content is first-party (own repo, public-read), so injection risk is negligible; v1 explicitly skips sanitization and records the assumption. Revisit if non-author content ever enters `recipes/`.
- **`time_total` can be null** (≥1 recipe today) → Generator and time handling must be null-safe: bucket as "unknown", display "—". Never throw on missing optional fields.
- **TTS voice quality/availability varies by OS** → Acceptable; tablet (the primary target) has good voices. Feature degrades to "no read-aloud button" if `speechSynthesis` is absent.
- **iOS storage eviction (~7 days unused)** → Mitigated for installed home-screen apps and irrelevant for a regularly-used kitchen tablet; not engineered around.
- **GH project Pages serves under a `/<repo>/` subpath** → Neutralized by relative URLs; verified by testing the built `site/` served from a subpath before deploy.
- **Cutting-edge CSS (View Transitions, scroll-driven, `@starting-style`) has uneven support** → All are pure enhancement over a working static page and reduced-motion gated; unsupported browsers get instant navigation and no animation, never a broken layout.

## Migration Plan

Additive only — no existing behavior changes except the new validation rule. Sequence: (1) add the required-headings validation rule (all 63 recipes already comply, so it passes immediately); (2) build the generator + styles; (3) add enhancements (search, TTS, PWA); (4) add the Pages workflow and enable Pages once in repo settings. Rollback is removing the workflow and `scripts/build-site.mjs`; nothing else depends on the site. The generated `site/` is never committed, so there is no tree to clean up.

## Open Questions

None blocking. To confirm during build: exact current iOS Safari PWA/eviction behavior (Apple's posture has shifted); whether a content-hash bust is preferred over a manual SW version constant (lean: content hash, decided).
