## Context

Every human-facing ingredient name in the system is either the raw string a member happened to type or a per-read synthesis from a canonical id — never a stored, curated value. The identity/display distinction is collapsed at three planes:

```
PLANE 1  ingredient_identity(id, base, detail, search_term, representative, concrete, …)
         id = "cabbage::color-red"  ← append-only JOIN KEY
         display = ✗ none. labelOf(id) fabricates "cabbage (color-red)" per read (corpus-db.ts:312)
         search_term = "red cabbage" ← Kroger query phrase, NOT a display name

PLANE 2  grocery_list / pantry   PK = (tenant, normalized_name)
         name            = raw member string     ← DISPLAY ─┐
         normalized_name = groceryKey(name,…)     ← KEY (PK) ┴─ derived from name @WRITE
         GroceryItem/PantryItem DROP normalized_name → ops RE-DERIVE resolve(item.name) @READ

PLANE 3  read surfaces
         default read_to_buy: to_buy[].name / pantry_covered[].name / in_cart[].name  ← byte-identity fence
         enriched read: substitutes[].label = labelOf(id); relation.via = raw id; placement.department = raw id
```

**Two couplings, not one.** (1) *Write-derivation*: `normalized_name = groceryKey(name, kind, domain, resolve)` (`grocery.ts:78-85`), so the key is a pure function of the display at write. (2) *Read-re-derivation*: the item shapes drop `normalized_name`, so `findIndex` (`grocery.ts`), `advance`/`rollback` (`session-db.ts`), and pantry `matches` (`pantry-write.ts`) recompute `resolve(item.name)` instead of trusting the stored PK. The cabbage bug is coupling #1 firing (post the id as `name` to make it resolve → render the id); the naive `labelOf` fix trips coupling #2 (`resolve("cabbage (red)")` mints a garbage key → dedup breaks).

**What is already half-built** (this is smaller than it looks): the row already stores a key column (`normalized_name`, the PK); `ToBuyViewLine` already carries `{name, key}` (`order-shapes.ts:98-126`); `labelOf(id)` is the single choke point where an id becomes display text; and `search_term` is the exact template for a captured-once, human-overridable, reconcile-backfilled node string.

## Goals / Non-Goals

**Goals:**
- Store a curated `display_name` per identity node, replacing `labelOf`'s per-read synthesis with a stored value (synthesis becomes the fallback).
- Let a grocery/pantry row carry a display independent of its key, and let the key be supplied independently of the display (add-by-id), so a sibling swap materializes a row that both resolves exactly and renders cleanly.
- Thread the stored key into the in-memory item shapes so the set-algebra keys on the stored id, never a re-derivation of the display.
- Render the reified name at the app-facing read surfaces (`read_grocery_list`, enriched `read_to_buy`, incl. the two bare-id surfaces) while holding the default `read_to_buy` byte-identical.

**Non-Goals:**
- Reifying store / aisle / department as first-class entities with their own display tables (Tier 3, follow-on). `placement.department` is already an ingredient base id, so its label falls out of this change; genuine store/aisle labels are a separate data model.
- Renaming or restructuring canonical ids. Ids stay append-only; merges stay on the `representative` pointer.
- Changing the matcher. `display_name` is not a matcher input — Kroger search and identity-relevance keep using `search_term` and query content-tokens.
- Changing the default `read_to_buy` output shape or its per-line `name` sourcing.

## Decisions

### The three moves

- **Move A — reify `ingredient_identity.display_name`** (Plane 1). Nullable `display_name TEXT`. `labelOf(id)` becomes `row.display_name ?? (detail ? \`${base} (${detail})\` : base)`.
- **Move B — decouple the row's key from its display** (Plane 2). New nullable `display_name TEXT` on `grocery_list` and `pantry`; thread `normalized_name` into `GroceryItem`/`PantryItem`; add an explicit-`id` write path.
- **Move C — render the reified display at the audited surfaces** (Plane 3), honoring the byte-identity fence on the default read.

### Fork 1 — Scope = Tier 1+2 (ingredients + enriched raw-id surfaces)

Tier 1 (identity node + grocery/pantry rows + sibling labels) is the coherent minimum that fixes the bug and reifies the model. Tier 2 — the two enriched-read surfaces that render bare ids as human text (`substitutes[].relation.via`, `placement.department`) — is a near-free rider once identity carries `display_name`: same lookup, enriched read only, no byte-identity risk. *Alternative rejected:* Tier 3 (store/aisle/department entities) — materially larger, a distinct data model, and `placement.department` already resolves to an ingredient base id, so the visible department label is covered by Tier 2 anyway.

