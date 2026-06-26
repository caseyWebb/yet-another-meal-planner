## MODIFIED Requirements

### Requirement: Hard-fail validation rules

The system SHALL fail the build (non-zero exit) when any of the following structural problems is detected: a recipe's YAML frontmatter does not parse, any `.toml` file does not parse, two recipes resolve to the same slug, a `pairs_with` entry names a slug that does not resolve to a recipe in the corpus, or a `perishable_ingredients` value is present but is not an array of strings. A recipe `status` is **no longer validated** — the per-tenant `status` lifecycle is retired, so any lingering frontmatter `status` is tolerated and ignored (stripped from the index, never enforced). (`course` shape validation is defined in "Course field shape validation"; `standalone` is no longer a recognized field and is neither validated nor projected.)

#### Scenario: A lingering frontmatter status does not block the build

- **WHEN** an old recipe file still carries `status: draft` (or any value)
- **THEN** the build does not validate or fail on it; the field is stripped from the index and ignored

### Requirement: Required frontmatter fields

The system SHALL require every recipe to define a non-empty `title` (string). `status` is **not** a required or validated field. Absence of `title` SHALL be a hard failure.

#### Scenario: Title is required, status is not

- **WHEN** a recipe omits `title`
- **THEN** the build fails; a recipe that omits `status` (or carries any `status`) validates fine

### Requirement: Ready-to-eat catalog structural validation

The system SHALL validate the per-tenant ready-to-eat catalog's structural shape, requiring each item's `meal` to be one of `breakfast`/`lunch`/`dinner` and `name` to be a non-empty string. It SHALL NOT validate a `status` or `rating` on ready-to-eat items (those are retired in favor of the favorite/reject disposition); a lingering `status`/`rating` is tolerated and ignored.

#### Scenario: Ready-to-eat status/rating are not validated

- **WHEN** a ready-to-eat item carries a stale `status` or `rating`
- **THEN** validation ignores both and checks only `meal` and `name`
