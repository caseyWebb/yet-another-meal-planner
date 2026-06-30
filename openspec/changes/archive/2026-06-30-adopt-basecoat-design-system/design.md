## Context

The admin panel is a single-operator internal tool behind Cloudflare Access: no SEO, no SLA, tiny blast radius. The Hono rewrite (`rewrite-admin-panel-to-hono`, now **cut over and archived** — Elm and the Dev tool console removed, Hono serving all of `/admin`) re-platformed the panel to `hono/jsx` SSR + `hono/jsx/dom` islands but, by its own Decision 9, ported styling as a ~120-line hand-rolled global stylesheet and **explicitly rejected Tailwind** — correct for "120 lines on a one-operator tool" where styling was an afterthought. That decision is reopened now that styling is the explicit focus: the panel needs a documented vocabulary to grow in, and a coding-agent-first repo benefits from a component system agents already know.

**Basecoat** is chosen: a Tailwind CSS component library that is shadcn/ui-compatible (same CSS-variable tokens, same component shapes) but ships as plain HTML classes — no React — with an `llms.txt` so agents author correct markup. It fits the hand-written, functional-CRUD panel without pulling in a framework.

The feasibility-critical facts were verified empirically before committing (scratch build of `tailwindcss@4` + `@tailwindcss/cli@4` + `basecoat-css@1`):
- The Tailwind v4 engine (`@tailwindcss/oxide`) installs as a **prebuilt** platform binary (no source compile at install) and **runs in this sandbox** (~244 ms).
- The build is **fully offline** (prebuilt binary, no registry fetch), so any sandbox still rebuilds the panel. Per the merged build model `admin/dist/` is a gitignored artifact built fresh by CI/deploy, so there is no committed CSS to drift (the compile is also reproducible across runs, but that no longer gates anything).
- Shipped size is a **wash** versus the standalone Basecoat bundle (~22 kB gzipped either way): the Basecoat component+style layer dominates and is all-or-nothing per style pack; only the Tailwind utilities tree-shake (~2 kB). Basecoat is therefore chosen for **authoring ergonomics, not bytes**.

## Goals / Non-Goals

**Goals:**
- Replace the panel's bespoke stylesheet with a **thin Basecoat design system** — a documented component vocabulary (class + `data-variant`/`data-size`) plus Tailwind utilities — that the areas compose from.
- Keep the rewrite's hard-won build property: **no network-registry dependency at build time**, so any sandbox rebuilds `admin/dist/` (a gitignored artifact built fresh by CI, the deploy, and local dev — not committed).
- Preserve **every** observable behavior of the ported areas (Access gating, member lifecycle, logs, config, calibration, corpus editors, Kroger consent, data explorer).
- Migrate **page-by-page**, triaging each surface **keep / simplify / drop**.
- Land a **visual-regression guard** (Playwright baselines) once, at the end.

**Non-Goals:**
- No second Worker, no meta-framework, no change to the `src/` operation functions, the `/admin` routes, the D1 schema, the MCP surface, or the determinism boundary.
- **No custom style pack and no sub-22 kB CSS optimization** — accept the stock pack's size. (Trimming below ~22 kB gz means hand-maintaining a component-scoped style pack: real ongoing work, the opposite of "thin.")
- No dark mode (Basecoat offers it nearly free via `.dark`, but it is out of scope here).
- No Basecoat component JavaScript.

## Decisions

### 1. Basecoat via the Tailwind v4 build, not the standalone bundle
Adopt Basecoat through `@import "tailwindcss"; @import "basecoat-css/<pack>"` compiled by Tailwind v4 — the golden path — so the panel gets the **full utility idiom** the `llms.txt` assumes (`flex gap-2 mt-4` alongside `class="btn"`), proper theming, and a maintained integration. **Verified** the native-binary build runs in-sandbox (prebuilt oxide, no compile, deterministic). **Alternative rejected — the standalone vendored `basecoat.cdn.min.css` (zero toolchain):** it ships the same ~22 kB gz but gives only the components, not arbitrary utilities, so it half-delivers the authoring ergonomics that motivate the change. The operator accepted a build step (CI exists; the sandbox build is proven), so the toolchain cost is paid for the full idiom. **esbuild is already a prebuilt-native-binary build dependency** — Tailwind v4's oxide is the same risk class, not a new one.

### 2. One pinned style pack (Vega) + shadcn token theming; keep the orange accent
Use a single Basecoat style pack, **Vega** (its default, current shadcn-registry default), pinned exactly in the lockfile for drift-gate stability. Theme by **overriding shadcn CSS variables** (`--primary`, etc.) in a small project layer imported **after** Basecoat, so the operator's orange accent survives without forking the pack. **Alternative rejected — a custom style pack** (to shrink CSS or restyle wholesale): real ongoing maintenance, against "thin"; accept the stock ~22 kB gz.

### 3. No Basecoat component JavaScript; islands own behavior
Use Basecoat's **CSS-only** components and keep interactivity in the panel's own `hono/jsx/dom` island state. The two components the panel needs that are interactive elsewhere are CSS-only in Basecoat: the **Dialog** is the native `<dialog>` element + `showModal()` (native modality, focus, and inert background **without** component JS), and **Native Select** is a styled `<select>`. This preserves the rewrite's Decision 4 (read-only pages ship zero client JS) and avoids a second DOM-owning runtime fighting island reconciliation. Basecoat's `window.basecoat.initAll()` lifecycle exists for framework-restored DOM; the panel never loads it.

