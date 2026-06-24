## ADDED Requirements

### Requirement: rate_recipe writes the caller's subjective disposition

The system SHALL provide a `rate_recipe(slug, { rating?, status? })` tool that writes the caller's per-tenant overlay for a recipe — `rating` and/or effective `status` — and returns without a `commit_sha`. It SHALL validate `slug` against the D1 `recipes` table (`not_found` when absent) and SHALL reject an edit that sets neither field. It SHALL NOT write shared recipe content.

#### Scenario: Rating a recipe writes only the overlay

- **WHEN** `rate_recipe("miso-salmon", { rating: 5 })` is called for an existing recipe
- **THEN** the caller's overlay row for `miso-salmon` is updated and no shared GitHub recipe content changes, returning without a `commit_sha`

#### Scenario: Rating an unknown recipe is rejected

- **WHEN** `rate_recipe` is called with a slug not in `recipes`
- **THEN** a structured `not_found` error is returned and nothing is written

## MODIFIED Requirements

### Requirement: update_recipe edits objective shared content only

`update_recipe(slug, updates)` SHALL write only objective shared recipe content (frontmatter/body) to the GitHub data repo. It SHALL reject `rating` or `status` keys with a structured `validation_failed` error directing the caller to `rate_recipe`, and SHALL continue to reject `last_cooked` (derived via the cooking log / `log_cooked`). It SHALL NOT write any overlay.

#### Scenario: update_recipe rejects subjective keys

- **WHEN** `update_recipe("miso-salmon", { status: "active" })` is called
- **THEN** a structured `validation_failed` error is returned naming `rate_recipe`, and nothing is written

#### Scenario: update_recipe commits objective content

- **WHEN** `update_recipe("miso-salmon", { time_total: 30 })` is called with valid objective frontmatter
- **THEN** the shared recipe content is committed to GitHub and the tool returns `{ slug, updated_fields }`

## REMOVED Requirements

### Requirement: commit_changes batches repo writes in one commit

**Reason**: Every field `commit_changes` carried now has a standalone tool — objective recipe content (`update_recipe`/`create_recipe`), recipe rating/status (`rate_recipe`), ready-to-eat (`add_draft_ready_to_eat`/`update_ready_to_eat`), config (`update_preferences`/`update_taste`/`update_diet_principles`/`update_aliases`), and cooking events (`log_cooked`). Its only unique property — one git commit for multiple GitHub-backed writes — applied to curatorial, typically-singular edits and is not worth a dual-store batch tool. KV-backed fields it carried were never transactional.
**Migration**: Replace `commit_changes` calls with the matching standalone tools. A turn that wrote several files in one commit now issues one granular call per write.
