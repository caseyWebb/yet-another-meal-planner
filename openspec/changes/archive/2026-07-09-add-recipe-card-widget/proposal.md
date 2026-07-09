## Why

The MCP Apps diagnostic spike proved that claude.ai renders interactive bespoke widgets from our self-hosted custom connector (a `ui://` iframe, `structuredContent` hydration, and the `tools/call` bridge all worked). That unlocks a new presentation surface: deterministic, branded UI rendered inline in the Claude conversation, hydrated by a tool's structured output — a natural fit for the repo's thesis that deterministic work lives in the Worker's tools. This change graduates the spike into the first real bespoke widget: a **read-only recipe card** members can glance at inline, branded with our own `packages/ui`, without leaving the chat.

## What Changes

- **New single-file widget build target.** A Vite build (`@vitejs/plugin-react` + `@tailwindcss/vite` + `vite-plugin-singlefile`) that emits ONE self-contained HTML string — all JS + CSS inlined, **zero external network requests**, ~160 KB gzip (proven). It bundles the canonical `@modelcontextprotocol/ext-apps` `App` client (the widget↔host bridge — **not** hand-rolled; the spike proved hand-rolling is a miswire trap) and reuses `packages/ui` (`Card`, `RecipeFacets`) + the `theme.css`/`cookbook.css` token layer, minus the external Geist font `@import`.
- **New `display_recipe` MCP tool.** Dedicated (so `read_recipe` stays a pure data read and internal reads don't force a card). It reuses `readRecipeDetail` internally and returns `_meta.ui.resourceUri` (referencing `ui://recipe/card`) plus `structuredContent` — the recipe's frontmatter facets/times/dietary and its markdown `body`.
- **New `ui://recipe/card` resource**, registered via `@modelcontextprotocol/ext-apps/server` (`registerAppResource`, MIME `text/html;profile=mcp-app`), served over MCP `resources/read`. No new Worker HTTP route, so **no `run_worker_first` entry** (spike-confirmed).
- **Read-only scope (v1).** The card renders `read_recipe`'s frontmatter + markdown body; it deliberately does NOT do servings-scaling or step timers — that is claude.ai's built-in `recipe_display_v0`, which `read_recipe` cannot feed anyway (no structured `ingredients[]`/`steps[]`, only name-only `ingredients_key` arrays + free-text body).
- **Dependencies.** Re-add `@modelcontextprotocol/ext-apps` (^1.7.4, removed by the spike revert) as a real package dependency; add `vite-plugin-singlefile` as a dev dependency.
- **Removes the diagnostic spike.** `hello_widget`/`echo`/`ui://hello/card` and the throwaway wiring are removed (already committed on this branch as the spike revert).

## Capabilities

### New Capabilities
- `recipe-card-widget`: The bespoke in-chat recipe card — the single-file widget build target (self-contained, zero-external-request HTML that bundles the ext-apps `App` client + reuses `packages/ui`), the `ui://recipe/card` resource served over MCP `resources/read`, and the `display_recipe` tool that returns the widget-bearing result. Establishes the reusable pattern (App-client bridge, no capability gating, `resources/read` serving) that later bespoke widgets extend.

### Modified Capabilities
<!-- None. `read_recipe` is unchanged (display_recipe reuses its reader without altering its contract). The spike revert restores prior behavior and needs no requirement change. -->

## Impact

- **Build tooling** — a new widget build target (recommended: a small `packages/widgets/` workspace package with its own Vite config producing the HTML string; alternative: a `packages/worker/scripts/` step). New deps: `@modelcontextprotocol/ext-apps` (worker), `vite-plugin-singlefile` (dev).
- **Worker MCP surface** — `packages/worker/src/tools.ts` (register `display_recipe` + the `ui://recipe/card` resource); the built HTML string is imported and handed to `registerAppResource`.
- **Docs (lockstep)** — `docs/TOOLS.md` (the `display_recipe` tool + the bespoke `ui://recipe/card` widget, alongside the `recipe_display_v0` built-in section), `docs/ARCHITECTURE.md` (the in-chat widget rendering surface + the widget build target + how the HTML string is produced and served), `docs/SCHEMAS.md` (the `display_recipe` `structuredContent` shape).
- **Tests** — a widget wiring test (mirroring the reverted `hello-widget-spike.test.ts`: `display_recipe` carries `_meta.ui.resourceUri`, `ui://recipe/card` reads back with the mcp-app MIME, `structuredContent` shape) and a build-target check that the emitted HTML is self-contained (no external URLs).
- **No D1 / migrations / wrangler binding changes.** Serving is over MCP `resources/read`, not a new HTTP route.