### 4. The served stylesheet becomes build-generated, preserving every build guarantee
`build-admin.mjs` runs Tailwind over `src/admin/**/*.tsx` to emit `admin/dist/admin/styles.css` (Basecoat component layer + the utilities the source actually uses). Per the merged build model, `admin/dist/` is a **gitignored build artifact** — CI, the deploy, and local `wrangler dev` build it fresh — so there is **no committed stylesheet and no drift gate** to maintain for the CSS. The one guarantee that must hold is the rewrite's: the build **runs from installed `node_modules` with no network fetch**, so any sandbox rebuilds it — verified for Tailwind v4 (prebuilt oxide binary, offline, ~244 ms). The stylesheet, previously **copied** by the script, is now genuinely **built from source**, consistent with the living static-assets requirement. Pin `tailwindcss`/`basecoat-css` in the lockfile so the output only moves on a deliberate bump.

### 5. Page-by-page migration, kit-first, with keep/simplify/drop triage
Rewrite the ~10 kit primitives to the Basecoat API **once** — because the areas compose from the kit, most of the look propagates — then sweep each area's remaining raw classes to kit + utilities. Each area pass **triages keep / simplify / drop** (the panel is a grab bag; the Dev → Tool Console was already dropped in the rewrite). Order mirrors the rewrite's thin-vertical-first phasing: foundation → Status (proof) → Members (first island) → Data + Usage (read-only, high surface/low risk) → Logs (master/detail + dialog) → Config (form-heavy, highest payoff, last). A surface that is dropped is recorded as a REMOVED requirement in the spec delta when decided.

### 6. Visual regression: stand up the deferred harness here (optional), or split it
The rewrite deferred the **entire** Playwright harness — config, CI job, and baselines — to a follow-up "polish pass"; **there is no snapshot harness in the repo today** (`@playwright/test` is a dependency, but no config, no CI job, no baselines). The design migration is that follow-up's natural trigger, so this change MAY stand up the harness in a final, **optional** phase and commit baselines against the Basecoat look (rendered in the pinned Playwright container so local and CI match). It does not block the restyle, and MAY instead be carved into its own single-concern change. Either way the baselines are captured **once**, against the final look.

## Risks / Trade-offs

- **Tailwind output changes across versions** → pin `tailwindcss`/`basecoat-css` exactly in the lockfile; since `admin/dist/` is built fresh (not committed), a version bump simply produces new CSS at the next build — no committed artifact to drift.
- **Shipped CSS grows to ~22 kB gz** (from ~3 kB) → accepted; internal tool, cached behind Access. Deliberately not optimized further.
- **Basecoat 1.0 API churn** (`data-variant`/`data-size`) → pinned version; the kit centralizes the API so a bump is a one-file change.
- **A future widget genuinely needing Basecoat JS** → handle it on a pure-SSR page, or replicate the behavior in island state; do **not** load Basecoat JS into an island (it would fight `hono/jsx/dom` reconciliation).
- **Migration touches every page** → phased and behavior-preserving; each area is an independently shippable step behind the already-cutover Hono panel, and the visual-regression guard backstops the final state.

## Migration Plan

Phased on the feature branch, each phase an independently shippable increment of the **already-cutover** Hono panel:

1. **Foundation** — add the deps; create the Tailwind entry + thin project theme layer; wire the compile into `build-admin.mjs` (built fresh, gitignored — no commit); rewrite `kit.tsx` to the Basecoat API; document the idiom in `src/admin/CLAUDE.md`.
2. **Status** — restyle the home/service-health view (thin vertical proving the look end-to-end).
3. **Members** — first island restyle (table, onboard form, banner→`alert`, row actions); behavior unchanged.
4. **Data + Usage** — the read-only areas (high surface, low risk); triage which views earn their keep.
5. **Logs** — master/detail to card/table + native `<dialog>` for the detail; row-action island behavior unchanged.
6. **Config** — the form-heavy area (calibration machine, ranking/flyer, corpus editors) to Basecoat form components; islands unchanged.
7. **Cleanup + docs** — remove dead classes from `styles.css` (only the thin project layer remains); update `docs/ARCHITECTURE.md` + `CONTRIBUTING.md` in lockstep; rebuild `admin/dist/` locally to sanity-check (it is gitignored — nothing to commit).
8. **Visual regression (optional)** — stand up the Playwright harness + commit baselines against the final look, or split this into its own change (Decision 6).

**Prerequisite (satisfied):** `rewrite-admin-panel-to-hono` is cut over and archived — the Hono panel serves `/admin`; Elm and the tool console are gone.

## Open Questions

- **Tailwind invocation:** shell out to `@tailwindcss/cli` as a subprocess from `build-admin.mjs`, or use the Tailwind Node API? **Lean:** CLI subprocess — simplest, deterministic, matches the hand-rolled `build-*.mjs` culture.
- **Content scanning:** an `@source` directive inside the entry CSS, or CLI `--content` globs over `src/admin/**/*.tsx`? **Lean:** `@source` in the entry CSS (self-contained, travels with the stylesheet definition).
- **Fonts:** adopt Basecoat's preferred Geist (a new dep + font files) or keep `system-ui`? **Lean:** keep `system-ui` — Basecoat falls back to the system stack; no new dependency.
