# Design — Config corpus editors

## Context

The five tables are all in `migrations/d1/0006_shared_corpus.sql`, all global (no `tenant` column):

| Table | PK | Other cols | Add today | Remove today |
|-------|----|-----------|-----------|--------------|
| `aliases` | `variant` | `canonical` | `update_aliases` (upsert) | — |
| `flyer_terms` | `term` | — | — (raw D1 only) | — |
| `feeds` | `url` | `name?`, `weight?`, `tags[]` (JSON) | `update_feeds` (add-only) | — |
| `discovery_senders` | `address` | `name?` | `update_discovery_sources` (add-only) | — |
| `discovery_members` | `address` | — | `update_discovery_sources` (add-only) | — |

They are read-only in `Data → Corpus` via the generic `Data.Table` browser, and `/admin/api/data/*` is `405` on any non-GET by charter. This change adds a **separate** writable surface rather than relaxing that charter — the Data explorer stays a pure read mirror.

## Decision 1 — Routed sub-views, not scroll-sections

The Config area follows the **Data area's routed-pill** pattern: a `ConfigRoute` union, one sub-view per pill, deep-linkable, fetch-on-demand. (The Dev area's scroll-to-stacked-section pattern was the other option; rejected because six independent editors each with their own `RemoteData` load are better as discrete routes than one tall page firing six fetches on entry, and per-editor deep links are useful for the operator.)

```
/admin/config                → Calibration (default, the existing console, moved verbatim)
/admin/config/aliases        → TableEditor aliasesConfig
/admin/config/flyer-terms    → TableEditor flyerTermsConfig
/admin/config/feeds          → TableEditor feedsConfig
/admin/config/senders        → TableEditor sendersConfig
/admin/config/members        → TableEditor membersConfig
```

`Route.elm` gains `ConfigRoute = Calibration | Aliases | FlyerTerms | Feeds | Senders | Members` with slug parse/print, exactly paralleling `DataRoute`. `Config.elm` becomes a shell (`Section` union of the live sub-view + its model, like `Data.Section`) with a `goto` that preserves a sub-view's state on same-view navigation and builds fresh otherwise. `Main.elm` wires `Config` the way it already wires `Data` (a `stepTo`/`enter` arm delegating to `Config.goto`/`Config.init`). The bare `/admin/config` resolves to `Calibration`, so existing deep links and the spec's "Config area deep-links" scenario keep working.

## Decision 2 — One generic `Config.TableEditor`, configured per table

The five editors differ only in *columns and endpoint*, the same way the three `Data.Table` groups differ only in *which tables*. So a single generic module, configured by a record:

```elm
type alias EditorConfig =
    { title : String              -- "Ingredient aliases"
    , slug : String               -- "aliases" → /admin/api/corpus/aliases
    , columns : List ColumnSpec    -- label + which Row field, render order
    , decodeRow : Decoder Row
    , encodeAdd : Draft -> Encode.Value
    , rowKey : Row -> String       -- the PK, for the DELETE path segment + remove identity
    , addFields : List FieldSpec   -- the add-form inputs (text / number)
    }
```

`Row` holds the table's cells (a small record per config, or a `Dict String Value` like `Data.Table` — lean toward an explicit record per table so the view is typed). The module owns the list fetch, the add-form draft, and the remove action. It is generic over the *shape of one row* only to the extent the configs need; if that genericity fights the type system, fall back to five thin modules sharing a common `Config.EditorView` helper — the spec constrains behavior, not the module count.

### State model (per `admin/CLAUDE.md`)

```elm
type alias Model =
    { config : EditorConfig
    , rows : WebData (List Row)     -- the four-state load (rule 1)
    , draft : Draft                 -- the add-form inputs (free text → String fields)
    , action : ActionState
    }

type Operation  = Add | Remove String          -- the row key being removed
type ActionState
    = Idle
    | Busy Operation
    | Failed Operation Http.Error
```

`Busy`/`Failed` carry *which* operation, so "an add is in flight", "a remove of row X is in flight", and "the last mutation failed, with its error" cannot contradict, and one-mutation-at-a-time is structural (rule 3). On a successful add/remove the editor refetches the list (authoritative server state) rather than locally patching `rows` — derive, don't store (rule 4). No `_ ->` swallow in `update`/`view` (rule 5).

## Decision 3 — `/admin/api/corpus/<table>`, a new writable namespace

A self-contained group so an editor talks to one base path (not split across the read-only `/admin/api/data/*` and a write path):

| Method + path | Action |
|---------------|--------|
| `GET /admin/api/corpus/<table>` | list rows (`{ rows: [...] }`) |
| `POST /admin/api/corpus/<table>` | add one row from the JSON body (validated) → refetch-ready |
| `DELETE /admin/api/corpus/<table>/<key>` | remove by primary key |

`<table>` is matched against a fixed allowlist (`aliases | flyer-terms | feeds | senders | members`) → its D1 helper; an unknown table is `not_found`, a bad method `unsupported` (405), mirroring `routeAdminApi`'s existing style. The handler sits **before** the read-only `/admin/api/data/` block so it's unambiguous. Validation per table: non-empty PK; `aliases` needs a non-empty `canonical`; `feeds` needs a URL and a numeric `weight` (default 1) and `tags` as a string array; addresses are trimmed + lowercased. Errors are structured `ToolError` (`validation_failed` / `storage_error`), serialized by the existing caller — no throws.

### Add semantics match the existing tools

- `aliases` — **upsert** (PK `variant`); re-adding a variant overwrites its canonical. The editor's add-form doubles as edit; the row list shows the current mapping.
- `flyer_terms` / `feeds` / `senders` / `members` — **insert-or-ignore** (add-only dedup), the same semantics the MCP add tools use, so the admin add path and the agent add path converge on the same row.

### Delete semantics

New `corpus-db.ts` helpers, each a single `DELETE … WHERE <pk> = ?1` through `src/db.ts` (precedent: `deleteStore`), returning whether a row was removed. Address-keyed deletes (`senders`, `members`) **normalize the key** (trim + lowercase) before the `WHERE`, because the add side stored it normalized — otherwise a delete of `"Foo@Bar.com "` would miss the stored `"foo@bar.com"`. `addFlyerTerms(terms)` is new (insert-or-ignore over the bare `term` PK).

## Determinism / ownership boundary

Nothing here crosses into LLM territory — these are deterministic operator edits to plain lookup tables, inside the Worker, behind Access. The agent's add tools are untouched; remove is deliberately *not* an agent capability (it's destructive group-wide config), so the determinism boundary and the "agent adds, operator curates" split are preserved.

## Risks / tradeoffs

- **Redundant read surface.** These tables remain visible in `Data → Corpus` *and* now editable in `Config`. Acceptable: Data is the raw uniform explorer; Config is the curated typed editor. We do not make the Data view editable (its read-only charter is load-bearing).
- **Generic-editor friction.** If `Config.TableEditor`'s row genericity fights Elm's records, split into per-table modules over a shared view helper — behavior (the spec) is unchanged either way.
- **No bulk import.** The editor is row-at-a-time; seeding many feeds/terms at once still uses `rclone`/MCP/`wrangler`. Out of scope.
