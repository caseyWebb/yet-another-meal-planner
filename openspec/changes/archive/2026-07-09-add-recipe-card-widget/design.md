## Context

The MCP Apps diagnostic spike established the runtime facts: claude.ai mounts a `ui://` iframe from our self-hosted custom connector, hydrates it from a tool's `structuredContent`, and runs the `tools/call` bridge — provided the widget speaks the exact handshake (the spike's one bug was sending `clientInfo` where the schema wants `appInfo`). A follow-up proof build confirmed the build side: a Vite target (`@vitejs/plugin-react` + `@tailwindcss/vite` + `vite-plugin-singlefile`) emits ONE self-contained HTML file (~160 KB gzip) with zero external network requests, bundling the ext-apps `App` client and reusing real `packages/ui` components + the `theme.css`/`cookbook.css` token layer.

Two data facts constrain the design: `read_recipe` returns `{ slug, frontmatter: Record, body: markdown }` — **no** structured `ingredients[]`/`steps[]` (only name-only `ingredients_key` arrays + free-text body); and claude.ai already ships a built-in `recipe_display_v0` widget that owns servings-scaling + step timers (fed by the agent, used by the guided `cook` flow).

## Goals / Non-Goals

**Goals:**
- Render a branded, read-only recipe card inline in the Claude conversation, reusing `packages/ui`.
- Establish the reusable bespoke-widget pattern — single-file build target, `App`-client bridge, `ui://` resource served over `resources/read`, no capability gating — that later widgets extend.

**Non-Goals:**
- Servings-scaling or step timers (that is `recipe_display_v0`'s lane, and `read_recipe` cannot feed structured ingredients/steps anyway).
- Interactivity / mutations from the card (read-only v1).
- Reading the host's light/dark preference through the bridge (v1 owns its own theme; host-sync is a later enhancement).
- A distinct card-specific visual design (v1 rides the existing `cookbook.css` recipe-detail styling).

## Decisions

**1. Bundle the canonical ext-apps `App` client — do NOT hand-roll the bridge.**
The spike hand-rolled the postMessage/JSON-RPC bridge and it cost a deploy cycle (`clientInfo` vs `appInfo`) and left the frame mis-sized. The `App` client performs the exact `ui/initialize` handshake claude.ai validates before it un-hides the frame, and auto-sends `ui/notifications/size-changed` (autoResize). Alternative (hand-roll) rejected: it re-introduces the miswire/sizing traps the spike already paid for.

**2. New `packages/widgets/` package as the build target.**
A small workspace package with its own Vite config (mirroring the proof: `react()`, `tailwindcss()`, `viteSingleFile()`) that emits the single-file HTML string. The CSS entry replicates the app's chain — `@import "tailwindcss"; @import "@yamp/ui/theme.css"; @import "@yamp/ui/cookbook.css";` — **minus** the external Geist `@import`, with an absolute `@source` glob at `packages/ui/src` so Tailwind compiles the utilities used inside shared components. Being in-repo under `packages/*`, it resolves a single React via aube (no `dedupe` hack, unlike the out-of-workspace proof). Alternative (a `packages/worker/scripts/` step) rejected: a real package gives a clean, HMR-able Vite target consistent with `packages/app`/`packages/admin-app`. The worker imports the emitted HTML string and hands it to `registerAppResource`.

**3. Dedicated `display_recipe` tool; leave `read_recipe` untouched.**
`read_recipe` is called for internal reasoning (cook pre-flight, meal planning) — attaching `_meta.ui` there would force a card render on every read. A dedicated `display_recipe` (reusing `readRecipeDetail` internally) is the tool the agent calls when it wants to *show* a recipe. Its result carries `_meta.ui.resourceUri` → `ui://recipe/card` plus `structuredContent` (the recipe data) and a text `content` fallback. Alternative (bolt `_meta.ui` onto `read_recipe`) rejected on the noise argument above.

**4. Read-only render of frontmatter + markdown body.**
The card shows facets/times/dietary via `RecipeFacets` and the `body` rendered markdown→HTML. Alternatives: (a) agent-assembled structured payload like `recipe_display_v0` — rejected for v1 (model dependency + duplicates the built-in's lane); (b) parse the markdown into structured ingredients/steps inside the widget — deferred (fragile, unnecessary for a display card).

**5. No capability gating.**
Return `_meta.ui.resourceUri` unconditionally. `getUiCapability(getClientCapabilities())` reported `false` inside a *working* widget during the spike — the base SDK 1.29 strips the `extensions` field, so the probe is blind. Gating on it would suppress a widget that in fact renders.

**6. Serve over MCP `resources/read`.**
The `ui://recipe/card` resource is registered via `registerAppResource`; the HTML travels as a resource read, not an HTTP route — so no `wrangler.jsonc` `run_worker_first` entry is needed (confirmed by the spike).

**7. Ride the existing `cookbook.css` recipe-detail design for v1.**
The card reproduces an already-designed surface (the member app's recipe-detail page) in a new container, so it needs no new visual design and no round-trip through the companion Claude Design project. A distinct card-specific look, if wanted later, would go through that project per repo convention.

## Risks / Trade-offs

- **Bundle size (~160 KB gzip) shipped on every `resources/read`.** → Acceptable (well under any host limit; no repo-side cap). The MCP Apps spec separates the template resource from the per-call data specifically so hosts can cache the `ui://` template; if size becomes an issue, trim via a lighter markdown renderer or code-splitting. Note the number in `docs/ARCHITECTURE.md`.
- **claude.ai-web widget reliability (ext-apps #671-class "mounts but won't paint").** → The `App` client + correct handshake avoid the spike's self-inflicted failure; keep the tool's text `content` fallback so a non-render degrades to a readable text response rather than nothing.
- **External Geist font would break the zero-external-requests guarantee.** → Drop it; `theme.css` font stacks carry real system fallbacks (accepted minor visual delta). A self-hosted+inlined font is a later option if the look matters.
- **`read_recipe` returns markdown, not structured ingredients/steps.** → v1 is a read-only render; a structured, scalable card would be a separate change (and would likely lean on `recipe_display_v0` rather than re-implement it).
- **The iframe owns its own document, so it owns its theme.** → v1 sets a sensible default theme; reading the host's light/dark preference via the `App` bridge is a later enhancement.

## Migration Plan

Purely additive: a new `packages/widgets/` package, a new `display_recipe` tool + `ui://recipe/card` resource, and two dependencies (`@modelcontextprotocol/ext-apps` re-added to the worker; `vite-plugin-singlefile` dev). No D1 tables, migrations, or wrangler bindings change. Ships via the normal pipeline (merge to `main` → data-repo deploy). Rollback is a straight revert of the change. The diagnostic spike's removal is already committed on this branch.

## Open Questions

Surface for operator ratification before `/opsx:apply`:
- `packages/widgets/` package vs a `packages/worker/scripts/` build step (recommend the package).
- The `display_recipe` tool name and `structuredContent` shape (recommend as designed).
- Ride `cookbook.css` vs a Claude Design pass for the card layout (recommend ride for v1).
- v1 theme handling in the iframe — default to one theme now, host-preference sync later (recommend default now).
