## Context

The operator admin panel is ~8,400 lines of Elm across 7 areas (Status, Members, Dev/Tool Console, Logs, Config, Data, Usage), served as a committed static `elm.js` from the Worker's ASSETS binding behind Cloudflare Access, talking to ~30 hand-written `/admin/api/*` JSON endpoints in `src/admin.ts`. It is an internal, single-operator tool: no SEO, no SLA, tiny blast radius.

Elm's costs land hard in this specific repo:
- **Build tax.** The compiler needs `package.elm-lang.org` reachable, so a sandbox (including Claude Code's) often cannot rebuild the committed bundle — friction on every UI change in a coding-agent-first repo.
- **The seam.** 452 Elm lines touch JSON; 173 are pure decoder plumbing that hand-mirror the Worker's TS types with zero codegen. Elm's type safety stops exactly at this boundary — where the app's real risk lives.
- **Niche/frozen.** Elm 0.19.1 (2019); small ecosystem; weak LLM-assistant support.

The Worker *is* the backend: the admin operations already exist as plain TS functions (`recipeList(env)`, `loadDiscoveryConfig(env)`, `fetchUsage(env)`, member lifecycle in `admin.ts`, …). The Elm app reaches them the long way — an HTTP switch plus hand-written decoders. Rewriting to TypeScript on Hono, while the panel is still small, lets the UI call those functions directly, shares types end-to-end, and builds anywhere — without touching the determinism boundary.

## Goals / Non-Goals

**Goals:**
- Re-platform `admin/` from Elm to TypeScript on **Hono**, mounted **inside the existing Worker** where `handleAdmin` is called (`src/index.ts:69`).
- **SSR + islands:** server-render pages by calling `src/` functions directly; hydrate only the interactive regions as islands; islands update via Hono's `hc` typed RPC. One source of truth per operation across both transports.
- Kill the hand-mirrored decoder seam (zero codegen).
- Make the UI buildable in any sandbox (remove the `package.elm-lang.org` dependency).
- Preserve **every** observable behavior of the ported areas: Access gating, member lifecycle, corpus editors, calibration, discovery-log actions, Kroger-consent link.
- Port the `admin/CLAUDE.md` "impossible states impossible" discipline to TypeScript.
- Establish a thin JSX **component kit** (incl. a `Loadable` RemoteData primitive) the areas compose from; keep styling as global CSS.
- Add **Playwright** end-to-end + visual-regression tests in CI, emitting screenshot diffs as PR artifacts.

**Non-Goals:**
- No second Worker, no meta-framework (SvelteKit/HonoX/Vite). One deployable.
- No change to the determinism boundary, the `src/` operation functions, the D1 schema, or the MCP surface.
- No change to the panel's *observable capabilities* — this is a re-platform, not a feature change — **except** the Dev → Tool Console (MCP inspector), which is **dropped** (dedicated external MCP-inspector tooling covers it; it didn't earn its keep).
- SSR is **not a hard requirement**: a surface MAY ship islands-only (CSR) first and gain SSR later.

## Decisions

### 1. Hono as a library inside the existing Worker (not SvelteKit, not an SPA)
Hono is a router, not a Worker generator: it mounts under the existing `fetch` with `app.route('/admin', …)`, leaving `OAuthProvider` on top and the `email`/`scheduled` handlers untouched. **Alternatives rejected:** *SvelteKit as its own Worker* — it generates the Worker entry, colliding with `OAuthProvider`; the path of least resistance is a second Worker, which forces an A/B fork (either bind D1/R2/KV + the Kroger secret into a second Worker, splitting the determinism boundary across two deploys, or build an RPC layer). *Hono SPA-only* — loses the SSR win for the read-heavy half (Status/Data/Usage). One Worker, one binding set, one determinism boundary; no fork.

### 2. SSR for reads, islands for interactions
Read-heavy areas (Status, Data explorer, Usage) are **SSR-only** — no island, no client fetch. Interactive areas (Members, Calibration, corpus editors, Logs) are **SSR + island(s)**: the page and the island's initial props are server-rendered; the island hydrates from those props (no fetch on first paint) and uses `hc` for subsequent mutations/live-previews/incremental reads. An island is the smallest interactive *region* of a page, not necessarily the whole route.

### 3. `hc` is typed `fetch`, not a new protocol
`hc<AppType>()` infers request/response types from the Hono route definitions at compile time; at runtime it is plain JSON-over-HTTP — the same wire the Elm app uses today. **Not gRPC** (no protobuf, no HTTP/2, no codegen). The value is shared types, not a new transport. SSR props are typed by the `src/` function's return type; `hc` calls by the exported route type — both zero-codegen, both reflecting the same `src/` signatures.

