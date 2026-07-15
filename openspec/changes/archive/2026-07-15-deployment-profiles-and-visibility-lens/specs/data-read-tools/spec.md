## MODIFIED Requirements

### Requirement: read_recipe returns frontmatter and body

The system SHALL provide `read_recipe(slug)` returning `{ slug, frontmatter, body }`, where `frontmatter` is the shared objective frontmatter **merged with the caller's overlay fields** (`favorite`) **and the caller's cooking-log-derived `last_cooked`** and `body` is the markdown after the frontmatter fence. The slug SHALL resolve only within the caller's visibility lens, checked through the shared lens enforcement point before any body read: a slug outside the caller's lens SHALL return the same structured `not_found` error an unknown slug returns — indistinguishably, so the tool cannot be used as a slug-probing oracle. The return SHALL NOT include a `last_modified` field and SHALL NOT include a `status` field (the disposition model is favorites/rejections, not status).

#### Scenario: Existing recipe read with caller's subjective fields

- **WHEN** `read_recipe("american-chop-suey")` is invoked by a member whose household's lens contains it, who favorited it and cooked it last week
- **THEN** it returns the slug, the shared frontmatter merged with that caller's `favorite: true` and `last_cooked`, and the markdown body, with no `last_modified` field

#### Scenario: Unknown slug

- **WHEN** `read_recipe("does-not-exist")` is invoked
- **THEN** it returns a structured `not_found` error naming the slug

#### Scenario: Out-of-lens slug is indistinguishable from unknown

- **WHEN** `read_recipe(slug)` is invoked under SaaS for a recipe that exists but is outside the caller's lens
- **THEN** the structured `not_found` error is identical in shape and content to the unknown-slug error, and no body read occurs

### Requirement: search_recipes reads the index and filters in-worker

The system SHALL provide `search_recipes({ specs })` that takes a non-empty array of search specs and returns `{ results: [{ label, recipes }] }` — one result group per input spec, in input order, each group's `label` echoed back verbatim. For every spec the tool SHALL read the shared D1 `recipes` index **through the caller's visibility lens** (the shared enforcement point — the membership universe is the lens-visible corpus), **join each entry with the caller's per-tenant overlay** (`favorite` / `reject`), **the caller's cooking-log-derived `last_cooked`**, **and the caller's owned-equipment list**, and apply the spec's `facets` in the Worker, producing recipes shaped `{ slug, title, frontmatter }` where `frontmatter` reflects the merged objective content plus the caller's subjective marks. By default — with no overlay row — a visible recipe is **neutral (available)**; the default result for an unfiltered spec is the caller's lens-visible corpus **minus the caller's rejects** (under self-hosted this equals the whole attached corpus minus rejects — today's behavior). A recipe outside the caller's lens SHALL never appear in any group in either mode. There is no `status` field and no effective-`draft` default.

A spec carries `{ label, facets?, vibe?, k?, boost_ingredients? }`. The `vibe` is **optional** and selects the mode:
- **vibe ABSENT (membership)** — the group SHALL be **every** lens-visible recipe that survives the facet gate, in index order with no ranking, **including recipes that have no embedding yet** (e.g. just-imported, not yet reconciled), and SHALL NOT be capped by `k`. `boost_ingredients` SHALL be ignored. This is the path a named-dish or browse lookup uses, so a freshly-imported recipe is never silently dropped.
- **vibe PRESENT (ranked)** — the surviving rows are ranked (see the semantic-recipe-search capability), which drops unembedded survivors and returns the top-`k`.

If the index is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: The lens-visible corpus minus rejects is returned by default

- **WHEN** `search_recipes({ specs: [{ label: "all" }] })` is invoked
- **THEN** `results[0].recipes` contains every recipe in the caller's lens that the caller has not rejected, each merged with the caller's `favorite`/`last_cooked` — and under self-hosted this is the whole attached corpus minus rejects, exactly as before

#### Scenario: Rejected recipes are excluded

- **WHEN** the caller has rejected a visible recipe and invokes a vibe-less spec
- **THEN** that recipe is absent from the result; another member who has not rejected it still sees it

