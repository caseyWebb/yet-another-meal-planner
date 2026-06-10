## ADDED Requirements

### Requirement: Discovery surfaced during menu requests

On a menu request, the agent SHALL surface a small number of new discoveries — roughly one to two candidate recipes (from `fetch_rss_discoveries`) and one to two ready-to-eat candidates (from on-sale items in the existing `kroger_flyer` pre-pass call). Recipe discoveries the user shows no objection to SHALL be imported immediately in draft state (`import_recipe` → agent enrichment → `create_recipe`), not deferred until the user expresses interest in this conversation. Ready-to-eat candidates SHALL be deduped against the existing `ready_to_eat/*.toml` catalogs by the agent and drafted via `add_draft_ready_to_eat`. Discovery SHALL NOT block or dominate the menu proposal — it is a side channel, surfaced as 1–2 callouts.

#### Scenario: Menu request surfaces and drafts recipe discoveries

- **WHEN** the agent assembles a menu proposal and `fetch_rss_discoveries` returns fresh candidates
- **THEN** the agent surfaces ~1–2 of them and imports the chosen ones in draft via `import_recipe` + `create_recipe`, without waiting for the user to ask

#### Scenario: On-sale ready-to-eat item not already cataloged is drafted

- **WHEN** the `kroger_flyer` pre-pass surfaces an on-sale ready-to-eat item absent from `ready_to_eat/*.toml`
- **THEN** the agent surfaces it as an opportunity buy and drafts it via `add_draft_ready_to_eat`

#### Scenario: Already-cataloged ready-to-eat sale is not re-drafted

- **WHEN** an on-sale ready-to-eat item already exists in `ready_to_eat/*.toml`
- **THEN** the agent does not create a duplicate draft for it

### Requirement: Discoveries are dispositioned conversationally

The agent SHALL let the user disposition draft discoveries in any later conversation through natural requests, mapping them to the existing write tools: a "rate the <source> one N stars" request SHALL promote the recipe draft to `status: active` with that rating via `update_recipe`; a "remove that one" request SHALL set the draft to `status: rejected`; ready-to-eat drafts SHALL be dispositioned analogously via `update_ready_to_eat`. Drafts SHALL remain de-prioritized in subsequent proposals but accessible on explicit request.

#### Scenario: Rating a discovery promotes it to active

- **WHEN** the user says "rate the Serious Eats one 4 stars"
- **THEN** the agent calls `update_recipe` to set that draft's `status` to `active` and `rating` to 4

#### Scenario: Rejecting a discovery

- **WHEN** the user says "remove that one" about a surfaced draft
- **THEN** the agent sets the draft's `status` to `rejected` rather than deleting it silently
