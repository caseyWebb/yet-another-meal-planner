# Member Web App (+ Admin SPA Consolidation) — Solution Plan

> **Genre note:** unlike the rest of `docs/`, this is a *plan*, not a description of
> current state. It is the working spec for an orchestrator agent to execute
> autonomously, phase by phase. Delete it (or fold residue into the living docs)
> when the work ships. It intentionally does not use the OpenSpec workflow; each
> phase below is roughly one OpenSpec-change-sized unit if the orchestrator wants
> to run them through `/opsx:propose` individually.

## 1. Vision & non-negotiable principles

A member-facing web app ("Cookbook") over the existing Worker — the retrieve/act
surface complementing the Claude.ai plugin (which remains first-class and the
capture-rich surface). The app is **not** a chat and **not** a RAG: every screen
is a UI over deterministic Worker operations. The model stays at the fuzzy edges,
where it already is:

- **Cron-side** (existing): facet classification, descriptions, embeddings,
  archetype derivation, ingredient-identity normalization.
- **Claude.ai** (existing): conversation, capture, judgment. The app deep-links
  out ("Cook with Claude") rather than embedding a model.
- **Request-time model calls in the app: at most one** — embedding a freeform
  phrase for the propose flow (same primitive `search_recipes` ranked mode
  already uses). Hash-cache it. Nothing else.

Cost posture: the app must round to zero marginal cost per member. Pure-CPU
planning (cosine over cron-captured vectors), D1/KV/R2 reads, cached static
bundle. No per-request Claude.

**Design source of truth** stays the companion Claude Design project
(claude.ai/design), per the repo rule. The export bundle is committed
(extracted) at **`docs/plans/web-app-design/`** for the lifetime of this plan —
remove it together with this document when the work ships. It covers both
interfaces: `project/cookbook/` is the member app (read `Cookbook App.html` and
its imports in full); the outer `project/*.jsx` screens (`MembersScreen`,
`NormalizeScreen`, `DataScreen`, `DiscoveryScreen`, `InsightsScreen`,
`LogsScreen`, `ConfigScreen`, …) are the admin SPA. Basecoat (the mockup's
design system) is the pure-CSS rendering of shadcn/ui, so mockup → shadcn/ui
component mapping is near-1:1.

## 2. Target architecture

One SPA stack for both interfaces; the Worker stays the only backend.

- **Frontend:** React 19 + Vite, TanStack Query (data cache, optimistic
  mutations, offline persistence) + TanStack Router (history-API, type-safe;
  **no hash routing**), shadcn/ui + Tailwind, `vite-plugin-pwa` (Workbox)
  service worker + manifest.
- **Two bundles, one shared package:**
  - `packages/app` — member app, mounted at **`/`** (replaces the plain-text
    liveness banner; `/health` remains the machine liveness check).
  - Admin SPA (phase 6) — mounted at `/admin`, Access-gated exactly as today.
  - `packages/ui` — shared shadcn/ui components, tokens, and the Basecoat→shadcn
    mapping, consumed by both via `workspace:*`.
- **API:** Hono JSON route groups on the Worker calling the same throw-free
  `src/` operation functions the MCP tools call (the `/admin/api/*` + typed `hc`
  pattern, per-tenant-gated). SSR pages and `hono/jsx/dom` islands are retired
  at the end (admin) — `hc` and the route layer survive unchanged.
- **Unchanged surfaces:** `/mcp` (OAuth provider + MCP tools), `/cookbook`
  (public SSR — the one linkable/SEO surface, already has embedding-powered
  Similar Recipes), `/authorize`, `/oauth/*` (Kroger), `/health*`, email/cron
  handlers.

### Serving & version skew

- `wrangler.jsonc` assets: `not_found_handling: "single-page-application"`;
  `run_worker_first` must enumerate every Worker-owned path (`/mcp`, `/api/*`,
  `/authorize`, `/oauth/*`, `/cookbook*`, `/admin*`, `/health*`, `/source`) so
  the SPA fallback cannot shadow them. **This config change must be added to
  `scripts/merge-wrangler-config.mjs`'s allowlist explicitly** or the deploy
  silently drops it.
