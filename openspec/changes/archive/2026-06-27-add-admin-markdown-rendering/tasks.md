## 1. Worker: recipe `body` field

- [x] 1.1 In `src/admin-data.ts`, add `body: string | null` to the `RecipeDetail` interface and document it (source with frontmatter removed).
- [x] 1.2 In `recipeDetail`, derive `body` from the already-fetched `source` via `parseMarkdown` (no new R2/D1 read); `null` when `source` is null, whole text when there's no frontmatter fence.
- [x] 1.3 Update/extend `test/admin-data.test.ts` to assert `body` is the frontmatter-stripped source for a recipe with frontmatter, and the whole text when there is none.

## 2. Admin: shared Markdown renderer

- [x] 2.1 Add `dillonkearns/elm-markdown` as a direct dependency in `admin/elm.json`.
- [x] 2.2 Create `admin/src/Markdown.elm` exposing `render : String -> Html msg`: parse with `dillonkearns/elm-markdown` and render with a custom `Renderer` derived from `Markdown.Renderer.defaultHtmlRenderer`.
- [x] 2.3 Override the renderer to mirror the cookbook hardening — drop raw HTML (`html`), and scheme-filter `link`/`image` URLs to `http(s)` / root-relative / fragment (anything else → `#`).
- [x] 2.4 On a parse `Err`, fall back to rendering the raw markdown text in a `<pre>` (never an empty result).

## 3. Admin: wire the two Data views

- [x] 3.1 In `admin/src/Data/Recipe.elm`, decode the new `body` field on `RecipeDetail` (`Maybe String`) and the `recipeDetailDecoder`.
- [x] 3.2 Add a "Rendered body" section to `viewRecipe` that calls `Markdown.render` on the body; keep `viewSource` (raw source) and the projection JSON sections unchanged.
- [x] 3.3 In `admin/src/Data/Corpus.elm`, render a loaded guidance object via `Markdown.render` instead of the raw `<pre>` in `viewObject` (keep the empty-object and error/loading cases).

## 4. Tests

- [x] 4.1 Add an Elm test under `admin/tests/` for `Markdown.render`: a heading/list renders to HTML, a `javascript:` link URL is neutralized, raw HTML is dropped, and an unparseable input falls back to raw text.
- [x] 4.2 Run `aubr typecheck`, `aubr test` (Worker), and the admin Elm tests; fix any failures.

## 5. Docs

- [x] 5.1 Update `docs/SCHEMAS.md` where it documents the `GET /admin/api/data/recipes/<slug>` response to include the `body` field.

## 6. Build & verify

- [x] 6.1 Rebuild the committed admin bundle (`aubr build:admin`) and confirm `aubr build:admin --check` passes (no `admin/dist/` drift). If `package.elm-lang.org` is unreachable in the sandbox, land the source change and leave the bundle rebuild to CI rather than committing a stale bundle.
- [x] 6.2 Run `openspec validate "add-admin-markdown-rendering" --strict` and confirm the change is apply-ready.
