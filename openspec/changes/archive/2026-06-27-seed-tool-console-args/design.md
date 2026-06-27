## Context

`Dev/ToolConsole.elm` is the operator's in-panel MCP inspector. It fetches `GET /admin/api/tools` (each tool's `name`, `description`, and `inputSchema`, decoded into `Tool.schema : Encode.Value`), shows the selected tool's schema read-only, and submits a raw-JSON **Arguments** box to `POST /admin/api/tools/<name>`. Today that box is seeded with `"{}"` (`freshSession`/`selectTool`) and parsed strictly (`Decode.decodeString Decode.value`).

The input schemas are produced by the MCP SDK from each tool's Zod shape. Captured empirically, the dialect is **JSON Schema draft-07** (the SDK converts via zod-mini's `toJSONSchema` with the default `draft-7` target). The relevant shapes the generator must read:

```jsonc
// z.string()                      → { "type": "string" }
// z.enum([...])                   → { "type": "string", "enum": [...] }
// z.number() / z.number().int()   → { "type": "number" } / { "type": "integer", "minimum": -9e15, "maximum": 9e15 }
// z.boolean().default(true)       → { "type": "boolean", "default": true }
// z.array(S)                      → { "type": "array", "items": S }
// z.object(shape)                 → { "type": "object", "properties": {...}, "required": [...] }
// z.string().nullable()           → { "anyOf": [ { "type": "string" }, { "type": "null" } ] }
// .describe("…")                  → adds "description": "…"
// optional()                      → property simply absent from the parent's "required"
```

Constraints: the Elm modeling discipline in `admin/CLAUDE.md` ("make impossible states impossible"; "derive, don't store"); `admin/dist/` is generated and needs `package.elm-lang.org` to rebuild; the console must stay schema-driven (a new tool needs zero console code).

## Goals / Non-Goals

**Goals:**
- Pre-fill the Arguments box with a worked, editable example derived **structurally** from the tool's input schema — required fields ready to fill, optional fields visible-but-commented for discoverability, pretty-printed.
- Make that example usable: the input tolerates `//` / `/* */` comments and trailing commas so uncommenting any subset still submits.
- Stay schema-driven and hand-maintenance-free: no per-tool example strings.

**Non-Goals:**
- **Generating an input *form*** from the schema (widgets, dropdowns). Deferred — see the decision below; raw JSON with a seeded example is the inspector-appropriate level.
- Changing tool contracts, the invoke API, or server-side validation. Stripping is client-side only.
- A full JSON5 parser, or a new Elm dependency. A small string-aware stripper feeding the existing `Json.Decode` is enough.
- Client-side schema *validation* of the args before submit — the server's Zod schema remains the one validator; its structured error is already surfaced.

## Decisions

### Decision: A text template, not a generated form (and not elm-form / build-time codegen)

The console is a developer/operator inspector — the surface it replaces (the stock MCP Inspector) takes raw JSON. A seeded, commented example gives ~80% of a form's discoverability (every field, every enum option, visible inline) at a fraction of the cost, and it covers **every** tool uniformly — including the ones a form cannot help with.

- **Alternative — generate an input form from each JSON Schema (hand-rolled in Elm):** deferred. To meet `admin/CLAUDE.md`'s bar it needs a `FieldValue` ADT mirroring the schema plus path-addressed update plumbing (array add/remove, optional-presence and null toggles) — a bigger, stateful module than the entire current console. And it does not help the **7 free-form `record(string, unknown)` tools** (`update_recipe`, `update_store`, `update_aliases`, the profile `patch`es, `parse_recipe` frontmatter): `additionalProperties: true` has no fields to render, so those fall back to a raw box regardless. Highest-value write tools, zero form benefit.
- **Alternative — `dillonkearns/elm-form`:** rejected for this surface. It is a compile-time, applicative-pipeline library: `field` consumes one parameter of a fixed-arity constructor, so the field set must be known when the Elm compiles, and it produces a statically-typed `parsed` value. Our field set is known only at runtime (fetched per tenant) and can only ever encode to `Encode.Value` — the inverse of what elm-form is for. It also brings `rtfeldman/elm-css` (the admin app is plain `elm/html`). It would, however, fit the **static** Members onboarding form if that is ever hardened.
- **Alternative — generate forms at build time (codegen → static elm-form):** genuinely viable and drift-safe (admin bundle + Worker ship from one commit), and it dissolves elm-form's arity wall by moving the field set to compile time. Deferred, not disqualified: it adds a generator + committed `.elm` artifact + `--check` guard + the elm-css dep, still falls back to raw for the `record` tools, and the form UX is a modest win for a technical audience. If forms are ever wanted, this is the recommended path — layered on top of this template (which the `record` tools need as their raw fallback anyway).

### Decision: Generate structurally — required live, optional commented, always comma, always pretty

`SchemaExample.generate : Encode.Value -> String` decodes the input schema into a small `Schema` ADT, then renders a pretty-printed JSONC **string** (not an `Encode.Value` — only a string can carry comments). Per property:

