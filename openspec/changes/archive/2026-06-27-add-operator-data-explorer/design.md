## Context

The operator admin panel (`operator-admin`) is an Elm `Browser.application` under `/admin`, Cloudflare-Access-gated, with three top-level areas: **Status** (`/health`), **Members** (tenant lifecycle), and **Dev · Tools** (run MCP tools as a chosen tenant). It has no window into the *data itself*.

There are three storage tiers (see `docs/ARCHITECTURE.md`): the authored markdown **R2 corpus** (`recipes/*.md`, `guidance/**/*.md`), all operational/relational data in **D1** (~27 tables — per-tenant, shared corpus, derived, attributed, operational), and ephemeral infra in **KV**. The Dev tool console already reads per-tenant data, but only *as one tenant, through the validated tool contract* — it structurally cannot do cross-tenant aggregates, reach the ~10 tables with no read tool, show raw R2 objects, or join the tiers. Debugging "why isn't my recipe in the index?" or "what's in carol's pantry?" today means `wrangler d1 execute` and `rclone` by hand.

Three decisions were settled in exploration and constrain this design: the explorer is **read-only** (v1), the operator **sees everything with no in-group privacy** (no redaction), and it uses **curated, typed views** (not a generic table browser).

## Goals / Non-Goals

**Goals:**
- An in-panel, read-only window into D1 and the R2 corpus as a fourth top-level **Data** area.
- Five entity-centric views — Recipe, Member, Shared corpus, Discovery, System — that together reach **every** D1 table and both R2 trees (total coverage by ~5 views, not 27 screens).
- A cross-tier **Recipe** view that makes the index pipeline debuggable: R2 source ↔ `recipes` projection ↔ `recipe_derived` ↔ `reconcile_errors`, reduced to one projection status.
- Reuse the existing canonical readers; add new D1 code only for the genuinely-new cross-tenant aggregates and bare lookup tables.
- Typed Elm per `admin/CLAUDE.md` (WebData, custom types for finite states, no `Bool`/`Maybe String` state machines).

**Non-Goals:**
- Any write / edit / delete of D1 or R2 (read-only; writes stay behind validated tools).
- The KV tier, and any secret/credential (Kroger/OAuth tokens) — scope is D1 domain data + R2 corpus.
- A generic SQL console / arbitrary-query surface — each endpoint is a fixed query over a named entity.
- Rich pagination — only a bounded default on the two growing tables (`sku_cache`, `cooking_log`).
- Any change to the Access gate or a new auth surface — the Data area inherits `/admin*`'s gate verbatim.

## Decisions

### D1. Curated typed views (B), not a generic table browser (A)

A generic "pick a table → rows" browser would cover all 27 tables with one code path, but it is stringly-typed, fights the repo's "model impossible states" ethos, and either exposes arbitrary SQL or needs an allowlist anyway. The repo's whole personality (coarse opinionated tools, typed Elm) pulls the other way. We model the **entity**, not the table: most tables are one facet of one of five aggregates, and the same row is reachable from whichever axis the operator is investigating (`overlay` under both Recipe and Member; `recipe_notes` by-recipe and by-author). Coverage stays total; the surface stays typed.

### D2. Fold the R2 browser into Recipe; guidance rides under Shared-corpus

Recipes are the dominant R2 content and are inherently per-slug, so the raw `recipes/<slug>.md` source belongs *in* the cross-tier Recipe view. That leaves `guidance/**` (the other authored-markdown tree — ingredient_storage / cooking_techniques / purchasing) without a home. It is shared authored corpus, not per-slug and not tabular, so it rides under the **Shared corpus** view alongside the shared lookup tables, reusing the markdown viewer the Recipe view already needs. (Alternative: a standalone Corpus view — rejected to keep the area at five views; alternative home under System — rejected because guidance is corpus content, not operational state.)

### D3. New `operator-data-explorer` capability + one `operator-admin` modification

The explorer is large and cohesive enough to own its spec, matching the repo's granular capability style (`cookbook-search`, `recipe-sides`). It *shares* operator-admin's plumbing (the Access gate, the `/admin/api/*` surface, the SPA shell) rather than bloating the member-lifecycle spec. The single spec-level change to `operator-admin` is its "top-level areas" requirement, which enumerates Status/Members/Dev and now must include **Data**.

### D4. Recipe projection status is a server-derived custom type

The cross-tier value is a single status over the truth table of (R2 source present?, `recipes` row present?, `reconcile_errors` entry?, `recipe_derived` filled?). Modeled as a union so impossible combinations ("indexed *and* skipped") are unrepresentable:

```elm
type RecipeTier
    = Indexed DerivedState   -- R2 source + recipes row              (healthy)
    | Skipped ReconcileError -- R2 source, no row, reconcile reason  (the "why")
    | PendingReconcile       -- R2 source, no row, no reconcile yet
    | Orphaned               -- recipes row, no R2 source            (stale projection)

type DerivedState = Described | DescriptionPending   -- recipe_derived filled vs null
```

