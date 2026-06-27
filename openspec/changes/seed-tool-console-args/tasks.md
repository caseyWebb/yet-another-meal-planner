## 1. JSONC input normalizer (`admin/src/Dev/Jsonc.elm`)

- [ ] 1.1 New module exposing `strip : String -> String`: a string-aware fold (`Normal | InString | InStringEscape | InLineComment | InBlockComment`) that drops `//`…EOL and `/*`…`*/` only outside strings, then removes a comma immediately before `}`/`]`. Narrowest API (just `strip`).
- [ ] 1.2 `admin/tests/JsoncTest.elm`: line comment removed; block comment removed (incl. spanning lines); `//` and `/*` inside a string value preserved; escaped quote `\"` does not end the string; trailing comma before `}` and before `]` tolerated; a clean JSON string passes through unchanged.

## 2. Schema-example generator (`admin/src/Dev/SchemaExample.elm`)

- [ ] 2.1 Decode the draft-07 input schema (`Encode.Value`) into a small `Schema` ADT (object/string/number/integer/boolean/array/enum/nullable/unknown), tolerant of missing `required`, `anyOf:[T,null]` nullable, per-property `description`/`default`/`enum`; an unrecognized node decodes to `Unknown`, never failing.
- [ ] 2.2 Expose `generate : Encode.Value -> String` rendering a pretty-printed JSONC example: required live, optional commented (`// `, single prefix even under an optional ancestor), enum→first value + `// a | b | …`, default→default, `string→""`, `number/integer→0` (ignore the `±9e15` int sentinels), `boolean→false`, `array→[ <one sample> ]`, object→recurse, nullable→underlying example, `description`→trailing comment, `Unknown`→`null` + `// (unsupported schema)`. Every field line ends with a comma. A null/non-object schema or a no-field object yields `{}`.
- [ ] 2.3 `admin/tests/SchemaExampleTest.elm`: required-present/optional-commented; enum first value + alternatives comment; `default` used; nullable unwrapped; array sample; one level of nested object; empty/`{}` schema → `{}`; `Unknown` node degrades. **Invariant test:** for a representative set of schemas, `Jsonc.strip (SchemaExample.generate s)` decodes via `Decode.value` and the decoded object's keys equal the schema's `required` set.

## 3. Wire into the console (`admin/src/Dev/ToolConsole.elm`)

- [ ] 3.1 Replace the `args : String` field with `type Args = Pristine | Edited String`; `freshSession`/`selectTool`/`PersonaChosen` set `Pristine`; `ArgsChanged s` sets `Edited s`.
- [ ] 3.2 In `viewTool`, the textarea value is `case args of Pristine -> SchemaExample.generate (schema of the selected tool, or null while the catalog is unresolved) ; Edited s -> s` — example derived in the view, no new `Msg`, no clobbering on a late `GotCatalog`.
- [ ] 3.3 `attemptRun` computes the shown string (generate when `Pristine`, else the buffer), then `Jsonc.strip >> Decode.decodeString Decode.value`; keep the `BadArgsJson` failure path for genuinely malformed input.
- [ ] 3.4 Keep the read-only schema block (`viewSchema`) — the example is the editable companion, the schema stays the full reference.

## 4. Styling

- [ ] 4.1 `admin/index.html`: give the `.args` textarea a sensible multi-line height (e.g. `rows`/`min-height`) so a pretty example is visible without scrolling; keep the existing monospace styling.

## 5. Build, tests, verify

- [ ] 5.1 `aubr test:admin` green (new `JsoncTest` + `SchemaExampleTest`, existing `RouteTest`/`ToolConsoleTest`/`StatusTest` unaffected).
- [ ] 5.2 `aubr build:admin` to regenerate the committed `admin/dist/`; `aubr build:admin --check` clean (if `package.elm-lang.org` is unreachable, land source and leave the rebuild to CI per `admin/CLAUDE.md`).
- [ ] 5.3 Manual smoke under `wrangler dev` + `ADMIN_DEV_BYPASS=1`: select a tool with required+optional+enum fields (e.g. `add_to_grocery_list`), confirm the seeded commented example; run it unedited (required-only) and observe the result; uncomment an optional and an enum and re-run.