- Hashed immutable assets; SW precaches the shell (offline start), with a
  **prompt-to-reload** update flow (never auto-reload someone mid-aisle).
- **Version skew policy:** API evolution is additive-only. The build stamps a
  version id (git SHA) into both the SPA bundle and the Worker; every API
  response carries it as an `X-App-Build` header and a `GET /api/version`
  endpoint exposes it. The SPA compares against its own build id and surfaces
  the SW update prompt when stale. A cached week-old bundle must keep working
  against a newer Worker.

## 3. Auth: first-party cookie session (no new SaaS, no new library)

The MCP OAuth provider and the admin Access gate are untouched; this is a third,
parallel auth mount built on machinery that already exists.

- **Login:** `/api/session` POST takes an invite code → `resolveInvite`
  (`TENANT_KV`) → `tenantId`. Same code provisions the Claude connector and the
  web session — one code per friend.
- **Session:** KV-backed (revocable), HttpOnly `SameSite=Lax` cookie, long
  rolling lifetime (~90d; this is a friend group, not a bank). Middleware is the
  member-facing analog of `requireAccess`, yielding the same `Tenant` context
  the MCP path resolves (`src/tenant.ts` `resolveTenant`).
- **Revocation:** member revoke (admin) purges sessions alongside the existing
  per-tenant purge path (`src/admin.ts` revoke).
- **CSRF:** same-origin only, `SameSite=Lax`, plus require a custom header on
  all JSON writes (reject bare form-shaped POSTs); optionally verify
  `Sec-Fetch-Site`.
- **Rate limiting:** reuse the ingest endpoint's fixed-window KV limiter
  (`src/ingest.ts`) on the login endpoint (invite codes are bearer-ish).
- **CORS:** none needed (same-origin by construction); do not add any.
- **Later, optional:** passkeys via `@simplewebauthn/server` layered on the same
  session store. Not in initial scope.

