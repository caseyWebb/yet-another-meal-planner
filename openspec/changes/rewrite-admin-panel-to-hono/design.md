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
- Preserve **every** observable behavior: Access gating, member lifecycle, tool console, corpus editors, calibration, discovery-log actions, Kroger-consent link.
- Port the `admin/CLAUDE.md` "impossible states impossible" discipline to TypeScript.

**Non-Goals:**
- No second Worker, no meta-framework (SvelteKit/HonoX/Vite). One deployable.
- No change to the determinism boundary, the `src/` operation functions, the D1 schema, or the MCP surface.
- No change to the panel's *observable capabilities* — this is a re-platform, not a feature change.
- SSR is **not a hard requirement**: a surface MAY ship islands-only (CSR) first and gain SSR later.

## Decisions

### 1. Hono as a library inside the existing Worker (not SvelteKit, not an SPA)
Hono is a router, not a Worker generator: it mounts under the existing `fetch` with `app.route('/admin', …)`, leaving `OAuthProvider` on top and the `email`/`scheduled` handlers untouched. **Alternatives rejected:** *SvelteKit as its own Worker* — it generates the Worker entry, colliding with `OAuthProvider`; the path of least resistance is a second Worker, which forces an A/B fork (either bind D1/R2/KV + the Kroger secret into a second Worker, splitting the determinism boundary across two deploys, or build an RPC layer). *Hono SPA-only* — loses the SSR win for the read-heavy half (Status/Data/Usage). One Worker, one binding set, one determinism boundary; no fork.

### 2. SSR for reads, islands for interactions
Read-heavy areas (Status, Data explorer, Usage) are **SSR-only** — no island, no client fetch. Interactive areas (Members, Tool Console, Calibration, corpus editors, Logs) are **SSR + island(s)**: the page and the island's initial props are server-rendered; the island hydrates from those props (no fetch on first paint) and uses `hc` for subsequent mutations/live-previews/incremental reads. An island is the smallest interactive *region* of a page, not necessarily the whole route.

### 3. `hc` is typed `fetch`, not a new protocol
`hc<AppType>()` infers request/response types from the Hono route definitions at compile time; at runtime it is plain JSON-over-HTTP — the same wire the Elm app uses today. **Not gRPC** (no protobuf, no HTTP/2, no codegen). The value is shared types, not a new transport. SSR props are typed by the `src/` function's return type; `hc` calls by the exported route type — both zero-codegen, both reflecting the same `src/` signatures.

### 4. React as the view layer (Claude Design is a React tool)
The design workflow is **Claude Design** (claude.ai/design): a design agent builds UI from **real React code**, and a synced design system is the customer's **compiled React components** (`.jsx`, `<Name>Props` `.d.ts`, a bundle exposing `window.<global>.*`), with the explicit promise that designs **map 1:1 onto code engineers can ship**. That 1:1 holds only if the panel ships React. So the view layer is **React**, not `hono/jsx/dom` (React-*like* ≠ React — it cannot run React components, breaking the mapping). **Alternatives rejected:** *`hono/jsx/dom`* — leanest, but cannot consume the synced/design-agent React components, defeating the workflow. *Preact + `preact/compat`* — a lighter near-miss, but a needless compromise when bundle weight is irrelevant for a one-operator tool and real React is the clean 1:1.

Hono is unchanged — it returns HTML strings, now produced by `react-dom/server` (the workerd/edge entry) and hydrated by `react-dom/client`. **Read-only pages** (Status/Data/Usage) are React **SSR with no hydration** — design-system components, zero client JS. **Interactive pages** add `react-dom/client` hydration of the island region + `hc`. This is exactly the runtime swap the runtime-agnostic data layer (Decision 3) was designed to absorb; esbuild bundles React with no new tooling. Tool Console stays an early port for its composition complexity, but React removes the dynamic-form *runtime* risk.

### 5. Hand-rolled esbuild build (not HonoX/Vite)
Server JSX compiles via the Worker's existing esbuild through a `tsconfig` `jsx`/`jsxImportSource` setting — **zero new tooling**. Island bundles are built by a rewritten `scripts/build-admin.mjs` using **esbuild directly**, matching the repo's hand-rolled `build-*.mjs` culture, into the committed `admin/dist/` with the `--check` drift gate preserved. **Alternative rejected:** *HonoX (Vite-based islands meta-framework)* — reintroduces the meta-framework + Vite weight the repo rejected with SvelteKit. Hand-rolled adds one dependency (`hono`), builds in any sandbox, and keeps the build deterministic.

