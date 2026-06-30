## Why

The Hono rewrite re-platformed the admin panel (Elm → `hono/jsx` SSR + `hono/jsx/dom` islands) but carried its styling over **verbatim**: a ~120-line hand-rolled global stylesheet of bespoke classes (`.card`, `.pill`, `.tier.*`, `.workbench`, `.logs`) accreted while shipping surfaces fast during development. There is no shared visual language, so every new surface re-invents spacing/color/structure and an agent editing a page has no vocabulary to compose from — the panel is a grab bag. Adopting **Basecoat** (a Tailwind CSS, shadcn/ui-compatible component system with an `llms.txt` for agent authoring) gives the panel a thin, real design system: a documented class + `data-variant`/`data-size` API, shadcn CSS-variable theming, and full Tailwind utility authoring, so pages — yours and agents' — compose from a known vocabulary instead of bespoke CSS. The rewrite's "any sandbox can rebuild" guarantee is preserved: Tailwind v4 was verified to build in-sandbox from a **prebuilt** native binary (no source compile — the same pattern as the existing esbuild dependency), **fully offline**, in ~244ms. `admin/dist/` is a gitignored artifact CI and the deploy build fresh, so there is no committed stylesheet to keep in sync.

## What Changes

- Add a **Tailwind v4 compile step** to `scripts/build-admin.mjs`: build an entry CSS (`@import "tailwindcss"; @import "basecoat-css/vega"` + a thin project layer) against the panel's `src/admin/**/*.tsx` class usage into `admin/dist/admin/styles.css` — a **gitignored build artifact** that CI, the deploy, and local `wrangler dev` build fresh — **replacing the verbatim copy** of the hand-rolled stylesheet. **No network fetch at build time** (runs from installed `node_modules`), so any sandbox still rebuilds it.
- Add `tailwindcss`, `@tailwindcss/cli`, and `basecoat-css` as **devDependencies** — build-time only, never bundled into the Worker (so out of `check-licenses.mjs`'s production scope; all MIT regardless).
- Adopt a **single pinned Basecoat style pack** (Vega) and the **shadcn CSS-variable token system**; a small project theme layer overrides `--primary` to keep the operator's orange accent.
- Rewrite the **component kit** (`src/admin/ui/kit.tsx`) to emit Basecoat's documented markup + `data-variant`/`data-size` API: `Button`, `Card`, `Field` (label+input), `ErrorBanner`→`alert`, `Table`, `TierBadge`→`badge`, `Dialog`→native `<dialog>`; typed props unchanged.
- Migrate the panel's areas **page-by-page** from bespoke classes to the Basecoat kit + Tailwind utilities, triaging each area **keep / simplify / drop** — the restyle pass is the moment to question each surface, not just repaint it. A surface that is dropped is captured as a REMOVED requirement in the spec delta when that decision is made.
- **No Basecoat component JavaScript.** Interactive islands use Basecoat's CSS-only components (native `<dialog>`, native select) and keep owning behavior in `hono/jsx/dom` state — read-only pages still ship zero client JS, and no second runtime mutates island-owned DOM.
- Shrink `src/admin/styles.css` to a **thin project layer** (the `--primary` theme override + the genuinely panel-specific layout — the master/detail grids), imported by the Tailwind entry; the bespoke component classes are removed.
- **Visual regression (optional, final phase):** stand up the Playwright visual-snapshot harness — config + a CI job + the pinned container — which the rewrite deferred **wholesale** to a follow-up (no harness exists in the repo today), then commit baselines against the final Basecoat look. It does not block the restyle and MAY be split into its own single-concern change.

## Capabilities

### New Capabilities
<!-- None. Observable behavior is preserved; this is a visual re-platform of an existing capability. -->

### Modified Capabilities
- `operator-admin`: the panel's **visual layer** changes from a hand-rolled global stylesheet to a **Basecoat (Tailwind v4) design system compiled by the admin build**; the component kit's class API and the served stylesheet's provenance change. Access-gating, member lifecycle, logs, config, calibration, the shared-corpus editors, the Kroger-consent link, and the data explorer are **behavior-preserved**. Some surfaces MAY be simplified or dropped during the page-by-page pass — each such drop is recorded as a REMOVED requirement in this change's spec delta when decided.

## Impact

- **Code:** `scripts/build-admin.mjs` gains a Tailwind compile step (replacing the stylesheet copy); `src/admin/ui/kit.tsx` rewritten to the Basecoat API; `src/admin/styles.css` shrinks to a thin project layer imported by the Tailwind entry; every `src/admin/pages/*` and `src/admin/client/*` swept from bespoke classes to the kit + utilities. The Worker's `src/` operation functions, the `/admin` routes, the D1 schema, and the determinism boundary are **untouched**.
- **Build/CI:** new devDependencies (`tailwindcss`, `@tailwindcss/cli`, `basecoat-css`); `node scripts/build-admin.mjs` (run by CI, the deploy, and local dev) now also compiles the CSS, and `admin/dist/` stays gitignored — no committed bundle, so no drift gate to maintain. If the optional visual-regression phase is kept, this change **stands up** the Playwright harness the rewrite deferred (there is no CI snapshot job today). The served stylesheet grows to ~22 kB gzipped (from ~3 kB) — **accepted**, not optimized further: an internal tool cached behind Access.
- **Dependencies:** build-time only; nothing new ships in the Worker bundle.
- **Determinism boundary:** unchanged.
- **Docs:** `src/admin/CLAUDE.md` gains the Basecoat authoring idiom (component classes + `data-variant` + Tailwind utilities; no Basecoat JS; islands own behavior); `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` admin-build references updated for the Tailwind step in lockstep.
- **Builds on the cutover Hono panel:** `rewrite-admin-panel-to-hono` is **archived** — Elm and the Dev tool console are removed and Hono serves all of `/admin` — so there is already a single styling system to migrate (the prerequisite is satisfied).
