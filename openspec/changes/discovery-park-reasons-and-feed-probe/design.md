## Context

The discovery sweep's `acquireContent` (`src/discovery-sweep.ts:656`) folds five distinct failures into `RecipeContent | null`, and the caller (`:334`) logs every `null` as `detail: { reason: "unreachable" }`. The manual `parse_recipe` tool (`src/discovery-tools.ts:58-99`) runs the *same* fetch → `extractJsonLd` → `findRecipe` → `normalizeRecipe` pipeline but throws a distinct `ToolError` at each branch (`unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete` — all already in the `ErrorCode` union, `src/errors.ts:19-22`). So the taxonomy exists; the sweep just discards it.

The feeds editor is a `Config.TableEditor` instance (`admin/src/Config.elm:63`, pk `url`), and the admin API already has the right home for an edge probe: `/admin/api/discovery/{analyze,dry-run}` are operator-only POST routes that run real sweep logic worker-side (`src/admin.ts:498-523`), built from `buildDiscoveryDeps(env)`. `discovery_log.detail` is free-form JSON (`migrations/d1/0016_background_discovery.sql:60`) — no schema change needed.

The cross-tenant operator reach, the Access gate (404 when unconfigured), and the structured-error discipline are all inherited by sitting inside `handleAdmin` / `routeAdminApi`.

## Goals / Non-Goals

**Goals:**
- The discovery log distinguishes a walled/dead source from a feed entry that simply isn't a parseable recipe, using the taxonomy `parse_recipe` already has.
- An operator can test, from the edge, whether a feed *and a sample of its entry pages* are viable before/after adding it.
- The sweep and the probe share one acquisition implementation so their verdicts can't drift.
- Existing mislabeled `unreachable` rows can be re-classified.

**Non-Goals:**
- No bot-wall bypass or retry/evasion (the `src/http.ts` note stands: walls fingerprint below the header layer).
- No new MCP tools — every route here is operator-only `/admin`.
- No change to the matching/import/governor logic; only the *reason a candidate is parked* and a new read-only operator probe.
- No automatic "walled → remove feed" action; the probe is informational (a one-click prune may be a later change).

## Decisions

**1. Extract a shared `acquireRecipeContent` that returns a discriminated result, not `null`.**
Replace `acquireContent`'s `Promise<RecipeContent | null>` with a helper returning `{ ok: true, content } | { ok: false, reason: "unreachable" | "no_jsonld" | "not_a_recipe" | "incomplete", status?: number }`. The sweep's `[2] acquire content` step logs `detail: { reason, ...(status && { status }) }` from this. The probe and the backfill call the same helper. *Alternative considered:* have the sweep import and call `parse_recipe`'s internals directly — rejected because `parse_recipe` also does corpus idempotency lookups and returns the full normalized recipe shape; the sweep needs only `{title, ingredients, instructions}`. A small shared helper that both the tool and the sweep wrap is cleaner than coupling them. The `DiscoveryDeps.acquireContent` dep keeps its injectable seam (tests stub it); only its return type widens.

**2. Probe = feed fetch + bounded sample of entry pages through the shared helper.**
`POST /admin/api/discovery/test-feed` fetches the feed with `fetchWithBrowserHeaders`, runs `parseFeed`, then takes the first `k` items (k≈3–5, a named constant) and runs `acquireRecipeContent` on each, returning `{ feed: { status, parsed, itemCount }, sample: [{ url, outcome }] }`. The "sample the entry pages" decision is the whole point: a feed can fetch 200 and still have every entry walled — feed-XML-only would miss exactly the case the operator cares about. *Alternative considered:* probe only the feed XML — rejected per the proposal's chosen depth.

**3. Reuse `buildDiscoveryDeps(env)` egress, no separate fetch path.**
The probe builds the same deps the dry-run uses, so its fetch hygiene (headers, redirect) is identical to the live sweep's. This is why the verdict is trustworthy: same code, same egress IP.

**4. Backfill is an operator-triggered, bounded re-probe — not a migration.**
A SQL migration can't re-fetch URLs, and the original specific reason was never captured, so recovering it requires re-running acquisition. `POST /admin/api/discovery/reprobe-parked` selects a capped batch of `outcome='error'` rows whose `detail.reason = 'unreachable'`, re-runs the helper, and `UPDATE`s `detail` in place. Bounded per call (subrequest budget) and idempotent (skips rows already specific). *Alternative considered:* going-forward only — rejected per the proposal's chosen backfill. *Alternative considered:* auto-backfill on deploy — rejected; it's an unbounded fetch storm with no operator in the loop.

**5. Elm: a `TableEditor`-local test action, separate from the add/remove `ActionState`.**
Testing is read-only and must not interfere with the add/remove one-mutation-at-a-time invariant, so it gets its own state field — e.g. `testing : Dict RowKey (WebData FeedVerdict)` (or a single `Maybe (RowKey, WebData FeedVerdict)` if we restrict to one test at a time) — keyed by row, never a `Bool`/`Maybe String` pair. A successful test does **not** refetch the list (unlike add/remove). Because the probe is feeds-specific, the generic `TableEditor` gains an *optional* per-row action hook in its `EditorConfig` rather than baking feeds knowledge into the generic module; only `feedsConfig` supplies it.

## Risks / Trade-offs

- **[Probe subrequest cost / slow click]** sampling k pages = k live fetches, some to walled sites that may hang → bound k with a named constant and rely on the platform fetch timeout; it's operator-triggered and off the cron budget, so cost is acceptable and bounded.
- **[A sampled page differs from the parked candidate]** the probe samples the *current* feed head, which may not include the specific URL that was parked → acceptable: the probe answers "is this source viable now", which is the operator's actual question; the per-row log still shows historical specifics.
- **[Backfill re-walls or rate-limits]** re-fetching many parked URLs could trip rate limits → the cap-per-invocation plus idempotent skip means the operator drains it in controlled batches, never one storm.
- **[Taxonomy drift between tool and sweep]** if the shared helper isn't actually shared → enforced by Decision 1 (single helper, both wrap it) and a unit test asserting the sweep and `parse_recipe` agree on the same fixture pages.
- **[Generic TableEditor leaking feeds concern]** an optional config hook keeps the other four editors untouched; the hook is `Nothing` for them.

## Migration Plan

1. Land the shared `acquireRecipeContent` helper + reason-bearing sweep log (pure code; new sweep rows immediately specific). Existing tests for `acquireContent`-returns-null update to the discriminated shape.
2. Add the two admin routes (`test-feed`, `reprobe-parked`) + Elm test action.
3. After deploy, the operator runs the re-probe a few times to drain the legacy `unreachable` backlog. No rollback concern: the backfill only rewrites `detail.reason` and is re-runnable; reverting the code leaves the already-specific rows valid (still in-vocabulary).

## Open Questions

- Sample size `k` for the probe and the batch cap for the re-probe — pick concrete constants during apply (proposal floated k≈3–5). Not blocking.
- Whether the probe verdict should offer a one-click `reject_discovery`/remove-feed follow-up — deferred out of scope here; informational only for now.