Rejected alternatives (recorded so the orchestrator doesn't relitigate):
Better Auth (viable — native D1 since 1.5 — but a chunky parallel user model
when invites already exist), Cloudflare Access for members (API-automatable but
couples self-hosting to Zero Trust setup + a CF API token secret with wide blast
radius), SPA-as-OAuth-client on the existing provider (tokens in JS = XSS
surface; OAuth is the wrong shape for first-party), SaaS IdPs (no compelling
argument at "operator hand-issues invites to friends" scale).

## 4. API surface

Per-area Hono sub-apps (keeps `hc` type-checking fast), chained under `/api`,
all session-gated, all calling existing `src/` functions. `export type` per
area; the SPA imports **types only** (`import type` — no workerd code in the
browser bundle).

| Area | Backing ops (already exist unless noted) |
|---|---|
| `session` | login (invite), logout, whoami |
| `cookbook` | recipe index + bodies (reuse `/cookbook` internals as JSON), keyword + ranked search (`search_recipes`), similar, new-for-me, **trending (new: `cooking_log` GROUP BY)**, picked-for-you (**new: thin wrap of `rankCandidates` favorites-affinity**) |
| `plan` | read/update meal plan (incl. `from_vibe`, sides), schedule dates |
| `propose` | `propose_meal_plan` (+ phase-3 extensions), weather (`get_weather_forecast`) |
| `vibes` | night-vibe CRUD, `suggest_night_vibes`, `list_proposals`/`confirm_proposal` |
| `grocery` | list CRUD, **member `in_cart` toggle (new semantics — see §5)**, **derived to-buy view (new — see §5 W2)**, `place_order` (preview + commit), substitutions (phase 4) |
| `pantry` | read/update, `mark_pantry_verified` |
| `log` | `log_cooked` (stamps `satisfied_vibe`), delete, `retrospective` |
| `notes` | recipe-note CRUD (author/tags/private; group-aggregated read) |
| `profile` | `read_user_profile`, `update_preferences`, taste/kitchen markdown, brands, staples, stockup, dietary, Kroger link (`kroger_login_url`) |
| `overlay` | `toggle_favorite`, `toggle_reject` |

Error convention: map structured `ToolError` codes → HTTP status once, in shared
middleware (`unauthorized`→401, `not_found`→404, `storage_error`→503, etc.);
bodies keep the structured code so the SPA can branch on it. The same shared
middleware layer owns ETag emission/`If-None-Match` handling and the
`X-App-Build` header (§2, §6) so no route implements them ad hoc.

Observability: emit per-route analytics to the existing `TOOL_AE` dataset (or a
sibling) so app usage is visible next to tool usage.

## 5. Backend workstreams (the real feature gaps)

Grounding: `propose_meal_plan` already does two-level planning (vibe palette →
cadence-debt × weather quotas → embedding retrieval + MMR), with `why[]`, flags
(`waste`/`meal_prep`/`novel`/`no_corpus_side`), variety diagnostics, seed/lock/
exclude/`boost_ingredients`, `nudges.variety` (λ) and `nudges.max_time_total` —
stateless, deterministic, no AI call at request time
(`meal-plan-proposal-tool.ts`, `diversify.ts`, `night-vibe-schedule.ts`).

**W1 — Propose interaction extensions** (small, pure code; also improve the MCP
tool — keep the tool contract and `docs/TOOLS.md` in lockstep):
1. Per-slot facet pins (protein / cuisine / max_time per night) threaded into
   each slot's `buildPool` gate.
2. Return alternates per slot: top-N lites from the already-computed ranked
   pool, plus nearest-similar and nearest-different-cuisine picks (powers the
   swap menu).
3. Freeform nudge + per-slot vibe override: embed the typed phrase at request
   time (`embedTexts`, precedent in `search_recipes` ranked mode); hash-cache
   embeddings by text.
4. Reconcile "tighten" signal (deterministic sibling of the existing
   `adjust_cadence` stretch: a vibe repeatedly satisfied well before cadence).

**Explicit non-work:** propose-session state (locks/overrides/excludes/seed
across rerolls) lives client-side and replays against the stateless endpoint —
"same choices in, same week out" is already the tool's contract. Do not persist
proposal sessions server-side.

**W2 — Derived to-buy view: no discrete "add the plan to the list" step**
(highest leverage; consolidates the agent and web-app flows into one shape).
`place_order`'s `computeToBuy` (`order.ts`) already derives
`menu_needs ∪ grocery_list(active) − pantry_on_hand` deterministically on
canonical ingredient ids — the normalization work is exactly what makes this
LLM-free. Rather than materializing plan ingredients into the list via an
explicit expansion write, make the **derivation itself first-class**:

- Expose `computeToBuy` as a read (`GET /api/grocery/to-buy` and an MCP
  `read_to_buy`-shaped tool or an extension of `read_grocery_list`). The
  grocery page renders the union: explicit rows (ad-hoc / stockup / pantry_low)
  plus **virtual derived rows** (`source:"menu"`, `for_recipes` provenance,
  computed at read time) — minus what the pantry covers, which renders as the
  "already in your pantry" section with verify nudges.
- Derived rows follow the plan automatically: change the plan, the list
  changes; no sync problem, no stale expansion. Editing a derived row's
  quantity or pinning it materializes that one row (it becomes an explicit
  `source:"menu"` row).
- Both surfaces converge on the same pipeline:
  **derive to-buy → make cart (`place_order`) → substitutions pass** (W4
  deterministic core; ambiguous/unavailable checkpoints remain LLM territory
  dispositioned in Claude, or presented as choices in the app UI).
- Agent side: the persona/skills stop hand-expanding recipes into
  `add_to_grocery_list` calls; skills + `docs/TOOLS.md` update in the same pass
  (tool/skill ownership boundary per CONTRIBUTING.md).

**W3 — Member `in_cart` semantics:** today only `place_order` transitions
status. Add a member-driven `active ⇄ in_cart` toggle (shopping in person) via
`update_grocery_list`; `ordered` remains `place_order`-only.

**W4 — Substitutions, deterministic core** (phase 4): same-identity swaps from
`kroger_prices` + `compare_unit_price` + flyer cache (cheaper / on-sale /
out-of-stock), and cross-ingredient sibling suggestions as a **graph walk over
the ingredient-identity registry** (SAME/SPECIALIZATION edges from the
normalization flow). The SKU matcher keeps its never-substitutes guarantee;
anything beyond price/availability/sibling swaps stays LLM territory in Claude.

**W5 — Aisle capture** (phase 4; the only mockup feature needing new data):
store Kroger `aisleLocations` on the SKU cache at match time; group the grocery
list by aisle for the linked store, department fallback from identity-graph
categories, category fallback with no store. New D1 columns ⇒ migration +
`docs/SCHEMAS.md`.

## 6. Frontend workstreams (member app pages, from the design bundle)

Pages, in dependency order: login → cookbook (browse/search/detail incl. notes
+ similar + Cook-with-Claude deep link) → favorites → meal plan → grocery →
pantry → cooking log → profile (taste read from `retrospective`, preferences,
dietary, brands, Kroger link) → night-vibe palette + reconciliation queue →
propose flow (needs W1) → substitutions panel (needs W4) → aisle grouping
(needs W5).

Offline (the killer feature) is three layers, all library-provided:
1. **Shell:** SW precache (`vite-plugin-pwa`) + manifest → installable, opens
   with zero network.
2. **Reads:** `persistQueryClient` with an IndexedDB persister (localStorage is
   too small once recipe bodies cache). Persist: grocery list, pantry, meal
   plan, cookbook index, visited recipe bodies.
3. **Writes:** TanStack Query paused mutations + `onlineManager`;
   `resumePausedMutations()` on reconnect. Replay is safe because write ops are
   idempotent upserts keyed on canonical ids — keep them that way.

Two-writer posture (agent + app share D1) — full conditional-request machinery,
not just cache heuristics:

- **Reads:** every GET endpoint emits a weak ETag (hash over the underlying
  rows' `updated_at`/content — cheap to derive in the same query) and honors
  `If-None-Match` → 304. TanStack Query's fetcher sends the stored ETag; a 304
  keeps the cached data and skips the body. Combined with short `staleTime` +
  `refetchOnWindowFocus`, agent-made changes surface on the next focus with
  near-zero transfer when nothing changed.
- **Writes:** two classes. (a) *Whole-document writes* (profile markdown
  fields, preferences merge-patch, vibe edits) require `If-Match`; a 412 means
  another writer (usually the agent) got there first — the SPA refetches,
  rebases the edit, and re-presents rather than silently clobbering.
  (b) *Per-item idempotent upserts keyed on canonical ids* (grocery check-offs,
  pantry verify, favorites, log entries) stay last-write-wins **without**
  `If-Match` — this is deliberate, so offline mutation replay never 412s on
  stale row snapshots. Keep write ops in class (b) wherever possible.
- Offline replays upsert by canonical id, never by row snapshot.

## 7. Admin SPA rewrite (final phase — churn over dual maintenance)

Evidence for the rewrite (from the islands audit): navigation, filters, search,
and pagination on every list page are full SSR round-trips; the two busiest
triage islands (`normalize.tsx`, `discovery.tsx`) `location.reload()` after
every mutation; in-place refetches elsewhere are fire-and-forget with no
loading/error modeling. The islands model can't grow a cross-page cache,
optimistic writes, or offline — the SPA stack replaces per-island bespoke fetch
code with the query layer.

- Same stack + `packages/ui`; mounted at `/admin`, **Access gate unchanged**
  (Access cookie works transparently for same-origin fetches; keep the loopback
  `ADMIN_DEV_BYPASS` dev path).
- `/admin/api/*` routes already exist and are already `hc`-typed — only the SSR
  pages and islands are replaced. Design specs: the outer `project/*.jsx`
  screens in the design bundle.
- **The Playwright gate survives the rewrite:** port page objects/specs under
  `admin/visual/` to the SPA, keep `aubr test:admin` blocking in CI, keep the
  sticky screenshot comment. The rewrite is not done until the visual suite
  passes on the SPA.
- Retire `hono/jsx` SSR pages, islands, and their esbuild step when parity is
  reached; update `src/admin/CLAUDE.md` to the new modeling standards (the
  Loadable/assertNever discipline maps onto Query states).

## 8. Toolchain, CI, deploy

- New workspaces: `packages/app`, `packages/ui` (pnpm/aube `workspace:*`; Vite
  enters the toolchain via mise/aube — no global installs; respect
  `aube-lock.yaml`).
- Scripts: `aubr dev` gains a mode running Vite dev (proxying `/api` to
  `wrangler dev`) alongside the Worker; `aubr build:app` → `packages/app/dist`
  wired into the assets dir; CI builds it like `build:admin` today.
- Playwright: **mandatory from P0, blocking in CI from the first PR** — the
  harness (page objects, seeded `wrangler dev`, per-area screenshots;
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in web sessions) is part of P0's
  acceptance, not a later phase. Rule extends: an app change ships with its
  Playwright coverage, same as the admin rule today. No phase merges without
  its specs.
- Deploy: add `packages/app/**` (and `packages/ui/**`) to `ci.yml`'s
  `trigger-deploy` path filters; add the assets-config shape to
  `scripts/merge-wrangler-config.mjs`; deploy builds the SPA before publishing.
- Docs in lockstep, same pass: new tool params/tools → `docs/TOOLS.md`; SKU-cache
  aisle columns + session store → `docs/SCHEMAS.md`; the app's existence, auth
  model, and the member-app mount → `docs/ARCHITECTURE.md` + `README.md` +
  `docs/SELF_HOSTING.md` (invite codes now also grant web login — operator
  setup text changes); `CLAUDE.md` build commands.

## 9. Explicitly out of scope

- Chat in the web app (anything conversational deep-links to Claude.ai).
- SSR/SEO for the member app (`/cookbook` remains the public SSR surface).
- SaaS auth, CORS, server-side propose-session state.
- Conflict resolution beyond §6's ETag/If-Match model (no CRDTs, no merge UI).
- Passkeys (future option, not initial scope).

## 10. Phases (orchestrator execution order)

Each phase lands independently green (typecheck, `aubr test`, Playwright where
UI changes) and PR-able. Backend phases are serial where they touch shared
surfaces (tool registration, `scheduled()`, docs); frontend page work within a
phase parallelizes freely.

- **P0 — Foundations:** session auth (login/logout/middleware/CSRF/rate-limit/
  revocation), `/api` mount + error middleware, `packages/app` + `packages/ui`
  scaffold, wrangler assets config + merge-allowlist + deploy paths, Playwright
  harness for the app, `aubr` scripts. *Acceptance: invite code logs into a
  hello-world SPA at `/` in `wrangler dev` and in Playwright.*
- **P1 — Member core (existing ops only):** cookbook, favorites, plan, grocery
  (minus subs/aisles), pantry, log, notes, profile, palette + reconciliation
  queue. W3 (`in_cart` toggle) lands here.
- **P2 — Propose:** W1 tool extensions, then the full propose flow UI
  (client-side session, live refetch with `keepPreviousData`, lock/swap/
  exclude/pins/freeform, commit with `from_vibe`).
- **P3 — Grocery power:** W2 derived to-buy view (virtual menu rows, pantry
  cross-ref + verify nudges), `place_order` preview/commit UI, agent
  skill/persona consolidation onto the derive→cart→substitutions pipeline.
- **P4 — Differentiators:** W4 substitutions, W5 aisle grouping, trending +
  picked-for-you rows.
- **P5 — Offline/PWA hardening:** persister, paused-mutation replay, SW update
  prompt, version-skew header, install UX. *Acceptance: airplane-mode opens the
  app with the grocery list; check-offs replay on reconnect.*
- **P6 — Admin SPA:** per §7, then retire SSR/islands and their build step.

## 11. Open decisions for the operator (small; defaults stated)

1. Member app at `/` (default, recommended) vs `/app`.
2. Session lifetime (default 90d rolling) and whether login requires the invite
   code every time a session expires (default: yes — no passwords, no email).
3. SW update flow: prompt (default) vs auto-on-idle.
4. Whether W1's propose extensions are also exposed to the MCP tool surface
   immediately (default: yes — one contract, `docs/TOOLS.md` updated same pass).
