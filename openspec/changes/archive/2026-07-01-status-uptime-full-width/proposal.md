## Why

On the operator Status area, each background-job row shows a run-history uptime sparkline (`Uptime` in `src/admin/pages/status.tsx`, built on the shared `SparklineTrack` primitive in `src/admin/ui/kit.tsx`). The sparkline does not fill the row: at a full 30-run window it renders a compact band pinned to the right with a large dead gap on the left, and the "Run history … % uptime · N runs" head plus the "OLDER … NOW" axis (which span the full row) float far to the left of where the bars actually begin. It reads as a broken layout.

The gap is deliberate today. `styles.css` caps the track at `max-width: 22rem`, pushes it right with `margin-left: auto`, right-aligns the bars with `justify-content: flex-end`, and caps each bar at `max-width: 10px`. The comment states the intent: "an under-populated series doesn't stretch to fill the row" — so a job with only 3 of 30 runs shows 3 normal-width bars flush-right rather than 3 fat bars smeared across the whole row. The side effect is that the **fully-populated** case (30 runs, the common one) also refuses to fill the width, and the head/axis captions misalign with the track.

## What Changes

- **NEW** the run-history uptime sparkline SHALL span the full width of the job row's body instead of a fixed `22rem` right-pinned band. The head ("Run history … % uptime · N runs") and the OLDER/NOW axis then align with the track's edges because all three span the same width.
- **NEW** a **fixed-slot, ghost-padded** track: the track always renders `STATUS_SPARKLINE_WINDOW` (30) slots. A job with fewer than 30 real runs pads the **older** (left) side with non-interactive placeholder ("ghost") slots so the track fills the width at any population and the newest run stays anchored at the right (NOW) edge. This preserves the original "don't stretch a sparse series into fat bars" intent — a sparse series shows real bars flush-right against ghost slots, not a handful of stretched bars — while still filling the width.
- **NEW** ghost slots are presentational only: no run id, no Logs deep-link, no hover tooltip — a faint muted bar distinct from the ok/fail colors. The `% uptime` and `N runs` labels continue to count **real** runs only; ghosts are not counted.
- **UNCHANGED** a job with **zero** run history still renders without a sparkline at all (not an empty/ghost-only track) — the existing "no run history omits the sparkline" behavior holds.
- **UNCHANGED** real-run bars keep their ok/fail coloring, oldest→newest order, `% uptime` label, hover tooltip, and Logs deep-link (`/admin/logs?run=<id>`); the deep-link and pruned-id fallback behavior is unchanged for real bars.
- **OUT OF SCOPE** the ghost-slot visual treatment beyond "a faint muted bar" (exact tint/height/opacity) is captured as a sensible default here rather than routed through the companion Claude Design project; it can be refined there later without changing this contract.

## Capabilities

### Modified Capabilities

- `operator-admin`: the "Status job rows show run-history uptime and current-state-since" requirement gains full-width fill + fixed-slot ghost padding (newest-anchored, real-run-only labels); the "A Status sparkline tick deep-links to its Logs entry" requirement is scoped so that only real-run bars are links (ghost slots carry no run and are not links).

## Impact

- **`src/admin/styles.css`** (`~242–251`): remove `max-width: 22rem; margin-left: auto` from `.spark-track-wrap` and `.spark-axis`; remove `max-width: 10px` from `.spark-seg-tip` so bars `flex: 1 1 0` fill the track (≈18px each at 30 slots in the 44rem column); add a `.spark-seg-tip.ghost` (or equivalent) faint-muted style distinct from `.ok`/`.fail`.
- **`src/admin/ui/kit.tsx`** (`SparklineTrack`, `TipSegment`): add a target-slot count (a `slots?` prop) and a `"ghost"`/`"empty"` segment state; ghost segments render as a non-interactive `<span>` (no `<a>`, no `data-tip-*`).
- **`src/admin/pages/status.tsx`** (`Uptime`): pad the segment list on the older/left side up to the window with ghost segments; keep `% uptime` / `N runs` computed from real runs. The window (30) is threaded from `src/admin/app.tsx`'s `STATUS_SPARKLINE_WINDOW` (either exported and imported, or passed down as a prop).
- **Single consumer:** `SparklineTrack` and the `.spark-track*` CSS are used only by the Status uptime block, so the change is status-page-local (the `.spark-col`/`.spark-bar` primitives used elsewhere are untouched).
- **Build/verify:** `aubr build:admin` (Tailwind-compile + esbuild islands), `aubr typecheck`, `aubr test`. No new client JS — the page stays SSR with the existing hover-tooltip progressive-enhancement script.
- **No data/schema/tool changes:** `readJobRuns`, `job_runs`, `docs/SCHEMAS.md`, and `docs/TOOLS.md` are unaffected. `STATUS_SPARKLINE_WINDOW` stays 30.
