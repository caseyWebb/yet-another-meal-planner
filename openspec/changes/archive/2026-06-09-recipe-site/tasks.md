## 1. Validation contract

- [x] 1.1 Add a hard-fail validation rule requiring every recipe body to contain `## Ingredients` and `## Instructions` H2 sections; allow additional H2 sections
- [x] 1.2 Verify the rule reports the offending file and missing section, and that all 63 existing recipes pass
- [x] 1.3 Document the recipe body structural contract in `docs/SCHEMAS.md`

## 2. Generator core

- [x] 2.1 Add `marked` as a dependency; update `package.json` and lockfile
- [x] 2.2 Create `scripts/build-site.mjs`: walk `recipes/*.md`, parse frontmatter with `gray-matter`, exclude `rejected`/`archived`
- [x] 2.3 Lex each body with `marked`, group tokens by H2 into labeled `<section aria-labelledby>` regions; render Ingredients as `<ul>`, Instructions as `<ol>`
- [x] 2.4 Inject accessible checkbox controls into ingredient list items
- [x] 2.5 Read `_indexes/components.json` and render bidirectional component cross-links (omit the section when no relationships exist)
- [x] 2.6 Emit per-recipe pages with relative URLs; null-safe handling for missing optional fields (e.g. `time_total: null` → "unknown")
- [x] 2.7 Emit the index page: A–Z, active before draft, with recipe cards (title, time, difficulty, tags) and `data-*` facet/search attributes
- [x] 2.8 Do not surface `rating` or `last_cooked` anywhere; render `source` as an attribution link
- [x] 2.9 Ensure deterministic output (sorted iteration, stable formatting); verify two runs are byte-identical

## 3. Styling and presentation

- [x] 3.1 Author the single stylesheet: system serif body / sans chrome, fluid `clamp()` type, ~62ch measure, `text-wrap: pretty`
- [x] 3.2 `oklch()` warm palette with `light-dark()` automatic dark mode
- [x] 3.3 Responsive `auto-fill` card grid (1→2–3 columns) with no media queries; tablet-landscape sticky ingredient rail via `position: sticky`
- [x] 3.4 Pure-CSS faceted filtering via `:has()` over protein/difficulty/cuisine/dietary (cuisine in a collapsible `<details>` group); AND semantics across facets
- [x] 3.5 Pure-CSS checkable-ingredient styling via `:has(:checked)`
- [x] 3.6 Cross-document View Transitions, scroll-driven reveal, `@starting-style` transitions, subgrid/container-query polish — all `prefers-reduced-motion` gated
- [x] 3.7 Accessibility pass: skip link, landmarks, heading hierarchy, `:focus-visible`, `<fieldset>`/`<legend>` facet groups, empty-filter state

## 4. Progressive enhancements

- [x] 4.1 Metadata search script (~30 lines): filter cards by `data-*` attributes, sync state to the URL query, no separate index
- [x] 4.2 Read-aloud script: Web Speech API step-walk, highlight current step, tap-to-advance (no autoplay), `onvoiceschanged` voice resolution, gesture-started
- [x] 4.3 Confirm both scripts are additive — disable JS and verify browse/filter/ingredients/read still work

## 5. Offline / PWA

- [x] 5.1 Generate `manifest.webmanifest` (standalone, theme color, name "Recipes", 🍲 emoji-SVG icons at 192/512)
- [x] 5.2 Generate a content-hashed precache list at build time and a ~35-line service worker (cache-first assets, network-first navigations, stale-cache cleanup on activate)
- [x] 5.3 Register the service worker as a progressive enhancement; verify offline load and that updated content invalidates stale cache

## 6. Deploy

- [x] 6.1 Add `.github/workflows/build-site.yml`: build indexes → build site → publish `site/` as a Pages artifact using the built-in token (`pages: write`, `id-token: write`)
- [x] 6.2 Ensure `site/` is gitignored (built in CI, never committed)
- [x] 6.3 Verify the built `site/` works served from a `/<repo>/` subpath (relative-URL check) and enable Pages in repo settings
  <!-- Subpath/relative-URL check done: served from /site/ subpath, all pages + assets 200, zero absolute internal refs, browser loaded and navigated correctly. Enabling Pages (Settings → Pages → Source: GitHub Actions) is a one-time outward-facing repo-settings step left for the user to do after this branch merges to main, since it publishes the site and the workflow only triggers on main. -->


## 7. Verification

- [x] 7.1 Validate the full corpus builds, the site generates, and validation passes end-to-end
- [x] 7.2 Manual check on a phone/tablet viewport: filtering, search, checkable ingredients, read-aloud, dark mode, view transitions, offline install
  <!-- Verified live in a real browser at tablet width: pure-CSS facets with AND semantics (15 chicken / 7 chicken+easy / 0 chicken+vegan), JS search injection + empty-state, checkable ingredients via :has(:checked), read-aloud start/advance/stop highlighting, dark mode, sticky two-column rail, SW precache of all 70 assets, clean console. On-device home-screen install (iOS Share → Add to Home Screen) is the one step requiring a physical device. -->

