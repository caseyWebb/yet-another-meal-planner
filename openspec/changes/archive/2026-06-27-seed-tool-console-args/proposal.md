## Why

The MCP tool console (`Dev/ToolConsole.elm`) seeds its **Arguments (JSON)** box with a bare `"{}"` and shows the input schema read-only beside it. To invoke any non-trivial tool the operator must read that schema and hand-type the JSON — recalling which fields are required, what an `enum` accepts, the exact key names. For a ~50-tool surface that is the console's main friction.

The schema needed to remove that friction is **already in the client** — `GET /admin/api/tools` ships each tool's full `inputSchema`, decoded into `Tool.schema`. So we can pre-fill the box with a worked example derived from that schema, with required fields ready to fill and optional fields shown (commented out) for discoverability — turning the schema from a reference you read into a template you edit. Because the example *uses* comments, the input must also *tolerate* them on submit.

This is a self-contained admin-SPA change: two small pure Elm modules plus a state-model tweak in the console. **No Worker change, no tool-contract change, no `docs/TOOLS.md`/`docs/SCHEMAS.md` churn, no new dependency.**

## What Changes

- **The Arguments box is seeded with a schema-derived example** when a tool is selected, instead of `"{}"`. The example is generated *structurally* from the tool's input JSON Schema — never a hand-maintained per-tool string, so a newly registered tool gets a useful example with zero console code:
  - **required** fields are present with a type-appropriate placeholder value; **optional** fields are present but **commented out** (uncomment the ones you want);
  - `enum` → the first allowed value, with the alternatives listed in a trailing comment; `default` → that default; `string → ""`, `number/integer → 0`, `boolean → false`, `array → [ <one sample> ]`, nested `object → recurse`; a nullable (`anyOf:[T,null]`) is unwrapped to `T`'s example; a `.describe()` becomes a trailing comment;
  - the whole thing is **pretty-printed** (indented, one field per line);
  - a no-field tool stays `{}`.
- **The Arguments input tolerates JSON-with-comments on submit.** Before the args are parsed and sent, the console strips `//` line comments, `/* */` block comments, and trailing commas — *string-aware*, so a `//` inside a string value (e.g. a URL) is preserved. This makes the commented-optionals usable: uncomment any subset and it still parses. The server-side Zod validation is unchanged — stripping is a client-side input convenience, not a validation bypass.
- **The arg buffer is modeled as `Pristine | Edited String`** so the example is *derived in the view* from the current tool's schema while untouched, and only stored once the operator types. This dodges the catalog-load race (a deep-linked tool seeds correctly the moment the catalog arrives, with no extra message) and incidentally fixes a latent bug where `selectTool` resets the box to `"{}"` even while the catalog is still loading.
- **Minor styling:** the args `textarea` gains a sensible multi-line height so the pretty example is visible without scrolling.

## Capabilities

### New Capabilities
<!-- none — this extends the existing operator-admin tool console -->

### Modified Capabilities

- `operator-admin`: **ADDS** the schema-derived argument example (required-present / optional-commented, pretty-printed, generated structurally from the live input schema) and the comment-/trailing-comma-tolerant argument input that makes it usable.

## Impact

- **Admin SPA (`admin/src/`):** two new pure modules — `Dev/SchemaExample.elm` (`Encode.Value` input schema → pretty JSONC example string) and `Dev/Jsonc.elm` (string-aware comment + trailing-comma stripper) — plus `Dev/ToolConsole.elm` changes: `Args = Pristine | Edited String`, derive the example in `viewTool`, strip-then-decode in `attemptRun`, reseed on tool/persona change. Rebuilds the committed `admin/dist/` via `aubr build:admin` (needs `package.elm-lang.org`; if unreachable, land source and leave the rebuild to CI per `admin/CLAUDE.md`).
- **Worker:** none. The example is generated client-side from the already-served `inputSchema`; the invoke route already accepts an `arguments` JSON value.
- **Docs:** the `operator-admin` spec via this change's delta. `docs/TOOLS.md` / `docs/SCHEMAS.md` unaffected (no tool or data-shape change). A one-line note in `docs/SELF_HOSTING.md`'s console description is optional.
- **Tests:** Elm — `SchemaExample` generation rules (required vs optional, enum, default, nullable, array, nested object, empty schema) and the **round-trip invariant** (`Jsonc.strip (SchemaExample.generate s)` decodes for every schema, to the required-only skeleton); `Jsonc` stripping (line/block comments, `//` inside a string preserved, trailing commas). No Worker test change.
- **Dependencies:** none new — pure `elm/json` string work; no JSON5/Elm form package added.
- **Security:** none — purely a client-side input-composition convenience behind the existing Access gate. Validation, gating, and tenant resolution are untouched; comment-stripping cannot smuggle anything past the server's Zod schema.
