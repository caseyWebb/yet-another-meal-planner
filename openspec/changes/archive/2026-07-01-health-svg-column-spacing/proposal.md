## Why

`/health.svg` renders the aggregate health payload into a fixed-width (320px) card with **hardcoded column x-coordinates** (`renderHealthSvg` in `packages/worker/src/health.ts`): names at `x=32`, status word at `x=150`, age at `x=232`. The name column is therefore exactly `150 − 32 = 118px` wide, which at the card's 13px monospace font (~7.8px/char) holds only ~15 characters. Several registered job names exceed that:

| label | chars | name-column end (px) | result |
| --- | --- | --- | --- |
| `recipe-classify` / `discovery-sweep` | 15 | ~149 | kisses the status word — looks cramped |
| `night-vibe-embed` / `archetype-derive` | 16 | ~157 | overruns the `ok` by ~7px |
| `reconcile-signals` | 17 | ~165 | overruns the `ok` by ~15px (worst) |

There is no truncation or overflow handling, so long labels render straight through the status word — the cramping in the reported badge. A **latent** second collision exists in the word column too: the `ai` row's word can be `quota exhausted` (15 chars ≈ 117px) against an 82px word column; it only avoids a visible clash today because the `d1`/`admin`/`ai` rows have an empty age column to spill into.

The fix is to stop assuming a maximum content length. Because the card is monospace, every column's exact width is `charCount × advanceWidth` — so column boundaries can be **derived deterministically from the rendered rows** instead of hardcoded, matching the repo's deterministic-plain-code approach and staying correct if `HEALTH_JOBS` gains a longer name later.

## What Changes

- **Content-derived columns.** `renderHealthSvg` computes each column's start from the widest text in the column to its left plus a fixed gutter, using a fixed per-character advance width (monospace), rather than the hardcoded `wordX`/`ageX`. The card's overall width grows to contain the rightmost column (with the current 320px kept as a floor so the header never cramps). This fixes both the long-label/status-word collision and the latent `quota exhausted` word-column overflow in one pass.
- **Geometry regression guard.** A new test asserts no rendered label reaches its status word's column start (the actual bug), and that a synthetic label longer than any current job repacks the card instead of overlapping (locks in the derived-from-content property).
- No behavioral change to states, colors, headline, tenant-data-free guarantee, the `200`-in-all-states rule, or the `/health` JSON endpoint.
- `design.md` intentionally skipped (layout-math fix, not a design decision). No `docs/TOOLS.md` or `docs/SCHEMAS.md` change — no tool contract or data-shape changes; the card is internal rendering. The `background-job-health` spec gains the legibility guarantee (this change's delta).

## Capabilities

### Modified Capabilities

- `background-job-health`: the `/health.svg` card SHALL lay out its columns so no label, status word, or age collides with an adjacent column, derived deterministically from content widths.

## Impact

- `packages/worker/src/health.ts` — `renderHealthSvg` (~L486–573): replace the hardcoded `wordX`/`ageX`/`width` with content-derived column starts; add a per-character advance-width constant and a gutter constant.
- `packages/worker/test/health.test.ts` — add the geometry regression assertions (no label/word overlap; synthetic long-label repack).
