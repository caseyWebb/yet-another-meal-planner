## Why

A handoff design (Claude Design) reimagines the operator panel across every area: a slimmer Status page, a roster-and-detail Members area, purpose-built Data explorers, a promoted top-level Discovery area, richer Usage/Logs/Config surfaces, and a persistent corner health indicator. Those area redesigns are large and will land one at a time — but they all import the same shell and the same visual vocabulary. This change builds that shared foundation first, so each downstream area change stays small and visually consistent instead of re-deriving the chrome.

## What Changes

- **Top-level area nav gains a Discovery slot.** Discovery becomes its own top-level area (`/admin/discovery`) alongside Status, Members, Data, Usage, Logs, Config. This change adds the nav entry and an empty routed placeholder page only; the candidate-pipeline content is a downstream change.
- **The service-health rollup moves out of the Status page into a global health dock.** A fixed bottom-right corner pill, rendered on *every* admin page by the shell, surfaces the overall Healthy/Degraded state (and a failing-job count) from the existing `buildHealthPayload`. The Status home view stops owning the headline. **BREAKING** (spec-level): the "Status homepage surfaces service health" requirement no longer carries the overall headline — it relocates.
- **A shared Basecoat JSX component kit** grows `src/admin/ui/kit.tsx` with the presentational primitives the redesign mock uses across areas: list items (`Item`/`ItemGroup`), `Avatar`, a `DropdownMenu` (island-driven), `Slider`, `Switch`, `Progress`, a richer `Table`, and `Dialog`/`Field` refinements — plus panel primitives the mock leans on everywhere: the stat-card grid, the pager, sub-nav pills, and a sparkline + hover-tooltip pair. All emitted in Basecoat-class + Tailwind idiom per `src/admin/CLAUDE.md` (no Basecoat component JS; interactivity stays in islands).
- **`styles.css` gains the bespoke layout** the mock needs that Basecoat does not define: the stat tiles, status dots/glyphs, the redesigned pills, sparkline tracks, and the health dock — kept to layout-only additions per the styling discipline.
- **Out of scope (downstream changes):** every per-area body — Status content, Members, Data (Recipes/Stores/Guidance), Usage, Discovery, Logs, Config. Navigation stays **SSR multi-document** (no client SPA); the mock's single-page structure is a design-tool artifact, not a target.

## Capabilities

### New Capabilities
<!-- None — the foundation extends the existing operator-admin shell rather than introducing a new capability. -->

### Modified Capabilities
- `operator-admin`: the top-level area set gains a **Discovery** area; the overall healthy/degraded **rollup relocates** from the Status home view to a **persistent global health indicator** present on every area; the Basecoat visual layer **provides a shared component kit** of redesign primitives the area surfaces compose from.

## Impact

- **Code:** `src/admin/ui/layout.tsx` (nav entries + health-dock mount), `src/admin/ui/kit.tsx` (new primitives), `src/admin/styles.css` (new layout rules), `src/admin/app.tsx` (the `/admin/discovery` placeholder route), and a new health-dock island under `src/admin/client/` (the dock's expand/collapse popover).
- **Data/Worker:** none new — the dock reads the existing `buildHealthPayload`; no new route, secret, or per-tenant data.
- **Downstream:** unblocks the per-area redesign changes (Status, Members, Data, Usage, Discovery, Logs, Config), each of which imports this kit and shell.
- **Build:** `aubr build:admin` picks up the new island automatically (esbuild per `client/*.tsx`); `styles.css` recompiles via Tailwind.