### 4. `hono/jsx` + `hono/jsx/dom` as the view layer
The panel is hand-written functional CRUD styled with CSS (the existing hand-rolled stylesheet ports over), with **no design-system or Claude Design requirement**. So the view layer is Hono's own JSX: **`hono/jsx`** server-renders pages to HTML in the Worker, and **`hono/jsx/dom`** (~2–3 kB) hydrates the interactive islands — one mental model, Hono-native, **zero dependencies beyond `hono`**, and no new build tooling (the Worker's esbuild compiles JSX via a `tsconfig` `jsxImportSource`). **Read-only pages** (Status/Data/Usage) render with `hono/jsx` and ship **zero client JS**. **Interactive pages** add a `hono/jsx/dom` island + `hc`.

**Alternative rejected:** *React (`react-dom/server` + `react-dom/client`)* — its one advantage over `hono/jsx/dom` is the ability to run real React components from Claude Design or a React design system, which is explicitly out of scope; it would add `react` + `react-dom` for no benefit a hand-written panel uses. The view library is a leaf — Decision 3 keeps the data layer runtime-agnostic — so if a React design system is ever wanted later, swapping an island to Preact/React is a contained change, not a rewrite. The door isn't bolted shut.

### 5. Hand-rolled esbuild build (not HonoX/Vite)
Server JSX compiles via the Worker's existing esbuild through a `tsconfig` `jsx`/`jsxImportSource` setting — **zero new tooling**. Island bundles are built by a rewritten `scripts/build-admin.mjs` using **esbuild directly**, matching the repo's hand-rolled `build-*.mjs` culture, into the committed `admin/dist/` with the `--check` drift gate preserved. **Alternative rejected:** *HonoX (Vite-based islands meta-framework)* — reintroduces the meta-framework + Vite weight the repo rejected with SvelteKit. Hand-rolled adds one dependency (`hono`), builds in any sandbox, and keeps the build deterministic.

### 6. Access reused verbatim, one gate
`requireAccess` becomes Hono middleware unchanged. The panel stays on the same hostname's `/admin*`, so the existing edge Cloudflare Access application covers it with no new config and no second login. The opt-in / dev-bypass / email-allowlist posture is preserved exactly.

### 7. Impossible-states discipline in TypeScript
The modeling rules carry forward as discriminated unions: a 4-state `Loadable`/RemoteData union for remote data; one union for an in-flight mutation + its target + its failure; errors carried inside the failing variant. Exhaustiveness is enforced at compile time via `ts-pattern`'s `.exhaustive()` and an `assertNever` helper — **no new linter required** (the repo already runs `tsc --noEmit` strict). `admin/CLAUDE.md` is rewritten for the TS idiom.

### 8. Full SSR navigation + cross-document View Transitions
Navigation between areas is **full SSR** — no client-side router, no client route state (the SPA complexity the rewrite sheds). The app-like polish comes from the platform: **cross-document View Transitions** (`@view-transition { navigation: auto; }` in `styles.css`) animate every same-origin full-page navigation with **zero JS**, and a `view-transition-name` on the persistent shell (`<h1>` + nav) morphs it across navigations instead of flashing. Progressive enhancement: modern Chromium/Safari animate, older browsers fall back to an instant nav (no breakage) — ideal for a one-operator tool on a modern browser. **Alternative rejected:** *a client-side router* — reintroduces SPA route state + bundle for a polish the platform now provides for free over SSR.

### 9. Global CSS + a thin JSX component kit (no CSS Modules / CSS-in-JS)
The existing ~120-line stylesheet is extracted from the inline `<style>` into a **served `admin/dist/admin/styles.css`** (SSR has no single `index.html`), linked from a shared layout component and reachable for the View-Transition opt-in. Its semantic class vocabulary (`.card`, `.pill`, `.tier.<status>`, `.dialog`, …) and `:root` tokens stay **global** — for 120 lines on a one-operator tool, CSS Modules / CSS-in-JS / Tailwind are overhead with no payoff. A thin **component kit** (`admin/src/ui/`) of ~10–15 JSX primitives — `Card`, `Button`, `Pill`, `TierBadge`, `Dot`, `Dialog`, `Field`, `ErrorBanner`, `Table`, a layout, and a **`Loadable`** that renders the 4-state RemoteData union (Decision 7) — gives the real component win (composition, typed props, change-once) and co-locates each component's markup + class usage, while styling stays simple and global. The 7 areas compose from this kit.

