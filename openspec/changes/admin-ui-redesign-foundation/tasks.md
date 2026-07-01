## 1. Component kit primitives

- [x] 1.1 Add list primitives to `src/admin/ui/kit.tsx`: `Item` (media + title + description + actions slots) and `ItemGroup`, emitting Basecoat list-row markup + Tailwind layout
- [x] 1.2 Add `Avatar` (initials fallback in a styled figure) and a richer `Table` (column specs with right-align + cell nodes) to `kit.tsx`
- [x] 1.3 Add `Progress` (Basecoat `progress`) and `Slider` (Basecoat range input) presentational primitives to `kit.tsx`
- [x] 1.4 Add panel layout primitives to `kit.tsx`: `StatCardGrid`/`StatCard` (icon + label + value, optional nav affordance), `Pager` (prev/next + range label), and refine `Pill` for the redesigned sub-nav
- [x] 1.5 Add the `Sparkline` primitive and the fixed-position hover-tooltip CSS foundation (`.bar-tip`) the mock shares across Status/Usage (the island-side `useTip` hook lands with its first consumer downstream, since the tooltip is inherently client-driven)
- [x] 1.6 Refine `Dialog`/`Field` and add `Switch` and `DropdownMenu` markup shells whose open/change behavior is wired by an island (no Basecoat component JS)

## 2. Stylesheet additions

- [x] 2.1 Add the stat-tile layout to `src/admin/styles.css` (`.stat-grid`/`.stat-card`/`.stat-*`, including the clickable `stat-card-link` affordance) under `@layer components`
- [x] 2.2 Add status glyph/dot styles (`.dot.ok/.fail/.never`, `.sglyph`, status words) and the redesigned `.pill`/`.data-nav` rules
- [x] 2.3 Add the sparkline + hover-tooltip styles (`.spark`/`.spark-bar`, `.bar-tip` and variants)
- [x] 2.4 Add the health-dock styles (`.health-dock`/`.health-pill`/`.pulse-dot`/`.health-pop` and the popover internals), including the reduced-motion guard

## 3. Discovery area slot

- [x] 3.1 Add `{ href: "/admin/discovery", label: "Discovery" }` to `AREAS` in `src/admin/ui/layout.tsx`, ordered Status · Members · Data · Usage · Discovery · Logs · Config
- [x] 3.2 Add a server-rendered `GET /admin/discovery` route in `src/admin/app.tsx` returning a placeholder shell (so the IA exists; the body is a downstream change)

## 4. Global health dock

- [x] 4.1 Add `src/admin/ui/health-dock.tsx`: the `HealthRollup` shape (in `shared.ts`), a `buildHealthRollup(payload)` derivation, and the SSR dock pill component + a `renderHealthDock(rollup)` string helper
- [x] 4.2 Add an `app`-level shell middleware (after the access gate) that builds `buildHealthPayload(c.env, HEALTH_JOBS)` for `text/html` responses and injects the dock (SSR pill + JSON props block + island script) before `</body>` — one chokepoint, no per-route threading, no new Worker route
- [x] 4.3 Add a `src/admin/client/health.tsx` island that hydrates the injected dock from its props block for the expand/collapse popover (failing jobs + dependency rows + a link to Status)
- [x] 4.4 Derive healthy/degraded from the payload's `ok`; render the failing-job count when degraded and treat an `exposed` admin gate as degraded

## 5. Status page relocation

- [x] 5.1 Remove the overall healthy/degraded headline from `src/admin/pages/status.tsx`; keep the per-job rows, the D1 reachability row, and the admin gate posture (incl. the prominent `exposed` warning)

## 6. Build, typecheck, and verify

- [x] 6.1 Run `aubr build:admin` and confirm the new `health` island bundles and `styles.css` recompiles (esbuild + Tailwind, no registry fetch)
- [x] 6.2 Run `aubr typecheck` (both SSR + `client/` DOM passes) and `aubr test`; fix any fallout
- [x] 6.3 Run `openspec validate "admin-ui-redesign-foundation"` and confirm the change is apply-complete