### Fork 2 — Row split = B2 (new `display_name` column; `name` unchanged)

The row gains a genuinely new `display_name` column; `name` keeps its current role (surface form / resolver input), `normalized_name` stays the key/PK, and surfaces render `display_name ?? name`.

*Why B2 over B1 (make `name` the pure display, supply the id on writes, no new column):* B1 re-overloads `name` (still resolver-input on typed adds, now also the reified display) and it perturbs the **default** `read_to_buy`'s existing `name` strings (changing a stored `name` to a clean label changes what that line emits). B2 keeps the default read byte-identical — it still emits `name` — and makes the row's three roles (input / key / display) explicit columns rather than one field wearing three hats. The migration cost is the same order either way, since add-by-id already forces a write-contract change.

**Non-negotiable corollary (true under either fork):** thread `normalized_name` into `GroceryItem`/`PantryItem` and have `findIndex`, advance/rollback, and pantry `matches` key on the **stored** id. Without this, a row whose `display_name`/`name` no longer equals `resolve(name)` silently falls out of the set-algebra. This closes coupling #2.

### Fork 3 — Typed-add display = C3 (hybrid)

Preserve the member's phrasing for typed adds (stored as `name`); for **id-named** rows — add-by-id, plan-derived, and legacy — the human label is resolved at read from the reified node. A row is id-named when its stored `name` equals its canonical key. Render resolution:

```
display = row.display_name (explicit override, rare)
       ?? (row.name === row.key ? ctx.idLabel(key) : row.name)   // id-named → node label; typed → member phrasing
   where ctx.idLabel(key) = identity.display_name(key) ?? base(detail) synthesis   (never a raw id)
```

*Why:* the two ugly cases are exactly the no-phrasing cases; typed adds already render fine member voice. *Alternatives rejected:* preserve-always (add-by-id/plan lines still need a fallback, and two spellings of one id diverge on the list); canonicalize-always (erases member voice — "scallions" → "Green onions" jars).

**Merge-survivor rule.** The prior `normalize-grocery-pantry-identity` change defined merge rules for every column except `name`. Under C3: when two surface forms dedup to one row, keep the surviving row's existing phrasing (grocery already keeps first; **align pantry to keep-first**, which currently overwrites with the latest surface form). Because the curated `identity.display_name(key)` fallback is identical regardless of which surface form won, the *rendered* string is stable either way — so this is a consistency fix, not a behavior the member can observe diverging.

### Fork 4 — Curation source = classifier-at-import + human override + reconcile backfill

`display_name` is populated exactly like `search_term`:
- **Classifier at import.** Extend the classifier's `IdentityConfirm` contract (`ingredient-classify.ts:40-54`) with a `display_name` field — the model already returns a human `reason` sentence, so a clean label is in-band, and no new determinism-boundary crossing is introduced (LLM proposes; plain code validates, places, and protects). Commit via `commitResolution` with `COALESCE`-on-conflict so an existing value is never downgraded.
- **Human override** via `update_aliases` → `addAliases`, written `source='human'` and protected by the existing "human wins" precedence.
- **Reconcile backfill** for the existing NULL backlog: a bounded per-tick pass shaped like `backfillEmbeddings` (`ingredient-normalize.ts:507-526`). Deterministic reshape passes (`repairSegmentOverflow`, `applyDisjunctionRepair`) set a deterministic `display_name` when they mint bases, just as they already set `search_term`.

*Alternatives rejected:* reconcile-derived-only (no classifier change, weaker on irregular names like "80/20 ground beef", "half and half"); human/vault-only (leaves most of the graph on `labelOf` synthesis indefinitely; the identity graph has no vault surface — `src/vocab.js` is recipe-facet vocab only). **Not the recipe projection** — it reads the resolver read-only and never writes identity rows.

### Open seam D (resolved) — store the display as `name`, thread the key

An add-by-id row stores the human **display** as `name` (the caller's posted label — the app's `sib.label` — else `ctx.idLabel(id)`, never a raw `::` id) and the canonical **id** as `normalized_name` — the two stored separately, which is the actual reification. The stored key is threaded through the set-algebra (`computeToBuy` and the `to-buy` wrappers via `storedGroceryKey`, advance/rollback via a carried line `key`) and `sku_cache` (keyed on the canonical id via `toMapping`), so dedup, pantry subtraction, in-flight suppression, and matching all key on the id while **every read renders the display `name` natively** — no per-surface reification. The matcher is fed the display (natural language) and searches + scores identity-relevance on the node's `search_term`, caching under the id (no fragmentation; byte-identical `sku_cache` key for typed rows, whose `normalize(name)` already equals the id).

