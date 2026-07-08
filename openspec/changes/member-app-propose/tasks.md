# Tasks — member-app-propose

Ordered **Worker-first**: the embed cache (§1), the planner extensions (§2), the tighten signal
(§3), and the extractions/routes (§4) land fully unit-tested before the UI (§5–§6) binds to the
finished contract. Implementation is **serial** across the shared Worker surfaces
(`embedding.ts`, `semantic-search.ts`, the proposal pipeline files, `reconcile-signals.ts`,
`tools.ts`, `docs/`); UI work within §6 parallelizes freely. **No spike tasks** — every open
question is settled in design.md (D1–D12) against the code and the production spike. Assumes P0
+ P1 landed (proposal.md "Dependency"); tasks name their pieces by role.

## 1. Worker: the query-embedding cache (D5)

- [x] 1.1 Add `embedTextsCached(env, texts)` to `packages/worker/src/embedding.ts`: normalize
  (lowercase, trim, collapse inner whitespace), key `embed:<sha256-hex(EMBED_MODEL + "\n" +
  normalized)>` via `crypto.subtle`, KV-get each from `KROGER_KV`, batch **all misses into one
  `embedTexts` call**, best-effort put-back (`expirationTtl` 30 d). KV get/put failures fail
  open to the plain embed; a malformed cached value (wrong length/shape) is treated as a miss.
- [x] 1.2 Re-point `search_recipes` ranked mode's vibe-embed batch (`tools.ts`) at
  `embedTextsCached` — results byte-identical on a cold cache (same `embedTexts` under the
  hood).
- [x] 1.3 Unit tests (stub `env.AI` + in-memory KV): miss → one batched embed + puts; hit → zero
  AI calls; mixed batch embeds only misses, preserving input order; KV failure falls open;
  malformed entry re-embeds; two texts differing only in case/whitespace share one key; the key
  changes when `EMBED_MODEL` changes.

## 2. Worker: W1 planner extensions (D2, D3, D4, D9, D10)

- [x] 2.1 `semantic-search.ts`: `rankCandidates` gains optional bounded-nudge params
  (`nudge?: { vec: number[]; weight: number }`, `proteinWants?: string[]` with a `+0.15`-scale
  boost constant) — absent for every existing caller; unit-test that omission is bit-identical
  to today and that each term reorders without admitting non-candidates.
- [x] 2.2 `night-vibe-schedule.ts`: `WeekSlot` gains optional `category?: WeatherCategory`,
  stamped when a sampled slot is drawn from a non-`mild` category quota (flex/pinned/overdue
  slots carry none). Allocation math untouched; extend the existing `sampleWeek` tests to pin
  the annotation and that quotas/rollover are unchanged.
- [x] 2.3 `meal-plan-proposal-tool.ts`: add the `slots` param (array of
  `{ vibe_id, protein?, cuisine?, max_time_total? (nullable), vibe?, recipe? }`) and
  `nudges.freeform`/`nudges.proteins` to the zod schema; thread per-slot facet pins into
  `buildPool` with precedence **slot pin > global `nudges.max_time_total` > vibe facet**
  (`max_time_total: null` deletes the cap for that slot); constraints for unsampled vibe ids
  are inert. Embed freeform + override phrases (cache misses batched) via `embedTextsCached`;
  a request with no such text makes zero AI calls.
- [x] 2.4 `meal-plan-proposal-tool.ts` + `meal-plan-proposal.ts`: per-slot vibe override — the
  embedded phrase replaces that slot's query vector (gate + vibe identity unchanged, response
  `vibe_override: true`; an unembedded vibe with an override becomes fillable). Freeform vector
  + protein wants threaded as the `rankCandidates` nudges; `why[]` lines per D4.
- [x] 2.5 `meal-plan-proposal.ts`: recipe pins — resolve `slots[].recipe` with the lock rules
  (case-insensitive, embedded, non-rejected, not excluded; unresolvable → explicit empty slot
  with reason), admit resolved pins into the `DiversifyState` up-front alongside locks, return
  them in slot position with `vibe_id`/`reason` intact, `recipe_pinned: true`, `why` leading
  "your pick".