| schema signal | emitted value |
| --- | --- |
| in `required[]` | live line |
| not in `required[]` | line prefixed `// ` (a field whose ancestor is optional is commented once, not doubly) |
| `enum: [a, …]` | `a` + trailing `// a \| b \| …` |
| `default: v` | `v` |
| `type:"string"` | `""` |
| `type:"number"`/`"integer"` | `0` (the `±9e15` `int` sentinels are ignored — they are artifacts, useless as examples) |
| `type:"boolean"` | `false` |
| `type:"array", items:S` | `[ example(S) ]` (one sample element) |
| `type:"object"` | recurse over `properties` |
| `anyOf:[S,{type:"null"}]` | `example(S)`, unwrapped |
| `description` | trailing `// …` |
| unrecognized node (`$ref`, multi-branch union, untyped) | `null` + `// (unsupported schema)` — degrade, never fail |

**Every field line ends with a comma, and the parser tolerates trailing commas** (below). This removes all "is this the last live field" bookkeeping: the generator never tracks position, and uncommenting any subset stays valid. Worked example (`add_to_grocery_list`, required `["name"]`):

```jsonc
{
  "name": "",
  // "quantity": "",
  // "kind": "grocery",            // grocery | household | other
  // "domain": "",
  // "source": "ad_hoc",           // ad_hoc | menu | pantry_low | stockup
  // "for_recipes": [""],
  // "note": ""
}
```

This yields the correctness invariant we test: **`Jsonc.strip (generate s)` always decodes, to the required-only skeleton** (every optional omitted because commented; all-optional ⇒ `{}`).

### Decision: Tolerate comments + trailing commas with a string-aware stripper, not a new parser

`Jsonc.strip : String -> String` folds over the characters with a tiny state machine (`Normal | InString | InStringEscape | InLineComment | InBlockComment`), dropping `//`…EOL and `/*`…`*/` **only outside strings** (so `"https://x"` and `"a\"b"` survive), then removing commas immediately before `}`/`]`. `attemptRun` becomes `Jsonc.strip >> Decode.decodeString Decode.value`; the existing `BadArgsJson` path still catches genuinely malformed input. A full JSON5 parser is unnecessary — strip-then-`Json.Decode` reuses the tested decoder and keeps the surface tiny.

- **Alternative — add a JSON5/JSONC Elm package:** rejected. No mainstream, maintained option; the stripper is ~40 testable lines and adds no dependency.

### Decision: Model the arg buffer as `Pristine | Edited String`

```elm
type Args = Pristine | Edited String
-- view:  value = case args of Pristine -> SchemaExample.generate (schemaOf selected) ; Edited s -> s
-- ArgsChanged s        -> Edited s
-- selectTool / persona -> Pristine
-- attemptRun           -> the string the view shows (generate when Pristine, else the buffer) |> Jsonc.strip |> decode
```

The example is **derived in the view** (`admin/CLAUDE.md` rule 4) and the buffer is stored only once the operator actually types (rule 6: a `String` is for text the user types). This makes the catalog-load race vanish — while the catalog is `Loading` a `Pristine` box renders `{}`, and the *same* `Pristine` state renders the real example the instant the catalog arrives, with no extra `Msg` — and it fixes the latent bug where `selectTool` blanks an in-progress edit to `"{}"` mid-load. A free "reset to example" affordance falls out (set `Pristine`).

- **Alternative — store the generated string into `args` on selection / on `GotCatalog`:** rejected. It needs an edited-vs-pristine flag to avoid clobbering the operator's typing when a late `GotCatalog` lands — the exact parallel-fields-that-can-disagree antipattern `admin/CLAUDE.md` forbids.

## Risks / Trade-offs

- **The bare example may not satisfy every constraint** (`minLength`, numeric bounds) — e.g. a required `z.string().min(1)` seeded as `""`. Acceptable: it is a fill-me template, and the server returns the real Zod validation error verbatim if submitted unedited. We optimize for "obviously a blank to fill" over "passes on first submit."
- **Stripping changes byte offsets**, so a `Json.Decode` error position refers to the stripped text, not the operator's literal input. Minor for a dev surface; the `BadArgsJson` detail is still shown.
- **Schema shapes we did not capture** (a future `$ref`, `oneOf`, untyped node) → the decoder degrades them to `null` with a comment rather than failing the box; the operator can still edit/submit. Pinned by a test.
- **Bundle can't rebuild offline** → `admin/dist/` needs `package.elm-lang.org`. If unreachable, land source and leave the rebuild to CI per `admin/CLAUDE.md`; never commit a stale bundle.

## Migration Plan

Additive and client-only — no data migration, no new binding/secret, no dependency, no Worker change. Sequence: (1) `Dev/Jsonc.elm` + tests; (2) `Dev/SchemaExample.elm` + tests incl. the round-trip invariant; (3) wire both into `Dev/ToolConsole.elm` (`Args` type, view derivation, `attemptRun`); (4) textarea height; (5) rebuild `admin/dist/`. Rollback: revert — no persisted state.

## Open Questions

- **String placeholder value:** `""` (clear "fill me", chosen) vs `"<string>"` (signals the type). Lean `""`.
- **Nullable rendering:** unwrap to the underlying type's example (chosen, more instructive) vs literal `null` (signals nullability). Lean unwrap; a `// nullable` hint is a cheap add if wanted.
- **`description` as a trailing comment:** include (more guidance) vs omit (shorter lines). Lean include, truncating very long ones — revisit if lines get noisy.