Two cases resolve their label at **read time** via `ctx.idLabel(key) = identity.display_name(key) ?? base(detail) synthesis`: **legacy** id-named rows (`name === normalized_name`, created before this change) and **plan-derived** virtual lines (no stored row). Both converge as the reconcile backfills the node's `display_name` — the acceptance fixture (the legacy `cabbage::color-red` row) renders "Red cabbage" with zero row edits, via `readGroceryListReified` (`read_grocery_list` / `GET /api/grocery`) and the enriched to-buy rule. The grocery/pantry `display_name` column is an **optional explicit per-row override** (highest read precedence; usually null). The default `read_to_buy` stays byte-identical for typed rows (`storedGroceryKey` equals the old `groceryKey(name)` there).

### Open seam (resolved) — MCP `add_to_grocery_list` gets the explicit-`id` param too

Add the optional canonical `id` param to the MCP `add_to_grocery_list` tool symmetrically with `POST /api/grocery/items`, not app-only. An agent accepting a graph-sibling suggestion has the identical need (materialize a row that resolves exactly while rendering cleanly), and the tool-vs-skill boundary says the tool description owns its params and guarantees. The tool description gains: when `id` is supplied it is treated as an already-canonical key (validated, not re-resolved) and the display is taken from the identity's `display_name`.

### The invariant fence (stated so implementation and review can check it)

| Invariant | Where it lives | How this change respects it |
|-----------|----------------|-----------------------------|
| Set-algebra keyed on the canonical id | `computeToBuy` (`order.ts:83-140`), `to-buy.ts` wrappers, `place_order`, satellite pull-list | `display_name` is inert payload; keying threads the **stored** `normalized_name`, never the display |
| Ids append-only, never renamed (merge via `representative`) | `ingredient-normalization` | Display is the pressure-relief valve — the **label** is renameable precisely because the **id** is not |
| Resolve-only matcher, no fabrication; `display_name` not a matcher input | `ingredient-matching`, `matching.ts` | Matcher keeps using `search_term` + query content-tokens; identity-relevance scoring untouched (negative spec scenario) |
| Default `read_to_buy` = same shared op, byte-identical | `member-app-grocery`, `to-buy.ts` | Display rides on the enriched read (new field) + the stored row; default read's fields and `name` sourcing unchanged |
| `isFoodItem` guard — non-food never enters the graph | `grocery-list`, `grocery.ts` | Add-by-id is a food-only path (canonical ids are food); non-food adds still key on `normalizeName` |

## Risks / Trade-offs

- **[Add-by-id with an unknown/invalid `id`]** → validate against `validateCanonicalId` and (ideally) node existence; on failure fall back to today's `resolve(name)` behavior rather than storing an unresolvable key. The write path must never store a key that no identity node backs.
- **[Stored row `display_name` goes stale if the identity label later improves]** → accepted per the convergence rule; the enriched read looks up live, and a reconcile touch-up is a possible follow-on. No hand-edits.
- **[Byte-identity regression]** → the default `read_to_buy` shared-op tests must pass unmodified; adding `display_name` only to the enriched path (and to `read_grocery_list`, which is a separate read) is the guardrail. A test asserts the default read's shape is unchanged.
- **[Merge changes an observed display]** → aligning pantry to keep-first changes which surface form is stored, but the rendered string is stable because the curated fallback is identical; covered by a merge scenario + test.
- **[Classifier omits or fabricates `display_name`]** → nullable column + `labelOf` fallback means a missing value degrades gracefully to today's synthesis; a fabricated-but-wrong label is human-overridable and never affects any key or match.

## Migration Plan

1. **D1 migration** `migrations/d1/NNNN_display_names.sql`: `ALTER TABLE ingredient_identity ADD COLUMN display_name TEXT;` + same for `grocery_list` and `pantry`. All nullable — existing rows read as NULL and fall through to `labelOf` / `name`. Deploy applies `--remote`.
2. **Ship the read/write code** guarded by the `?? name` / `?? labelOf` fallbacks so it is correct before any value is backfilled.
3. **Backfill converges organically** on the reconcile cron — no hand-edits.
4. **Acceptance fixture:** the production grocery row already stored as `cabbage::color-red` (and any peers surfaced by `read_grocery_list`) is the fixture — after deploy, verify the reconcile + read path renders "Red cabbage" against production. Rollback: the columns are additive and nullable, so reverting the code degrades cleanly to synthesis; the columns can stay.

## Open Questions

- None blocking. The two seams above (D-placement, MCP-tool param) are resolved; both are revisitable in review without reshaping the change.
