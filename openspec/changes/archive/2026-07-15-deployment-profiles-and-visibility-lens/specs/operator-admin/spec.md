## ADDED Requirements

### Requirement: The Config area exposes the deployment profile with guarded flips

The admin panel's Config area SHALL render a deployment-profile card showing the resolved profile (`self-hosted` | `saas`, including the unset-defaults-to-self-hosted state) beside the curated-source control (`curated_source_url`: shown with its compiled default when unset; editable; clearable to disable curated intake). Profile changes SHALL go through an Access-gated admin API operation on the `operator_config` write path enforcing the flip guards (see `shared-corpus`): self-hosted → SaaS requires an explicit confirmation whose copy states that implicit all-to-all visibility ends immediately and the public `/cookbook` site narrows to the curated tier; SaaS → self-hosted is refused with a structured error naming the consent-inversion guard unless at most one household owns a non-empty (non-curated) cookbook. A refused flip SHALL write nothing and the card SHALL present the refusal reason. The card SHALL ship with admin Playwright coverage (page object + spec under `admin/visual/`) like every admin surface.

#### Scenario: The card reflects the unset default

- **WHEN** the operator opens the Config area on a deployment that never wrote `deployment_profile`
- **THEN** the card shows the profile as self-hosted (default) and the curated-source control shows the compiled default URL as not-yet-overridden

#### Scenario: Flipping to SaaS demands the confirm

- **WHEN** the operator submits self-hosted → SaaS without the confirmation
- **THEN** the API returns the structured needs-confirm response and no write occurs; re-submitting with the confirmation writes the flag

#### Scenario: An unsafe flip back is refused with the reason

- **WHEN** the operator attempts SaaS → self-hosted while two households own non-empty cookbooks
- **THEN** the operation returns a structured refusal naming the consent-inversion guard, the profile remains `saas`, and the card renders the reason