- [x] 2.6 `meal-plan-proposal.ts`: alternates — per vibe slot, over its pool minus the week's
  used slugs: `alternates` (top-6 lites `{ slug, title, protein, cuisine, time_total }`),
  `alt_similar` (max cosine to the chosen main), `alt_different` (highest-ranked
  different-cuisine); `[]`/`null` on locked slots and exhausted pools; empty vibe slots keep
  their pool's alternates. Fold `WeekSlot.category` into the slot's `why` + `weather_category`.
- [x] 2.7 Unit tests: pin-precedence matrix (pin > nudge > facet; `null` lifts the vibe's cap);
  inert unsampled-vibe constraints; exclude beats a recipe pin; recipe pin preserves
  `vibe_id` and diversifies the rest of the week away from it; alternates are gate survivors,
  week-deduped, deterministic; override slot fills an unembedded vibe; **the D10 determinism
  test** — a full request exercising every new param (AI stubbed, cache warm) run twice
  deep-equals; and an unchanged-baseline test — a request using no new params matches the
  pre-change snapshot.

## 3. Worker: the reconcile tighten signal (D6)

- [x] 3.1 `night-vibe-db.ts`: add `readVibeSatisfactionDates(env, tenant)` (dates DESC per vibe
  over `cooking_log.satisfied_vibe`); the signal job derives last-satisfied from it (one query).
- [x] 3.2 `reconcile-signals.ts`: the tighten rule in `draftProposals` — ≥ 3 satisfactions, both
  of the 2 most recent intervals `≤ cadence_days × 0.5`, currently on-track
  (`days_since(last) < cadence_days`), `suggested = max(3, round(mean(recent)))`, only when
  `suggested < cadence_days`; drafts `kind: "adjust_cadence"` with rationale/evidence per D6,
  producer `signal-cron` unchanged.
- [x] 3.3 Unit tests: the rule matrix (fires on tight intervals; on-track guard blocks an
  overdue vibe; < 3 satisfactions blocks; suggested ≥ current blocks; floor 3 applies);
  disjointness with stretch on the same palette; `proposalId` bucket dedupe (a rejected tighten
  at ~the same value is not re-drafted; a materially different value is a new id); the cron
  wrapper enqueues idempotently across two ticks.

## 4. Worker: extractions + the `/api/propose` route group (D1, D7, D9)

- [x] 4.1 Extract `runProposeMealPlan(env, tenant, input, deps)` from the tool closure and
  `buildProposeDeps(env, tenant)` for non-MCP callers; re-point the tool (its memoized closures
  still passed). Extract `resolveTenantForecast(env, tenant, days?)` from the
  `get_weather_forecast` closure; re-point the tool. `aubr test` green with no test edits
  beyond imports (behavior-preserving).
- [x] 4.2 New `packages/worker/src/api/propose.ts` (P1 route-group idiom, `hc` type export):
  `POST /api/propose` (body = full tool input, zod-validated; calls the shared op) and
  `GET /api/propose/weather?days=` (ETag'd by the shared middleware; structured `no_location`
  et al. cross the boundary per the shared error table). Mount under the P0 `/api` app; the
  per-route analytics point is inherited.
- [x] 4.3 Route tests (`app.request` idiom): propose happy path returns the op result; identical
  bodies return identical proposals (D10 at the route level); weather returns the forecast
  shape and maps `no_location`; both routes 401 without a session.

## 5. packages/ui: propose primitives

- [x] 5.1 From the design bundle (`app-propose-ui.js` + `app-propose.css`): slot card (head
  actions, why/side/flag chips, empty-slot state with clearable pins), facet chip + popover,
  swap menu, vibe panel (typed phrase + palette presets + reset), nudge bar (slider, chip
  toggles, debounced input), variety bar, weather strip (`.wx-strip` per its CSS spec — D11),
  nights stepper. Match the mock's markup/visual output on the established tokens; no new
  design language (restyles go back through the Claude Design project).

## 6. packages/app: the propose flow (D7, D8, D11)

- [x] 6.1 Client propose session: the mock's option shape persisted client-side (localStorage),
  serialized canonically into the `POST /api/propose` body; TanStack Query keyed by the
  serialized request with `keepPreviousData`; reroll = seed + 1; reset clears the session.
  **No server persistence** — verify no propose state crosses the wire outside the request.
- [x] 6.2 `/propose` route + page: intro (no session) and empty-palette states, controls row
  (nights 2–6, adventurousness ↔ `nudges.variety`, protein wants, freeform debounced 400 ms),
  weather strip from `GET /api/propose/weather` (quiet `no_location` chip), variety bar,
  slot list.
- [x] 6.3 Slot interactions → request mapping per D7: lock/swap/pick-list → `slots[].recipe`;
  exclude → `exclude` (+ clear the slot's pin); facet popovers → `slots[].{protein, cuisine,
  max_time_total}` (protein/cuisine option universes derived client-side from the cached
  index); vibe panel → `slots[].vibe`; empty slots render their pins clearable in place.
- [x] 6.4 Commit (D8): filled slots → P1 `POST /api/plan/ops` adds with `from_vibe`, side
  titles, and client-assigned next-open dates; already-planned recipes merge with the mock's
  toast copy; session cleared; navigate to the plan page. Entry points added: meal-plan page
  "Plan my week" + palette footer link.
- [x] 6.5 Mutation/query hooks respect the D8 exemption: the propose query is never retried as
  a mutation, never queued offline (a stale propose is just re-requested); commit reuses P1's
  class (b) plan-ops mutation.

## 7. Playwright (blocking, zero model calls — D12)

- [ ] 7.1 Seed additions: deterministic palette (`night_vibes`), synthetic
  `night_vibe_derived` + `recipe_derived` vectors (equal dimension, distinct directions),
  at-risk pantry rows; pre-warm the KV embed cache with the freeform spec's exact phrase key.
- [ ] 7.2 Page objects + specs: empty-palette intro; first propose (slots, variety bar, weather
  strip or `no_location` chip); reroll changes the week and same-request stability holds; lock
  survives reroll; facet pin narrows a slot + over-constrained empty state with clearable pins;
  swap-similar applies `alt_similar`; exclude refills; freeform (cache-warmed) shows the
  "matches your ask" why; commit lands plan rows whose `from_vibe`/sides/dates the plan page
  read confirms.
- [ ] 7.3 Run the suite (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in web sessions), surface
  per-area screenshots; the CI job stays blocking.

## 8. Docs (lockstep, same pass)

- [ ] 8.1 `docs/TOOLS.md`: rewrite the `propose_meal_plan` entry — `slots` constraints,
  `nudges.freeform`/`nudges.proteins`, alternates/`alt_similar`/`alt_different`,
  `recipe_pinned`/`vibe_override`/`weather_category`, and the embed guarantee (*at most one
  batched, cache-gated embedding call, only for freeform/override text; no text ⇒ no AI call*)
  replacing the "no Workers AI call" absolute. Written as current behavior, no history.
- [ ] 8.2 `docs/SCHEMAS.md`: the query-embedding-cache KV section (key derivation, value shape,
  TTL, namespace) beside the flyer-cache section.
- [ ] 8.3 `docs/ARCHITECTURE.md`: the propose surface (shared op, endpoint, client-side
  session) and the one sanctioned request-time embed + cache in the determinism-boundary
  narrative.
- [ ] 8.4 Confirm `AGENT_INSTRUCTIONS.md`: update any propose-flow persona text that asserts
  "never makes an AI call" or predates the iteration params; the tool description itself owns
  the params/guarantees (tool/skill boundary).
