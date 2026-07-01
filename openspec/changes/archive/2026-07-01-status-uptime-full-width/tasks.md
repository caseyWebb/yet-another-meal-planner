## 1. Sparkline primitive: fixed slots + ghost state

- [x] 1.1 In `src/admin/ui/kit.tsx`, extend the segment model (`TipSegment`) with a `"ghost"`/`"empty"` state alongside `ok`/`fail`, and give `SparklineTrack` a target-slot count (a `slots?` prop). When `slots` exceeds `segments.length`, prepend `slots - segments.length` ghost segments on the older/left side.
- [x] 1.2 Render ghost segments as a non-interactive `<span>` (never the `<a class="spark-seg-link">` wrapper) with no `data-tip-*` attributes and an appropriate `aria-label` (or `aria-hidden`) so screen readers don't announce them as runs. Real-run segments are unchanged (link + tooltip).

## 2. Status page: pad to the window, keep labels real-run-only

- [x] 2.1 In `src/admin/pages/status.tsx` (`Uptime`), pass the window as `slots` to `SparklineTrack`; compute `% uptime` and `N runs` from the real `runs` array exactly as today (ghosts are not counted).
- [x] 2.2 Thread `STATUS_SPARKLINE_WINDOW` from `src/admin/app.tsx` to the renderer as the single source of truth (export + import, or pass as a prop) — do not hardcode `30` a second time.
- [x] 2.3 Preserve the zero-history behavior: a job with no runs still omits the sparkline entirely (no ghost-only track).

## 3. Styling: full-width fill + ghost tint

- [x] 3.1 In `src/admin/styles.css`, remove `max-width: 22rem; margin-left: auto` from `.spark-track-wrap` and from `.spark-axis`, and remove `max-width: 10px` from `.spark-seg-tip` so bars `flex: 1 1 0` fill the track. Keep the gap and `min-width`.
- [x] 3.2 Add a `.spark-seg-tip.ghost` (or equivalent) faint-muted style, visually distinct from `.ok`/`.fail` (full track height, reduced opacity, neutral fill per the design default).
- [x] 3.3 Confirm the `.uptime-head` and `.spark-axis` now align with the track edges (they span the same full width) at both full (30) and sparse populations.

## 4. Verify

- [x] 4.1 `build:admin` (Tailwind-compile + esbuild) succeeds; `typecheck` and `test` are green.
- [x] 4.2 Behavior verified via SSR render assertions in `test/admin-status.test.ts`: an under-populated series ghost-pads the older/left side to the full window with the newest run anchored right; a full window renders no ghosts; ghosts are `aria-hidden`, non-linking, and excluded from the `% uptime`/run-count labels; a job with no runs omits the sparkline. (Pixel-level look is covered by the non-blocking `admin-visual` CI screenshots.)
- [x] 4.3 `openspec validate "status-uptime-full-width" --strict` passes.
