## ADDED Requirements

### Requirement: recipe_site_url resolves the hosted browse URL at runtime

The system SHALL provide a `recipe_site_url` read tool that resolves the URL of the hosted recipe site (the static browse view of the shared corpus) from the data repo's **GitHub Pages** configuration, via the existing GitHub App installation token — so the agent can point a member at the full corpus without any build-time-baked URL. It SHALL return `{ url, enabled }`: `enabled: true` with the published `html_url` (honoring a configured custom domain) when Pages is enabled, and `enabled: false` with `url: null` when it is not (the GitHub Pages API returns 404). When the GitHub App lacks the `Pages: read` permission (403), the tool SHALL return a structured `insufficient_permission` error naming the missing permission, rather than throwing. The tool reads the **shared** data repo (Pages is a repo-level property), takes no parameters, and never writes.

#### Scenario: Returns the published URL when Pages is enabled

- **WHEN** `recipe_site_url` is called and the data repo has GitHub Pages enabled
- **THEN** it returns `{ url: <published html_url>, enabled: true }`, reflecting a custom domain when one is configured

#### Scenario: Reports not-enabled instead of failing

- **WHEN** `recipe_site_url` is called and the data repo has no GitHub Pages site (404)
- **THEN** it returns `{ url: null, enabled: false }`, so the agent can tell the member their operator needs to enable Pages

#### Scenario: Missing Pages permission is a structured error

- **WHEN** `recipe_site_url` is called but the GitHub App lacks the `Pages: read` permission (403)
- **THEN** the tool returns a structured `insufficient_permission` error naming the missing permission, not an unhandled throw
