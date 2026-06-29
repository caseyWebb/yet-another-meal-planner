## Why

The operator admin panel is ~8,400 lines of Elm whose type-safety guarantee stops at the `/admin/api/*` JSON boundary — exactly where this single-operator internal tool's risk lives — while its costs land hard in a coding-agent-first repo: the Elm compiler needs `package.elm-lang.org` reachable, so a sandbox (including Claude Code's) often **cannot rebuild** the committed bundle; every API shape is **hand-mirrored** as an Elm decoder with no shared types (173 lines of pure decoder plumbing, zero codegen); and the language is niche and frozen (0.19.1, 2019). Rewriting to TypeScript on **Hono** — while the panel is still small enough to port in phases — shares types end-to-end with the Worker, builds in any sandbox, and collapses the hand-written API+decoder seam, all without touching the determinism boundary.

## What Changes

- Replace the Elm SPA (`admin/src/**/*.elm`, `Browser.application`, `elm make`) with a **TypeScript admin app on Hono**, mounted inside the existing Worker where `handleAdmin` is called today (`src/index.ts:69`) — **no second Worker, no new deploy surface, one binding set, one determinism boundary**.
- **Rendering: SSR + islands, in React.** Pages are server-rendered with React (`react-dom/server`) inside the Hono Worker; the genuinely-interactive consoles (Calibration, Tool Console, Table/corpus editors, Members lifecycle) hydrate as React **islands** (`react-dom/client`). React because the design workflow is **Claude Design**, which is React-based (designs render from real React and map 1:1 onto shippable code — see design.md Decision 4). SSR is a nice-to-have, not a gate — a surface MAY ship islands-only (CSR) first.
- **Data flow.** Initial reads are SSR'd by calling the existing `src/` functions directly (no fetch, no decoder); island interactions (mutations, live previews) use Hono's `hc` **typed RPC client**. Both transports call the *same* `src/` functions — one source of truth, zero codegen on both paths.
- **Build.** Rewrite `scripts/build-admin.mjs` from `elm make` to a hand-rolled **esbuild** island bundler (matching the repo's hand-rolled `build-*.mjs` culture); server JSX compiles via the Worker's existing esbuild through a `tsconfig` `jsx` setting. Keep the committed `admin/dist/` bundle and the `--check` drift gate. **BREAKING** for the build toolchain (Elm removed) — invisible to operators.
- Reuse `requireAccess` **verbatim** as Hono middleware; preserve every Access-gating, onboard/revoke/rotate, tool-console, corpus-editor, calibration, discovery-log, and Kroger-consent behavior.
- Port the `admin/CLAUDE.md` "make impossible states impossible" discipline to **TypeScript discriminated unions** + a `Loadable`/RemoteData type, kept honest with `ts-pattern` exhaustiveness and an eslint exhaustiveness rule; rewrite `admin/CLAUDE.md` for the TS idiom.
- Remove the Elm toolchain: `admin/elm.json`, `admin/src/*.elm`, `admin/tests/*.elm`, and the `package.elm-lang.org` build dependency (and its CI reachability concern).

## Capabilities

### New Capabilities
<!-- None. The panel's observable capabilities are preserved; this is an implementation re-platform. -->

### Modified Capabilities
- `operator-admin`: the panel's **rendering model** (Elm `Browser.application` SPA → Hono SSR + hydrated islands), its **build** (`elm make` → esbuild islands + server JSX), and its **data-modeling discipline** (Elm `RemoteData`/custom types → TypeScript discriminated unions) change. Access gating, member lifecycle, the tool console, the shared-corpus editors, discovery calibration, the discovery-log actions, and the Kroger-consent link are **behavior-preserved**.

## Impact

- **Code:** `admin/` re-platformed (Elm → TS + Hono JSX). `src/admin.ts`'s `routeAdminApi` reshaped — read endpoints collapse into SSR page handlers; mutation/preview endpoints become typed Hono routes; `handleAdmin` becomes the Hono app's `fetch`. The `src/` data/operation functions (`admin-data.ts`, `admin-corpus.ts`, `operator-config.ts`, `discovery-calibration.ts`, member lifecycle in `admin.ts`, `usage.ts`) are **unchanged** and called directly by SSR handlers and by the typed routes alike.
- **Build/CI:** `scripts/build-admin.mjs` rewritten (esbuild); `aubr build:admin --check` drift gate preserved; the `package.elm-lang.org` reachability requirement is **removed**. `tsconfig.json` gains `jsx`/`jsxImportSource` (React). New dependencies: `hono`, `react` + `react-dom` (the view layer — Claude Design is React-based, so the panel ships React for 1:1 mapping with designs).
- **Dependencies removed:** the Elm toolchain (`admin/elm.json`, the pinned `elm` compiler, `elm-explorations/test`).
- **Determinism boundary:** unchanged — one Worker, one binding set; data still flows through `src/db.ts` and `src/corpus-store.ts`. There is no `/admin/api/*` consumer outside the panel, so reshaping that surface is purely internal.
- **Docs:** `admin/CLAUDE.md` rewritten for the TS discipline; `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` admin-build references updated; the `operator-admin` spec delta in this change. The `repo-structure` layout (sources in `admin/src/`, committed build in `admin/dist/`) stays true.
