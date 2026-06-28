## Why

The background discovery sweep logs `detail: { reason: "unreachable" }` for **five structurally different failures** — a network throw, a non-2xx (bot wall, dead link), a page with no JSON-LD, JSON-LD with no `Recipe`, and an incomplete `Recipe` — because `acquireContent` collapses all of them to `null` and the caller labels every `null` "unreachable". An operator reading the discovery log therefore can't tell a walled source (drop it) from a feed whose non-recipe entries (roundups, listicles, category pages) simply have no parseable recipe (working as intended). It also explains the confusing pattern where *the same source* shows both "unreachable" and successful imports: its recipe permalinks parse while its other feed entries hit the no-JSON-LD / not-a-recipe paths and get mislabeled. The manual `parse_recipe` tool already distinguishes these exact cases; the sweep threw that signal away.

## What Changes

- **Specific park reasons in the sweep.** `acquireContent` stops returning a bare `null` and instead returns the *reason* a candidate could not be acquired — reusing the existing `unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete` taxonomy (`src/errors.ts`) the manual `parse_recipe` already uses. The sweep logs that specific reason (and, where available, the HTTP status) into the parked entry's `detail`, instead of the catch-all `"unreachable"`.
- **An edge feed-probe endpoint.** A new operator-only `POST /admin/api/discovery/test-feed { url }` that, **from the Worker's edge egress**, fetches the feed URL (status, RSS/Atom parse, item count) and then runs `acquireContent` against a small sample of the feed's entry pages, reporting each sampled page's specific outcome. This answers "is this actually a viable source from Cloudflare's edge" — the feed *and* its entries reachable/parseable from the Worker's IP, which differs from the operator's browser.
- **A "Test" action in the feeds editor.** The Config › Feeds `TableEditor` gains a per-row (and add-form) test button that calls the probe endpoint and renders the verdict (feed reachable, N items, K/M sampled pages parsed, any bot-walled).
- **A one-time backfill of mislabeled rows.** An operator-triggered re-probe re-classifies existing parked `outcome='error'` rows whose `detail.reason` is the old catch-all `"unreachable"`, re-fetching each URL through the new `acquireContent` and updating its `detail` to the specific reason (or leaving it `unreachable` when the page genuinely still can't be reached).

## Capabilities

### New Capabilities
<!-- none — both halves modify existing capabilities -->

### Modified Capabilities
- `discovery-sweep`: the parked-candidate error surface and the auditable outcome log SHALL record a *specific* acquisition-failure reason (unreachable / no_jsonld / not_a_recipe / incomplete) rather than a catch-all `"unreachable"` for every content failure.
- `operator-admin`: the admin surface SHALL expose an Access-gated edge feed-probe endpoint and a re-probe/backfill endpoint, and the Config › Feeds editor SHALL offer a per-feed test action that renders the probe verdict.

## Impact

- **Code:** `src/discovery-sweep.ts` (`acquireContent` return type + the `[2] acquire content` log call), `src/admin.ts` (new `/admin/api/discovery/test-feed` + re-probe routes), the Elm `admin/src/Config/TableEditor.elm` / `Config.elm` (per-row test action, verdict rendering), and likely a shared probe helper extracted from the sweep's `acquireContent` so the endpoint and the sweep stay in lockstep.
- **Data:** no schema change — `discovery_log.detail` is already free-form JSON; only the `reason` value's vocabulary tightens. The backfill rewrites `detail` of existing `outcome='error'` rows in place.
- **Docs:** `docs/TOOLS.md` is unaffected (no MCP tool changes — these are operator-only `/admin` routes); `docs/SCHEMAS.md` notes the tightened `detail.reason` vocabulary; `docs/ARCHITECTURE.md`'s discovery-sweep / admin sections gain the probe endpoint.
- **Cost:** the probe makes a few live subrequests per operator click (operator-triggered, off the cron budget); the backfill is a bounded one-shot re-fetch of existing parked URLs.
