## Context

The operator panel (`src/admin/`) is a Hono app: SSR pages (`hono/jsx`) calling the Worker's `src/` functions directly, with interactivity hydrated as islands (`hono/jsx/dom`) over typed `/admin/api/*` routes. It is already on Basecoat (the Vega pack) and the orange operator theme. A Claude Design handoff reimagines every area; those land as separate downstream changes. This change builds only the shared shell + component vocabulary they all depend on, so the per-area changes stay small and consistent.

The design source is the handoff bundle (a React/Babel SPA mock with `*-data.jsx` fixtures and a `_ds_bundle.js` exposing React components). It is a *visual* reference: the README directs recreating its look in whatever tech fits the target — here, Basecoat-class + Tailwind primitives in `kit.tsx`, not React. The mock's `window.GA.*` screen-switching is a design-tool artifact; the panel keeps SSR multi-document navigation.

## Goals / Non-Goals

**Goals:**
- Add a **Discovery** top-level area slot (nav entry + a server-rendered placeholder route), so the downstream Discovery change only fills a body.
- Relocate the **healthy/degraded rollup** from the Status page into a **global corner health dock** rendered by the shell on every area, wired to the existing `buildHealthPayload`.
- Grow `kit.tsx` with the **shared primitives** the mock reuses across areas (Item/ItemGroup, Avatar, DropdownMenu, Slider, Switch, Progress, richer Table, stat-card grid, pager, pills, sparkline + hover-tip), in Basecoat-idiom with island-held interactivity.
- Add the **bespoke layout CSS** to `styles.css` that Basecoat lacks (stat tiles, status dots/glyphs, pills, sparkline tracks, the health dock).

**Non-Goals:**
- Any per-area content (Status/Members/Data/Recipes/Stores/Guidance/Usage/Discovery/Logs/Config bodies) — each is its own change.
- Any new Worker reader, route, or per-tenant data — the dock reads the existing health payload.
- Moving to client-side SPA routing; pixel-matching the mock's exact whitespace beyond the layout primitives.
- Backfilling data gaps (hybrid search, uptime history, KV-by-namespace) — those belong to the area changes that need them.

## Decisions

**1. The health dock is an island reading SSR-seeded health, not a fetch-on-mount.**
The shell calls `buildHealthPayload` server-side (the Status page already does) and emits the rollup into a `<script type="application/json">` props block; the dock island hydrates from it for the expand/collapse popover. This matches the panel's "first paint carries the data; islands seed from a props block, never fetch-on-mount" rule. The dock needs an island only because it has a popover (interactivity) and rides on every page — a pure-CSS pill with no detail could be SSR-only, but the mock's expandable summary wants island state.
*Alternative considered:* fetch `/health` from the client (the pre-Hono model). Rejected — re-introduces a client decoder and a load-state the SSR path already eliminates.
*Alternative considered:* SSR-only dock, no island. Rejected — loses the expandable failing-jobs/deps popover the mock shows.

**2. The dock is mounted by `Layout`, so it is structurally on every area.**
`Layout` already wraps every page; adding the dock mount there (after `children`) guarantees presence without each page opting in. `Layout` gains the health rollup as a prop the route supplies (every route already has `c.env` to build it), keeping the shell dumb about *how* health is fetched.
*Alternative considered:* each page renders its own dock. Rejected — duplication and drift; the requirement is "every area," which is a shell concern.

**3. Discovery ships as nav entry + placeholder only.**
Add `{ href: "/admin/discovery", label: "Discovery" }` to `AREAS` and a route returning a server-rendered "coming soon" shell. This satisfies the area-nav requirement and lets the downstream change land purely as a body, with the IA already in place. The existing Discovery *content* (today the Logs page + a Data sub-tab) is untouched by this change.

**4. Kit primitives mirror the mock's `_ds_bundle` surface, but as Basecoat idiom.**
Each mock component maps to a `kit.tsx` primitive: `Item`/`ItemGroup` → a Basecoat list-row composition; `Avatar` → initials in a styled figure; `DropdownMenu`/`Slider`/`Switch` → Basecoat CSS components with island-driven state; `Progress`/`Table` → Basecoat's `progress`/`table`; stat-card/pager/pills/sparkline → panel-specific layout classes. Presentational primitives (no handlers) stay in `kit.tsx` (SSR-safe); the interactive ones expose the markup + data attributes an island wires up, never loading Basecoat's component JS (it would fight island DOM reconciliation).
*Alternative considered:* port `_ds_bundle.js` verbatim as a React-in-browser bundle. Rejected — wrong runtime, violates the zero-JS-for-reads and no-Basecoat-JS rules.

**5. `styles.css` grows by layout-only additions, gated to what Basecoat genuinely lacks.**
The mock's bespoke CSS (stat tiles, `.dot`/`.sglyph` status glyphs, redesigned `.pill`, `.spark`/sparkline tracks, the `.health-dock`/`.health-pop`) has no Basecoat equivalent, so it lands in `styles.css` under `@layer components`, per the styling discipline. Anything Basecoat already provides (buttons, cards, inputs, badges, alerts, tables, dialogs, progress) is composed, not re-authored. The mock's `:root` accent overrides already match the panel theme.

## Risks / Trade-offs

- **[Kit churn risk: building primitives before their consumers exist.]** → Ground each primitive in the mock's concrete usage (the `*Screen.jsx` files read during explore show exact props/markup), and treat the first downstream area change (Status) as the validation that the kit shape is right; adjust the kit there if a primitive doesn't fit, before five areas depend on it.
- **[The dock duplicates health detail the Status page also renders.]** → They share one `buildHealthPayload` call and one rollup shape; the dock shows the *rollup* + a compact failing/deps summary, the Status page shows the *full* per-job detail. No second data source, so no drift — only a presentation split.
- **[`styles.css` growth conflicts with "add sparingly."]** → Constrain additions to layout Basecoat lacks; review each rule against an existing Basecoat component first. The additions are the shared chrome, not per-area styling (which stays in the area changes).
- **[Spec says "client-side routing" in a title but the panel is SSR.]** → Pre-existing wording; the requirement body already mandates SSR. This change does not re-title it (out of scope) — it only extends the area list and relocates the rollup.

## Migration Plan

1. Land `kit.tsx` primitives + `styles.css` additions (no behavior change to existing pages — purely additive).
2. Add the Discovery nav entry + placeholder route.
3. Add the health-dock island and mount it in `Layout`; thread the rollup prop from each route.
4. Remove the overall headline from the Status page body (it now lives in the dock); keep the per-job/D1/posture detail.
5. `aubr build:admin` (esbuild picks up the new island; Tailwind recompiles `styles.css`), `aubr typecheck` (both SSR + DOM passes), `aubr test`.

Rollback is a revert — no data migration, no Worker route or schema change.

## Open Questions

- Should the dock's popover also show the **live dependency** rows (D1 probe, admin gate), or only the failing jobs? The mock shows both; leaning toward both since the payload already carries them.
- Does the Status area keep a small inline health summary at the top, or rely entirely on the dock for the rollup? Leaning toward dock-only for the rollup (per the spec relocation) while Status keeps the detailed rows.
