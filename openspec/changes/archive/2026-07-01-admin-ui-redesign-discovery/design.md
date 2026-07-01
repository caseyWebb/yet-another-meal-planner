## Context

`discovery_log` (migration `0016_background_discovery.sql`, retry columns added by `0018_discovery_retry.sql`) stores one row per terminal candidate outcome: `id, url, title, source, outcome, slug, detail (JSON), created_at, attempts, next_retry_at`. The pipeline that produces these rows is `processCandidate` in `src/discovery-sweep.ts`, a strict sequence:

1. **triage** — cheap title+summary cosine pre-filter (`nearAnyMember`). Skipped for retries (already evaluated).
2. **acquire** — fetch + parse the page (`deps.acquireContent`).
3. **classify** — `env.AI` → contract-valid frontmatter (`deps.classify`).
4. **describe** — generate + embed the description (`deps.describe` + `deps.embed`) — the authoritative dedup/match vector.
5. **dedup** — cosine vs. the corpus + this tick's imports (`findDuplicate`).
6. **match** — taste cosine + dietary gate (`matchMembers`), then the negation-aware LLM **confirm** (`deps.confirmMatches`) — a sub-step of stage 6, not its own track stage.
7. **import** — assemble, validate, write to R2, record attribution (`deps.importRecipe` + `recordMatches`).

Every outcome the pipeline can produce maps to exactly one of these seven stages as its **halt point** — the furthest stage the candidate is known to have reached before stopping (for `imported`, the halt point is `import` itself, fully passed, not a stop). This mapping is implicit in the code today (scattered across the `outcome`/`detail.stage`/`detail.reason` values written at each `return` in `processCandidate`) and does not exist as a named, reusable read — `readDiscoveryLog`/`readDiscoveryRowById` return the raw row only.

The reference mock (`DiscoveryScreen.jsx` / `discovery-data.jsx`) was authored against this exact taxonomy (see its header comment) and is the source for the view's shape; this design adapts it to the panel's SSR/island split and to the row data D1 actually has (no synthetic/illustrative fields).

## Goals / Non-Goals

**Goals:**
- Replace the `/admin/discovery` "coming soon" placeholder with the full candidate-pipeline view: stat tiles, filter pills, per-candidate progression-track cards, expand-to-stage-detail, manual retry, pagination.
- Derive "furthest stage reached" + "halt stage" + outcome-kind coloring from the EXISTING `discovery_log` row shape (`outcome`, `detail`, `attempts`, `next_retry_at`) — no schema change, no new write path.
- Make `/admin/discovery` the single home for candidate-level discovery data; retire `/admin/logs/discovery` as a destination (redirect) without breaking the in-flight `admin-ui-redesign-logs` change's discovery-sweep run-entry link (repoint it).
- Keep the manual Retry/Delete mutations exactly as they work today (`processCandidate(..., {bypassCap:true})`, the rejection-and-remove delete) — only their home page moves.

