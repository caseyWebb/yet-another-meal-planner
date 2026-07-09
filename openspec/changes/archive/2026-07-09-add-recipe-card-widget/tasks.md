## 1. Dependencies & scaffolding

- [x] 1.1 Re-add `@modelcontextprotocol/ext-apps@^1.7.4` to `packages/worker/package.json` dependencies (removed by the spike revert).
- [x] 1.2 Scaffold a `packages/widgets/` workspace package: `package.json` (`workspace:*` on `@yamp/ui`, plus `@modelcontextprotocol/ext-apps`, `react`, `react-dom`; `vite-plugin-singlefile` + `vite`/`@vitejs/plugin-react`/`@tailwindcss/vite` as dev deps), registered in `pnpm-workspace.yaml`.
- [x] 1.3 `aube install` and confirm the lockfile updates with the new deps.

## 2. Widget build target

- [x] 2.1 Add the widget `vite.config` — plugins `[react(), tailwindcss(), viteSingleFile()]`, `build.target: "esnext"`, `cssCodeSplit: false` — modeled on the proven proof-build config (no `dedupe` needed in-repo since aube provides a single React).
- [x] 2.2 Add the CSS entry replicating the app's chain — `@import "tailwindcss"; @import "@yamp/ui/theme.css"; @import "@yamp/ui/cookbook.css";` — WITHOUT the external Geist `@import`, with an absolute `@source` glob at `packages/ui/src`.
- [x] 2.3 Decide + implement how the emitted HTML reaches the Worker (recommend: a build step that writes the single-file HTML as a string module the worker imports); add a `build:widgets` script.
- [x] 2.4 Build the widget and confirm the output is one self-contained HTML with zero external URLs.

## 3. Recipe card view

- [x] 3.1 Build the card React component: hydrate from `structuredContent` and render title, facet chips (`RecipeFacets` from `packages/ui`), total time + dietary, and the recipe body, reusing `packages/ui` primitives + `cookbook.css` classes.
- [x] 3.2 Render the markdown `body` → HTML safely (reuse the member app's markdown renderer or an equivalent pure-JS renderer).
- [x] 3.3 Wire the ext-apps `App` client: `connect()`, set `ontoolresult` to hydrate before connect, rely on autoResize; set a default theme on the iframe document.

## 4. Worker MCP surface

- [x] 4.1 Define the `display_recipe` `structuredContent` type (title, description, time_total, dietary, tags, protein, cuisine, course, requires_equipment, favorite, body) in a shared shape module.
- [x] 4.2 Register the `ui://recipe/card` resource via `@modelcontextprotocol/ext-apps/server` `registerAppResource` (MIME `text/html;profile=mcp-app`), serving the built HTML string.
- [x] 4.3 Register the `display_recipe` tool via `registerAppTool`: reuse `readRecipeDetail`, return `_meta.ui.resourceUri` + `structuredContent` + a text `content` fallback; structured `not_found` on a missing slug; no capability gating.

## 5. Tests

- [x] 5.1 Wiring test (mirror the reverted `hello-widget-spike.test.ts`): `display_recipe` carries `_meta.ui.resourceUri`; `ui://recipe/card` reads back with the mcp-app MIME; the `structuredContent` shape; `not_found` on a bad slug.
- [x] 5.2 Build-target check: the emitted widget HTML contains no external stylesheet/script/font/asset URLs (self-contained).

## 6. Docs lockstep

- [x] 6.1 `docs/TOOLS.md` — document `display_recipe` and the bespoke `ui://recipe/card` widget (near the `recipe_display_v0` built-in section, distinguishing bespoke vs harness-provided).
- [x] 6.2 `docs/ARCHITECTURE.md` — the in-chat widget rendering surface, the `packages/widgets/` build target, serving via `registerAppResource`, and the ~160 KB gzip bundle-size note.
- [x] 6.3 `docs/SCHEMAS.md` — the `display_recipe` `structuredContent` shape.

## 7. Verify & finalize

- [x] 7.1 Run `aubr typecheck`, worker `test` (incl. the new wiring test), and `build:widgets`; confirm `buildServer` still builds with the new tool/resource.
- [x] 7.2 Drive the widget end-to-end — render it in the ext-apps multi-host inspector (wiring-correct, host-independent) and/or have the operator connect the deployed server and invoke `display_recipe` in claude.ai.
- [x] 7.3 Confirm the diagnostic spike removal is intact (`hello_widget`/`echo`/`ui://hello/card` gone) and no dangling references remain.
