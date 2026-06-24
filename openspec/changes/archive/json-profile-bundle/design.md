## Context

`unified-user-profile-kv` moved per-tenant operational state from GitHub into DATA_KV. The session-state keys (`state:<username>:pantry|meal_plan|grocery_list`) were re-shaped into native JSON arrays during that move, but the `profile:<username>` bundle was lifted *verbatim* — each field still holds the raw text of its former GitHub file. So the bundle is JSON on the outside, TOML/markdown on the inside:

```
profile:<username>   (JSON.parse)
  ├─ preferences    "default_cooking_nights = 3\n[brands]\n…"   ← TOML string, parseToml on read
  ├─ taste          "I lean spicy, …"                            ← markdown string (prose)
  ├─ diet_principles "Fish once a week. …"                       ← markdown string (prose)
  ├─ kitchen        "owned = [...]\n[notes]\n…"                  ← TOML string, parseToml on read
  ├─ staples        "# header\n[[items]]\n…"                     ← TOML string, parseToml on read
  ├─ overlay        "[overlay.slug]\nstatus = …"                 ← TOML string, parseOverlay on read
  ├─ ready_to_eat   "[[items]]\n…"                               ← TOML string, parseToml on read
  └─ stockup        "# header\n[[items]]\n…"                     ← TOML string, parseToml on read
```

Every read decodes TOML inside the JSON decode. Every write re-encodes TOML and (for staples/stockup) re-attaches a `# header` documentation comment whose only purpose was human readability of a GitHub file — a file that no longer exists in GitHub. `overlay` is serialized by a hand-rolled TOML writer (`serializeOverlay` + `quoteKey` + `formatScalar`). All of this is overhead in service of an editability requirement that ended when the data left GitHub.

`preferences` is server-consumed, not opaque: `tools.ts` calls `parseToml(bundle.preferences)` in `read_user_profile`, `read_preferences`, the weather location resolver, and the matcher wiring; `matching.ts` reads `[brands]` for the Kroger confidence gate. Yet its write contract is the weakest of all the fields — the agent supplies a whole TOML string stored verbatim, and the `configure-grocery-profile` skill must instruct the agent to re-read and rewrite *every* field on each write to avoid clobbering the store ZIP.

## Goals / Non-Goals

**Goals:**
- The six structured profile fields are stored as native JSON values inside the bundle; the only decode on read is the outer `JSON.parse`.
- `preferences` has a typed top-level schema plus an open `custom` object, and a deep merge-patch write contract that removes the clobber footgun.
- Delete the TOML serialize/header machinery and the hand-rolled overlay serializer.
- Hard cutover via a one-shot migration; no dual-shape read branches.

**Non-Goals:**
- Moving `cooking_log` to KV, or retiring `commit_changes` — tracked in the `finish-kv-migration` change.
- Changing `taste` / `diet_principles` — they stay JSON strings (prose, not records).
- Touching the GitHub-tracked shared corpus, which remains TOML for genuine human editability.
- Adding KV conditional-put concurrency (single user per session at friend-group scale).

## Decisions

### Decision: Six fields become native JSON; the two markdown fields stay strings

`kitchen`, `staples`, `overlay`, `ready_to_eat`, `stockup`, `preferences` are stored as objects/arrays inside the `profile:<username>` JSON object. `taste` and `diet_principles` remain JSON strings.

**Rationale:** The six carry records the Worker parses and mutates; storing them as objects removes a redundant codec layer. `taste`/`diet_principles` are freeform prose the Worker never parses — JSON-encoding them would just wrap markdown in a string, no benefit.

**Consequence:** `ProfileBundle` field types change. The pure helpers (`parseStaples`, `addStockup`, `toInventory`, `parseOverlay`, `readyToEatManager`) lose their TOML parse/serialize steps and operate on objects. `parseToml`/`smol-toml` leave the KV path entirely (still used for the GitHub corpus).

### Decision: `update_preferences` is a JSON Merge Patch (RFC 7396)

The tool takes `patch: object`, applied over the current `preferences` object with RFC 7396 semantics: a key present in the patch sets/overwrites; a key whose patch value is `null` is deleted; nested objects merge recursively to arbitrary depth; arrays replace wholesale.

**Rationale:** Preferences' entire mutation vocabulary is "set or delete a key," which is exactly merge-patch. Crucially it solves the `[brands]` tri-state for free — `brands` distinguishes *absent* ("ask me"), `[]` ("don't care"), and `[…]` ("ranked"), and merge-patch's value-vs-`null` maps onto it directly:

```
  patch fragment                          brands.olive_oil becomes   matcher behavior
  { brands: { olive_oil: ["Cobram"] } }   ["Cobram"]                 confident, ranked
  { brands: { olive_oil: [] } }           []                          confident, cheapest
  { brands: { olive_oil: null } }         (deleted → absent)          ambiguous, asks
  (olive_oil absent from patch)           unchanged                   unchanged
```

The same value/`null` distinction clears a scalar back to its default (`{ default_cooking_nights: null }`) and deletes a `custom` key. Deep recursive merge means a partial `stores` patch (`{ stores: { preferred_location: "…" } }`) preserves `stores.primary` — **this is the non-clobber guarantee** that lets us delete the skill's "rewrite every field" instruction.