**Non-Goals:**
- No change to `discovery-sweep`'s pipeline, outcome taxonomy, or retry/backoff behavior (`discovery-sweep` capability is read-only ground truth here).
- No change to `discovery_log`'s schema or to `recordDiscoveryLog`/`resolveDiscoveryRow`/`bumpDiscoveryRetry` write paths.
- No bulk actions (the foundation/logs precedent already removed bulk re-probe; this view doesn't reintroduce it).
- No new MCP tool — this is operator/cross-tenant admin surface, same posture as the existing `/admin/api/discovery/*` routes.

## Decisions

### Decision 1 — Stage mapping: the mock's 7 stages map 1:1 onto `processCandidate`'s steps

The mock's `STAGES` array (`triage, acquire, classify, describe, dedup, match, import`) already names the real pipeline's steps in the real order — it was authored from this code. No renaming or collapsing is needed. The **halt stage** for each `outcome` is computed as:

| `outcome` | `detail.stage` (when present) | Halt stage | Notes |
|---|---|---|---|
| `imported` | — | `import` | Fully passed — not a "stop"; the track renders all 7 done. |
| `no_match` | `"triage"` | `triage` | Failed the cheap pre-filter. |
| `no_match` | `"confirm"` or `"match"` (or absent — legacy) | `match` | Cleared cosine but the LLM confirm declined, or cosine itself didn't clear. |
| `dietary_gated` | (always `"match"`) | `match` | Hard dietary restriction. |
| `rejected_source` | — | `triage` | Source-level reject, evaluated before any fetch — same visual halt as triage-no-match (never reached acquire). |
| `duplicate` | — | `dedup` | Near-duplicate cosine. |
| `error` | `detail.reason` taxonomy (`unreachable`/`no_jsonld`/`not_a_recipe`/`incomplete`) and no further `detail.stage` | `acquire` | The acquire-park taxonomy (`AcquireReason`). |
| `error` | `detail.reason` starts with `"validation_failed"`/classify-shaped message, no `status`/acquire-reason shape | `classify` | A classify-stage park (the `catch` around `deps.classify` writes `{reason: message}` with no `status` field — distinguished from acquire parks by the absence of an `AcquireReason` value in `detail.reason`). |
| `error` | `detail.reason` starts with `"import: "` | `import` | An import-stage park (storage/validation failure during write). |
| `failed` | — | the stage active when the `catch` fired — **not deterministically recoverable from the stored row** | See Risk below; the view renders `failed` rows at `acquire` as a documented approximation (the catch-all `processCandidate` wraps the whole pipeline, and the common failure mode in practice is the acquire/classify boundary — env.AI or D1 transient errors). |
| `deferred` | — | `import` | Cleared match; held back by the rate cap (never reaches `deps.importRecipe`) — rendered as a non-failure halt at the cap boundary, consistent with the mock's `defer` kind. |

The `error`-outcome disambiguation (acquire vs. classify vs. import park) is the one place this read does real classification work over `detail.reason`'s free-text shape, because `processCandidate` itself doesn't tag parks with an explicit stage name outside of the `no_match`/`dietary_gated` `detail.stage` field. This is captured once in the new reader (Decision 3) rather than duplicated in the view.

### Decision 2 — `/admin/discovery` absorbs the candidate view; `/admin/logs/discovery` redirects

Per the proposal, the reconciliation with `admin-ui-redesign-logs` is: the **pipeline view is the single home** for candidate-level discovery data, at `/admin/discovery`. `/admin/logs/discovery` becomes a redirect (`302` to `/admin/discovery`, preserving any query params the operator may have deep-linked with — none today, but forward-compatible) rather than a second live view of the same data, avoiding the two-views-of-one-table drift the Logs design.md (Decision 2) was careful to avoid for the *different* problem of run-log vs. candidate-log. Concretely:

- **Moves:** the candidate list, its Retry/Delete actions, and the detail dialog/expand move from `src/admin/pages/logs.tsx` + `src/admin/client/logs.tsx` to `src/admin/pages/discovery.tsx` + a new `src/admin/client/discovery.tsx` island (or `client/logs.tsx` is renamed — implementation's call, but the DOM hydration target id changes regardless since the surrounding page changes).
- **Retires:** the Logs area's "Discovery" left-submenu destination and its `/admin/logs/discovery` route content; the route itself becomes a redirect stub (kept so existing bookmarks/links don't 404).
- **Repoints:** the Logs all-jobs view's `discovery-sweep` run entry's "View discovery candidates →" link target changes from `/admin/logs/discovery` to `/admin/discovery`. This is a one-line link-target change in `admin-ui-redesign-logs`'s `logs.tsx`; because that change is still unarchived, this proposal specs the final state (`/admin/discovery`) directly rather than specifying an interim state and a follow-up — the two changes' specs deltas are written to compose: this change's delta retires the `/admin/logs/discovery` content requirement and the Logs spec (once `admin-ui-redesign-logs` archives) should be read as already pointing at `/admin/discovery` for that link. See Risks for the sequencing note.
- **Unaffected:** `GET /admin/api/logs/discovery` (the raw read endpoint used by both the old view and any future API consumer) is unchanged — it remains a valid, cross-tenant-gated read; only the SSR page that calls it moves. The retry/delete mutation routes (`/admin/api/discovery/:id/*`) are unchanged in path and contract.

*Alternative considered:* keep `/admin/logs/discovery` as the live candidate view and make `/admin/discovery` a dashboard that links out to it (stat tiles + filter pills only, no per-candidate cards). Rejected — it reintroduces exactly the "Discovery is a top-level area but its content lives elsewhere" awkwardness the placeholder's own copy ("see Logs › Discovery") was meant to be temporary, and it leaves two pages partially duplicating filter/stat logic over the same table.

### Decision 3 — `readDiscoveryCandidates`: a presentation-shaped reader in `discovery-db.ts`, not a `discovery-sweep` capability change

A new function, `readDiscoveryCandidates(env, limit)`, wraps `readDiscoveryLog` and enriches each row with `{ haltStage: StageKey, kind: "accepted"|"dup"|"reject"|"park"|"fail"|"defer", retryable: boolean }` using the Decision-1 mapping (a pure function, e.g. `deriveHalt(row): { haltStage, kind }`, unit-testable without D1). It lives beside `readDiscoveryLog`/`readDiscoveryErrors` in `src/discovery-db.ts` (same module, same row shape, same degrade-on-storage-error contract) but is framed as an `operator-admin` concern in the spec delta — exactly the precedent `admin-ui-redesign-logs`'s Decision 4 set for `readAllJobRuns` living beside `readJobRuns` in `health.ts` without becoming a `background-job-health` capability change. `discovery-sweep`'s own contract (what `processCandidate` writes) is unchanged; this reader only interprets what's already written.

`retryable` is exactly `next_retry_at !== null` (mirrors the mock's `c.retryable`); the "terminal" case (`attempts` at cap, `next_retry_at` null on an `error`/`failed` row) is distinguished in the view by checking `outcome IN ('error','failed') && next_retry_at === null && attempts > 0`.

Stat tiles and filter-pill counts are computed by the SSR page from one `readDiscoveryCandidates` call (bounded, same cap discipline as `readDiscoveryLog`'s existing 200-row default) — no separate count queries, consistent with the panel's existing "compute aggregates from the already-loaded bounded list" pattern (e.g. Logs' hint line).

### Decision 4 — SSR list + a thin mutation island, no client-side stage-derivation duplication

Per `admin/CLAUDE.md` rule 8: the stat tiles, filter pills (as a `?filter=` query param + page navigation, mirroring `admin-ui-redesign-logs`'s `?job=&page=` precedent), the progression track, the summary line, and the expand-to-stage-detail are all **pure reads** with no mutation — they render server-side from `readDiscoveryCandidates`, with filter/page as route query params (deep-linkable, no client state). Expand/collapse for a card's stage detail uses the same native `<details>`/`<summary>` zero-JS disclosure `admin-ui-redesign-logs` adopted for run entries (Decision 1 there) — consistent precedent, not a one-off.

Only **Retry now** is a genuine mutation (`POST /admin/api/discovery/:id/retry`) and needs an island: `client/discovery.tsx` hydrates the retryable cards' Retry buttons, tracking one-row-at-a-time in-flight state (`ActionState` per `admin/CLAUDE.md` rule 3 — `{status:"idle"} | {status:"busy"; id} | {status:"failed"; id; message}`), and on success reloads (re-fetches `readDiscoveryCandidates`'s typed route, or does a full navigation reload — implementation's call, matching the existing Logs island's reload-on-success behavior) so the resolved row's new outcome/stage renders immediately. Delete is the same shape, reusing the existing `DELETE /admin/api/discovery/:id`.

This means the **stage-mapping logic exists in exactly one place** (the SSR reader, Decision 3) — the island never recomputes halt stage/kind; it only reflects the server's post-retry re-render of that one row (or the whole list, simplest first cut).

### Decision 5 — The progression-track primitive lives in `src/admin/ui/kit.tsx`

A new presentational primitive (e.g. `StageTrack({ stages, haltIndex, kind, imported })`) is added to the shared kit rather than living only in `pages/discovery.tsx`, consistent with the foundation's intent that `kit.tsx` hold "the shared presentational vocabulary the redesigned areas compose from." It takes a generic `stages: {key,label}[]` + `haltIndex` + outcome `kind`, with no discovery-specific knowledge baked in beyond what the caller passes — so if a future pipeline (e.g. a hypothetical recipe-import-review flow) ever wants a similar track, it's reusable. It emits Basecoat-class-adjacent panel CSS (`pl-track`/`pl-stage`/`pl-node`/`pl-seg`, mirroring the mock's class names so `styles.css` additions are a near-direct port of the mock's CSS) — presentational only, no handlers, SSR-safe per the kit's existing convention.

## Risks / Trade-offs

- **[`failed`-outcome halt stage is not stored, only inferable approximately.]** `processCandidate`'s outer `catch` wraps the entire pipeline body, so a `failed` row's `detail.reason` (`"unexpected: <message>"`) carries no stage tag. → Mitigation: render `failed` rows at the `acquire` stage as a labeled approximation ("Infrastructure failure" — stage shown is "at least this far," not exact), matching the mock's own `halt: "acquire"` default for `failed`/`error` cands without an explicit override. This is a presentation approximation, not a data-correctness claim; if precise stage attribution is wanted later, `discovery-sweep`'s `processCandidate` would need a stage-tag on its catch (out of scope — Non-Goal).
- **[Cross-change sequencing with `admin-ui-redesign-logs`.]** That change is unarchived and currently specs `/admin/logs/discovery` as a live, unchanged destination with a discovery-sweep run-entry link pointing at it. → Mitigation: this change's spec delta explicitly retires that destination (redirect) and the link target; the two changes' archived specs must be reconciled at archive time so the final `operator-admin` spec has one consistent statement of where `/admin/logs/discovery` and the run-entry link point. Flagged here so whoever archives second checks the other's delta didn't drift.
- **[Stage-mapping logic (Decision 1's table) is the one piece of "new" business logic in an otherwise read-only view.]** A future `discovery-sweep` change that adds a new outcome or reshapes `detail` could silently break the mapping (e.g. render an unmapped outcome with no halt stage). → Mitigation: the mapping function should have an explicit exhaustive `switch` over the `Outcome` union imported from `discovery-sweep.ts` (not a re-declared string union), so a new outcome variant is a compile error in the reader, not a silent gap — same exhaustiveness discipline `admin/CLAUDE.md` requires of panel unions, applied here to an imported one.
- **[Redirecting `/admin/logs/discovery` could surprise an operator with it bookmarked mid-flow.]** → Low risk (internal single-operator/small-group tool); a redirect (not a 404) preserves the bookmark's usefulness.