The Worker computes the discriminant from the four sources; Elm decodes one tagged value. Booleans (`indexed`, `skipped`, `hasError`) are rejected — they can contradict.

### D5. Reuse canonical readers; one thin new module for the rest

Per-tenant reads (Member view) reuse `src/profile-db.ts` + `src/session-db.ts`; recipe reads reuse `src/recipe-index.ts` + `src/corpus-store.ts`. These already route through `src/db.ts` and are the tools' own readers, so the explorer can't drift from what the agent sees. The only genuinely-new D1 code — a thin `src/admin-data.ts` — is the **cross-tenant aggregates** (existing readers are all tenant-scoped: e.g. "every tenant's overlay/notes for slug X") and the **bare lookup tables** (`aliases`, `flyer_terms`, `sku_cache`, the discovery/system tables) that have no reader today. It never touches `env.DB` directly; it calls `db(env)`.

### D6. A top-level Data area, not a Dev pill

Five views is too much for the Dev area's pill sub-nav. **Data** becomes a fourth area peer to Status/Members/Dev, with each entity a client route (`/admin/data/recipes/<slug>`, `/admin/data/members/<id>`, `/admin/data/corpus`, `/admin/data/discovery`, `/admin/data/system`) so views deep-link and survive refresh, mirroring how `Tools` carries a selected tool. New `Route` variants + a `DataPage` arm in `Main.elm`'s `Page` union.

### D7. Entity-centric API, one bundle per entity, fixed queries

`GET /admin/api/data/*` mirrors the entities. A detail view fetches **one bundle** (one request → one `WebData`), not N sub-requests — e.g. `/recipes/<slug>` returns the whole cross-tier record, `/members/<id>` the whole 360. Flat views (`/corpus/<table>`, `/discovery/<table>`, `/system/<table>`) return a table's rows. Every endpoint runs a fixed query keyed by a path segment matched against an allowlist of names — no operator-supplied SQL ever reaches D1.

### D8. Bound the two growing tables; simple limits elsewhere

Only `sku_cache` (one row per ingredient×location) and `cooking_log` (append-only) grow without bound; everything else is small for a friends group. Their endpoints take a default `LIMIT` (most-recent-first where ordered). Keyset pagination is deferred — a self-hosted group won't hit the scale where `LIMIT`/`OFFSET` hurts, and adding a cursor later is non-breaking.

### D9. No redaction simplifies the code

Because the group has no assumed internal privacy, there is **no redaction path**: cross-tenant aggregates name tenants, `private` notes render plainly, and there's no per-field gating logic to write or test. The one scoping rule is by *tier*, not by tenant: the explorer reads D1 domain data + the R2 corpus only, never KV secrets (Kroger/OAuth tokens), so "sees everything" can't leak credentials.

## Risks / Trade-offs

- **Every member's personal data in one operator view** → Mitigated by the existing Access gate (opt-in, fails closed, loopback-only dev bypass) and the deliberate no-in-group-privacy model. Scope is bounded to D1+R2 so no secret/token is reachable even though "the operator sees everything."
- **`Orphaned` status is transient** (the reconcile rebuilds `recipes` wholesale from R2, so an orphan clears next tick) → Documented as *observable, not necessarily actionable* — it's a window into a mid-reconcile or just-deleted state, not an error to fix.
- **Five Elm views is real surface area** → The three flat views (Shared corpus, Discovery, System) share one generic typed table renderer (header + rows from a decoded `List (List Cell)`); only **Recipe** and **Member** are bespoke domain models. Keeps the bespoke modeling where it earns its keep.
- **`recipe_embeddings` / `recipe_derived.embedding` are 768 floats** → Show *presence + hash*, never the raw vector; it's noise in a viewer.
- **The committed `admin/dist/` bundle must be rebuilt** and the Elm compiler needs `package.elm-lang.org` → If the build box can't reach it, say so and leave the rebuild to CI rather than committing a stale bundle (per `admin/CLAUDE.md`).

## Migration Plan

No D1 migration and no new binding — the explorer reads existing `DB` + `CORPUS`. Deploy is the normal path: Worker change + `aubr build:admin` rebuilding the committed bundle, shipped by the data-repo deploy. Rollback is a plain revert; because the surface is read-only it changes no data, so there is nothing to undo beyond removing the routes. Docs updated in the same pass: the `/admin/api/data/*` endpoints into the "Operator admin surface" section of `docs/SCHEMAS.md`, and the Data area noted in `docs/ARCHITECTURE.md`'s admin overview.

## Open Questions

- **Guidance home** — placed under Shared corpus (D2). If the operator would rather inspect guidance under System, it's a one-line move; flagged for review, not blocking.
- **`cooking_log` ordering** — default to most-recent-first with a `LIMIT`; revisit if a member's history outgrows a single bounded read (then keyset on `(tenant, date)`).
