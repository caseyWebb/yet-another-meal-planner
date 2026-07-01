## Context

The operator Status area (`src/admin/pages/status.tsx`) renders inside the non-wide `.wrap` (a `44rem`/~704px content column — `src/admin/ui/layout.tsx:51`; `StatusPage` passes no `wide` — `status.tsx:295`). Each background job is an `Item` flex row: a state glyph (`item-media`, fixed), a growing `item-body` (`flex: 1`), and a status badge (`item-actions`, fixed). Inside `item-body`, the `Uptime` component (`status.tsx:147`) renders a `.uptime` block: a `.uptime-head` row ("Run history" left, "% uptime · N runs" right, spanning the full body width) above a `<SparklineTrack segments axis />`.

`SparklineTrack` (`src/admin/ui/kit.tsx:273`) emits `.spark-track-wrap` › `.spark-track` (the per-run bars) plus a `.spark-axis` ("OLDER" / "NOW"). Segments come from `Uptime` mapping `runs` (newest-first from `readJobRuns`, reversed to oldest→newest) to `TipSegment`s with `state: r.ok ? "ok" : "fail"`; each real bar is an `<a href="/admin/logs?run=<id>">` carrying a hover tooltip. The number of runs fetched is `STATUS_SPARKLINE_WINDOW = 30` (`src/admin/app.tsx:136`), passed as the `readJobRuns` limit.

The layout that produces the dead gap is entirely in `styles.css:242–251`:

```css
.spark-track-wrap { max-width: 22rem; margin-left: auto; }         /* cap + shove right */
.spark-track { display: flex; gap: 2px; justify-content: flex-end; }/* right-align bars */
.spark-seg-tip, a.spark-seg-link { flex: 1 1 0; min-width: 2px; max-width: 10px; }  /* cap each bar */
.spark-axis { ... max-width: 22rem; margin-left: auto; }            /* axis matches the capped track */
```

At 30 runs, 30 bars capped at 10px make a ~22rem band; `margin-left: auto` + `flex-end` pin it to the right of the ~590px body, leaving ~215px empty on the left. The `.uptime-head` spans the full body, so "Run history"/"OLDER" sit far left of the bars. The inline comment names the intent: keep a sparse (under-populated) series from stretching into a few fat full-width bars.

```
current (30 runs):
┌──────────────────────── item (44rem) ─────────────────────────────────┐
│ [dot]  Run history .............................. 100% · 30 runs  [ok] │
│                        ▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟   ← 22rem, pinned right│
│                        OLDER ............................ NOW           │
└────────────────────────────────────────────────────────────────────────┘
         └────── ~215px dead gap ──────┘
```

## Goals / Non-Goals

**Goals:**
- The uptime sparkline fills the full width of the job row's body at any population, so the head and OLDER/NOW axis align with the track.
- Preserve the original intent that a sparse series does not stretch into a few fat bars — solved by fixed 30-slot padding rather than by right-pinning a narrow track.
- Keep the newest run anchored at the right (NOW) edge; older/missing runs occupy the left.
- Keep `% uptime` and `N runs` honest — computed from real runs only, unaffected by padding.
- Keep the change status-page-local (single consumer of `SparklineTrack`) and SSR-only (no new client JS).

**Non-Goals:**
- Changing `STATUS_SPARKLINE_WINDOW` (stays 30), `readJobRuns`, `job_runs`, or any data/schema/tool contract.
- Changing the real-run bar semantics: ok/fail coloring, hover tooltip, and the `/admin/logs?run=<id>` deep-link (and its pruned-id fallback) are unchanged for real bars.
- The zero-history case: a job with no `job_runs` still omits the sparkline entirely (no ghost-only track).
- Finalizing the ghost-slot aesthetic through the companion Claude Design project — a sensible default is used now; refinement there is a later, contract-preserving tweak.

## Decisions

### D1 — Fill the width with a fixed 30-slot, ghost-padded track instead of a right-pinned 22rem band

Drop the `22rem` cap and `margin-left: auto` (on both `.spark-track-wrap` and `.spark-axis`) and the per-bar `max-width: 10px`, letting bars `flex: 1 1 0` fill the track. To keep a sparse series from becoming a few fat bars — the very thing the original cap protected — the track always renders `STATUS_SPARKLINE_WINDOW` (30) slots: real runs fill from the right (NOW), and any shortfall is padded with ghost slots on the left (OLDER). At 30 real runs this is simply 30 bars filling the ~590px body (~18px each with the 2px gap); at 5 real runs it is 25 ghost slots + 5 real bars, still full-width, still NOW-anchored. This is the standard status-page uptime-bar pattern and reads as intentional at any population.

*Alternative — thin bars spread edge-to-edge via `justify-content: space-between` (no slot padding):* rejected. It fills the width but a sparse series becomes a few thin bars evenly spaced across the row, which reads as "evenly-spaced samples" and loses the "recent cluster anchored at NOW" meaning — trading the current problem for a semantic one.

*Alternative — keep the compact band, only align the head/axis to it:* rejected as the accepted direction is full-width; a compact-but-aligned widget does not satisfy "take full width."

### D2 — Ghost slots are a distinct, non-interactive segment state

Extend the segment model with a `"ghost"`/`"empty"` state alongside `ok`/`fail`. A ghost renders as a faint muted bar (a light neutral fill distinct from the green/red), full track height so the timeline reads as "these slots exist, no run yet," at reduced opacity. Ghosts are **not** links and carry **no** hover tooltip — there is no run to open — so `SparklineTrack` emits a plain `<span>` for them, never the `<a class="spark-seg-link">` wrapper. This keeps the "each real bar deep-links to its run" contract exact while padding remains inert. The exact tint/opacity is a default here (routable through the Claude Design project later without changing behavior).

### D3 — The window (30) is threaded from its single source of truth; labels stay real-run-only

`STATUS_SPARKLINE_WINDOW` in `src/admin/app.tsx` already governs how many runs are fetched. The padding target must be the same number, so it is threaded to the renderer (export the constant for `Uptime` to import, or pass it down as a prop) rather than duplicating `30`. `Uptime` computes `% uptime` and `N runs` from the real `runs` array exactly as today, then pads the mapped segment list to the window with ghost segments on the older side. Padding is a render-time concern only — no run records are fabricated.

```
proposed:
┌──────────────────────── item (44rem) ─────────────────────────────────┐
│ [dot]  Run history .............................. 100% · 30 runs  [ok] │
│        ▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟▟   ← 30 bars fill full width     │
│        OLDER ............................................. NOW          │
└────────────────────────────────────────────────────────────────────────┘

young job, 5 real runs (padded to 30, NOW-anchored):
│        ░░░░░░░░░░░░░░░░░░░░░░░░░▟▟▟▟▟   ← 25 ghost + 5 real            │
```

## Open Questions

- **Ghost height/opacity:** full-height faint bar (recommended — reads as "slot, no run yet") vs. a low baseline stub (reads as "nothing"). Defaulting to full-height faint; the Claude Design project can adjust.
- **Bar max-width guard:** the Status column is a fixed `44rem`, so 30 bars never exceed the container and no cap is needed. If the primitive is ever reused in a wider container, a soft `max-width` guard could be reintroduced — out of scope here since there is a single consumer.