#### Scenario: An out-of-lens recipe is absent from every group

- **WHEN** a SaaS caller's specs would match a recipe held only by a non-friend household
- **THEN** that recipe appears in no group, in membership or ranked mode, and its absence is indistinguishable from nonexistence

#### Scenario: Membership mode returns unembedded recipes and ignores k

- **WHEN** a vibe-less spec is invoked, a matching visible recipe has no embedding yet, and `k` is set to 5 while 30 visible recipes match
- **THEN** all 30 surviving recipes are returned (including the unembedded one), unranked and uncapped by `k`

#### Scenario: Grouped return, one group per spec

- **WHEN** `search_recipes({ specs: [{ label: "a" }, { label: "b", facets: { course: "side" } }] })` is invoked
- **THEN** `results` has two entries, `results[0].label === "a"` and `results[1].label === "b"`, each carrying its own `recipes` array

#### Scenario: Index missing or malformed

- **WHEN** the D1 `recipes` index cannot be read
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the group signal for a visible recipe — how many other households **within the caller's lens** have favorited it (a count) and their non-private notes (attributed) — to inform surfacing of recipes the caller has not tried. This read SHALL aggregate at read time over the caller's lens households only (own household plus friend households; every household under self-hosted — today's behavior), SHALL exclude private notes authored by others, and SHALL be reachable only for recipes inside the caller's lens. The favorite count is a single indexed aggregate (`COUNT` of favorites), not an average over a 1–5 scale.

#### Scenario: Aggregated group favorite count available within the lens

- **WHEN** several households in the caller's lens have favorited a visible recipe and the caller requests group signal for it
- **THEN** the caller receives the count of those other households' favorites and their attributed non-private notes

#### Scenario: Non-lens households never contribute signal

- **WHEN** a household outside a SaaS caller's lens has favorited or noted a recipe the caller can see (e.g. a curated recipe)
- **THEN** that household's favorite and notes are absent from the caller's group signal

#### Scenario: Others' private notes excluded

- **WHEN** another member has a private note on a recipe
- **THEN** that private note is not included in the group signal returned to the caller

### Requirement: recipe_site_url resolves the hosted browse URL at runtime

The system SHALL provide a `recipe_site_url` read tool that resolves cookbook URLs at runtime with lens awareness. Called with no arguments it SHALL return `{ url, enabled }` for the hosted cookbook root: `enabled: true` with `<origin>/cookbook` when the request origin is resolvable, and `enabled: false` with `url: null` when it is not. Called with an optional `slug`, it SHALL hand out a public cookbook link ONLY for an anonymously-visible recipe: `{ url: "<origin>/cookbook/<slug>", enabled: true, scope: "public" }` when the slug is inside the anonymous lens; `{ url: "<origin>/recipe/<slug>", enabled: true, scope: "member" }` (the member app's detail page, which requires a session) when the recipe is visible to the caller but not anonymously; and the same structured `not_found` an unknown slug returns when the slug is outside the caller's lens — indistinguishably. The tool never writes.

#### Scenario: Returns the cookbook root URL

- **WHEN** `recipe_site_url` is called with no slug and the request origin is resolvable
- **THEN** it returns `{ url: "<origin>/cookbook", enabled: true }`

#### Scenario: An anonymously-visible recipe gets the public link

- **WHEN** `recipe_site_url({ slug })` is called for a recipe inside the anonymous lens
- **THEN** it returns the `<origin>/cookbook/<slug>` URL with `scope: "public"`

#### Scenario: A lens-scoped recipe gets the member link, never a broken public link

- **WHEN** `recipe_site_url({ slug })` is called under SaaS for a recipe visible to the caller's household but not anonymously
- **THEN** it returns the member app detail URL with `scope: "member"`, and never the `/cookbook/<slug>` URL (which would 404 for an anonymous visitor)

#### Scenario: Reports not-enabled instead of failing

- **WHEN** `recipe_site_url` is called and the request origin is not resolvable
- **THEN** it returns `{ url: null, enabled: false }`, so the agent can surface the corpus another way rather than presenting a broken link