### 6. Access reused verbatim, one gate
`requireAccess` becomes Hono middleware unchanged. The panel stays on the same hostname's `/admin*`, so the existing edge Cloudflare Access application covers it with no new config and no second login. The opt-in / dev-bypass / email-allowlist posture is preserved exactly.

### 7. Impossible-states discipline in TypeScript
The modeling rules carry forward as discriminated unions: a 4-state `Loadable`/RemoteData union for remote data; one union for an in-flight mutation + its target + its failure; errors carried inside the failing variant. Exhaustiveness is enforced at compile time via `ts-pattern`'s `.exhaustive()` and an `assertNever` helper — **no new linter required** (the repo already runs `tsc --noEmit` strict). `admin/CLAUDE.md` is rewritten for the TS idiom.

## Risks / Trade-offs

- **`react-dom/server` on workerd** → Use React's edge/worker server entry (`renderToReadableStream`/`renderToString` from the edge build), validated in the Phase-1 scaffold; well-trodden on Cloudflare Workers. Verify a representative design-system component renders + hydrates before the bulk.
- **Loss of Elm's compiler-enforced totality** (TS allows escape hatches) → Discriminated unions + `ts-pattern` `.exhaustive()` + `assertNever`, under the existing strict `tsc`. The discipline was always the value; it ports.
- **Hydration/serialization boundary** (island props must be JSON-serializable to avoid hydration mismatch) → These functions are already JSON-serialized over `/admin/api/*` today, so they are effectively JSON-shaped; enforce JSON-serializable prop types at the island boundary.
- **Big-rewrite / partial-parity risk** → Build the Hono app to parity on the branch in phases; `/admin` cannot be served by both Elm and Hono at once, so cutover is a **single** flip (`handleAdmin` → `admin.fetch`) at the end. Rollback = revert that flip (the Elm bundle remains in history until the rip-out commit).
- **Hardest island (Tool Console dynamic forms)** → Still ported second to surface composition issues early, but React handles dynamic forms natively, so this is a complexity checkpoint, not a runtime-ceiling risk.

## Migration Plan

Phased on the feature branch; the Elm panel keeps serving `/admin` until the final cutover flip.

1. **Scaffold + Members thin vertical** — prove the whole pipeline (Hono mount, Access middleware, SSR-via-`src/`-call, one island, one typed route, esbuild build + `--check`, vitest) on the smallest real CRUD surface, including the once-shown invite minting.
2. **Tool Console (complexity checkpoint)** — port the hardest island early to validate React island composition (dynamic schema-derived forms, the JSONC arg editor) and the `hc` invoke path before the bulk.
3. **Read-heavy areas (SSR-only)** — Status, Logs list, Data explorer (5 views), Usage. Big seam reduction, minimal/no islands.
4. **Remaining interactive areas (islands)** — Calibration (the form machine + analyze/dry-run/confirm-save), corpus editors (+ feed test), Logs actions (retry/delete + detail dialog).
5. **Cutover + cleanup** — flip `handleAdmin` → `admin.fetch`; remove `admin/elm.json`, `admin/src/*.elm`, `admin/tests/*.elm` and the Elm toolchain; finish `build-admin.mjs`; drop the `package.elm-lang.org` step from CI; rewrite `admin/CLAUDE.md` and update `docs/ARCHITECTURE.md` / `CONTRIBUTING.md` in lockstep.

**Rollback:** before the rip-out commit, reverting the single cutover flip restores the Elm panel. After rip-out, the Elm sources remain recoverable from git history.

## Open Questions

- **Component source** (the runtime is settled as React): where do the panel's components come from? (a) an existing React design system synced to Claude Design that the panel imports; (b) screens designed in claude.ai/design whose emitted React is shipped as the panel; (c) the admin component set built as its own syncable design system (`dist/` + usage examples). This affects follow-on tasks (a DS dependency, or structuring the components for a future `/design-sync`), not the core rewrite.
- **Incremental reads:** should any `/admin/api/data/*` read endpoints remain as typed routes for island-driven incremental fetches (e.g. opening a recipe detail without a full nav), or fully collapse into SSR navigations? Lean: collapse, and add a typed route only where an island genuinely needs to fetch without navigating.
- **Inter-area navigation:** full SSR navigations between areas (simplest, fine for an internal tool) vs. client-side nav. Lean: full SSR navigation; revisit view-transitions only if the operator UX warrants it.