**Alternatives considered:**
- *RFC 6902 (JSON Patch op-lists)* — `[{op,path,value}]` with JSON-pointer paths. More verbose, pointer strings are error-prone for an LLM author, and it needs explicit `remove` ops to express the brands tri-state that 7396 gets from `null`. Rejected.
- *Keep whole-object replace (typed, non-merge)* — smaller code, but keeps the clobber footgun and the skill workaround. Rejected; the merge is ~15 lines and removes a standing agent hazard.

**Array semantics:** arrays replace wholesale (RFC 7396). The only arrays in preferences are `brands.<key>` (a whole rank list — replacing is correct) and `dietary.avoid`/`dietary.limit` (0–5 items; the agent reads the profile before writing, so resending the short list is fine). This is intentionally *unlike* `staples`/`stockup`, which are add-only-deduped because they grow large — those keep their own structured add/remove tools and are out of this contract.

### Decision: `preferences` defined top-level schema + open `custom`

```jsonc
{
  "default_cooking_nights": 3,                 // number
  "lunch_strategy": "leftovers",               // "leftovers" | "buy" | "mixed"
  "ready_to_eat_default_action": "opt-in",     // "opt-in" | "auto-add"
  "stores":  { "primary": "kroger", "preferred_location": "Kroger - 76104", "location_zip": "76104" },
  "brands":  { "olive_oil": ["California Olive Ranch"], "yellow_onion": [] },
  "dietary": { "avoid": [], "limit": ["cilantro"] },
  "custom":  { /* arbitrary agent-added keys */ }
}
```

Defined top-level keys are exactly the ones real code reads (`brands` → matcher, `stores`/`location_zip` → weather + ordering, the three scalars → meal planning). Everything the agent invents at-will goes under `custom`, keeping the typed surface clean so the matcher/weather code keeps reading known paths.

**Validation is staged and atomic** (in `update_preferences`, and mirrored structurally in `src/validate.ts`):

```
  1. every top-level key of `patch` ∈ { default_cooking_nights, lunch_strategy,
       ready_to_eat_default_action, stores, brands, dietary, custom }
     else → structured error: "unknown preference key 'X' — nest it under custom"
  2. merged = mergePatch(current ?? {}, patch)            // arbitrarily deep
  3. validate merged types: scalars/enums, stores.* strings, brands = map of
       string → string[], dietary.{avoid,limit} = string[], custom = object
     else → malformed_data error, nothing stored
  4. JSON.stringify the bundle with the merged preferences object → KV
```

Validating the *patch* keys (step 1, not just the merged result) gives the agent the error at authorship time. Validating *types* on the merged result (step 2–3) catches a patch that produces an invalid whole. Unknown-key rejection is what makes "defined + custom" a real contract rather than a naming suggestion.

### Decision: drop `config_updates` from `commit_changes`

`commit_changes`' `config_updates: [{file: "preferences"|"taste"|"diet_principles"|"aliases", content}]` is fully redundant — each target has a standalone tool (`update_preferences`, `update_taste`, `update_diet_principles`, `update_aliases`). `preferences` can no longer ride a verbatim-string channel anyway. Removing the whole block costs zero capability.

**Rationale:** `commit_changes`' only real value is one-git-commit atomicity for GitHub writes; its KV-bound fields were never transactional. `config_updates` mixed both and duplicated four tools. (The broader question of retiring `commit_changes` and moving `cooking_log` to KV is deferred to `finish-kv-migration`; this change makes only the forced, zero-loss removal.)

### Decision: hard cutover via migration `0002`

`migrations/0002-json-profile-bundle.mjs` reads each tenant's `profile:<username>` key, and for each of the six fields that is still a string, parses it with `smol-toml` (markdown fields left as-is) and replaces it with the structured value, then writes the bundle back. For `preferences` the migration also reshapes flat/legacy keys into the `stores`/`brands`/`dietary`/`custom` layout and folds any unrecognized top-level key into `custom`. Idempotent: a field already of object/array type is skipped, so a re-run never double-parses.

**Rationale:** Mirrors the established `0001` runner pattern (discovered by `scripts/run-migrations.mjs`, ledgered in `migrations:applied`, idempotent). A hard cutover keeps the runtime read path branch-free — no "string ⇒ legacy TOML, object ⇒ new" fork lingering in production. The migration runs in the deploy job after `wrangler deploy`, the same ordering `0001` uses.

**Risk:** the brief post-deploy / pre-migration window serves the new (object-expecting) Worker against not-yet-migrated (string) bundles. Same window `0001` accepted; seconds at friend-group scale. The read helpers can defensively treat a still-string field as empty rather than throwing, so a session caught mid-deploy degrades to "empty profile" for one read rather than erroring — cheap insurance, and it is *not* a permanent dual-shape branch (it is removed once the migration is confirmed applied, or left as a trivial guard).

## Open Questions

- None blocking. The defensive still-a-string guard (keep as a permanent 1-line safety net, or remove after first deploy) is an implementer's call noted in tasks.