### 10. Testing: vitest (logic) + Playwright visual snapshots in CI
Pure logic (route parsing, the Status/Logs render helpers, table-editor logic) is **vitest**, ported directly from the Elm tests. End-to-end + **visual regression** is **Playwright**, run in CI against a `wrangler dev` preview: `toHaveScreenshot()` with **committed baseline PNGs** (the repo's committed-artifact pattern), rendered inside the pinned Playwright container so local and CI match, with diff images uploaded as **CI artifacts on the PR** — so an agent-written PR carries before/after/diff screenshots as a first-class output. **No SaaS, no secret.** **Alternative noted:** *Percy/Chromatic* — a nicer inline-PR dashboard, but adds a hosted dependency + `PERCY_TOKEN` (and won't run on fork PRs); an optional upgrade, not the default.

## Risks / Trade-offs

- **A future React design system** → Out of scope now. If ever wanted, Decision 3's runtime-agnostic data layer makes swapping an island's renderer to Preact/React a contained change, not a re-architecture.
- **Loss of Elm's compiler-enforced totality** (TS allows escape hatches) → Discriminated unions + `ts-pattern` `.exhaustive()` + `assertNever`, under the existing strict `tsc`. The discipline was always the value; it ports.
- **Hydration/serialization boundary** (island props must be JSON-serializable to avoid hydration mismatch) → These functions are already JSON-serialized over `/admin/api/*` today, so they are effectively JSON-shaped; enforce JSON-serializable prop types at the island boundary.
- **Big-rewrite / partial-parity risk** → Build the Hono app to parity on the branch in phases; `/admin` cannot be served by both Elm and Hono at once, so cutover is a **single** flip (`handleAdmin` → `admin.fetch`) at the end. Rollback = revert that flip (the Elm bundle remains in history until the rip-out commit).
- **`hono/jsx/dom` is younger than React** → Validated on the Members + Logs islands (forms, dialogs, mutations via `hc`, one-at-a-time state) — well within range. A future strain on a complex island is a contained one-island swap to Preact/React (data layer untouched).
- **Visual-snapshot flakiness across environments** → Run Playwright snapshots inside the pinned Playwright container so local and CI render identically; commit the baselines like any other generated artifact, and review diffs as PR artifacts.

## Migration Plan

Phased on the feature branch; the Elm panel keeps serving `/admin` until the final cutover flip.

1. **Scaffold + Members thin vertical** — prove the whole pipeline (Hono mount, Access middleware, SSR-via-`src/`-call, one island, one typed route, esbuild build + `--check`, the component kit + served `styles.css` + View-Transition opt-in, the Playwright + visual-snapshot CI harness, vitest) on the smallest real CRUD surface, including the once-shown invite minting.
2. **Dev → Tool Console — DROPPED.** Not ported (external MCP-inspector tooling covers it; it didn't earn its keep). The `/admin/dev/*` area + `/admin/api/tools*` routes are removed at cutover. The island runtime is validated on the Members + Logs islands instead.
3. **Read-heavy areas (SSR-only)** — Status, Logs list, Data explorer (5 views), Usage. Big seam reduction, minimal/no islands.
4. **Remaining interactive areas (islands)** — Calibration (the form machine + analyze/dry-run/confirm-save), corpus editors (+ feed test), Logs actions (retry/delete + detail dialog).
5. **Cutover + cleanup** — flip `handleAdmin` → `admin.fetch`; remove `admin/elm.json`, `admin/src/*.elm`, `admin/tests/*.elm` and the Elm toolchain; finish `build-admin.mjs`; drop the `package.elm-lang.org` step from CI; rewrite `admin/CLAUDE.md` and update `docs/ARCHITECTURE.md` / `CONTRIBUTING.md` in lockstep.

**Rollback:** before the rip-out commit, reverting the single cutover flip restores the Elm panel. After rip-out, the Elm sources remain recoverable from git history.

## Open Questions

- **Incremental reads:** should any `/admin/api/data/*` read endpoints remain as typed routes for island-driven incremental fetches (e.g. opening a recipe detail without a full nav), or fully collapse into SSR navigations? Lean: collapse, and add a typed route only where an island genuinely needs to fetch without navigating.
- **SSR shell + island bootstrap:** how island props serialize into the page (a `<script type="application/json">` blob per island vs a data attribute) and whether islands ship as per-page bundles or one shared esbuild bundle. Lean: per-island JSON blob + per-entry esbuild bundles.
- **Auth expiry on island RPC:** a session that expires *after* load makes an `hc` call return 403 (the page-load case is handled cleanly at the edge). Islands should surface "session expired — reload" rather than a generic error. Lean: a shared `hc` error handler that detects the Access 403 and prompts a reload.
