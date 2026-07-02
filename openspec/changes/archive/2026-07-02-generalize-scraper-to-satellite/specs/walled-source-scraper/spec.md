## REMOVED Requirements

### Requirement: The scraper runs off-cloud on the operator's network

**Reason**: The `walled-source-scraper` capability is renamed and generalized to `satellite`. This requirement is carried over (generalized to be capability-agnostic and to say "satellite") as the `satellite` capability's "The satellite runs off-cloud on the operator's network".

**Migration**: None — no behavior change. The off-cloud, one-machine-one-key-many-sources posture is unchanged; see the `satellite` spec. No DB object, endpoint, or env var is renamed.

### Requirement: Source adapters are a plugin model over a shared SDK

**Reason**: Renamed to `satellite`. Carried over verbatim (scraper→satellite wording) as the `satellite` capability's "Source adapters are a plugin model over a shared SDK".

**Migration**: None — the `{ authenticate, discover, extract }` adapter model, the injected shared-parse SDK, and mounted operator adapters are unchanged.

### Requirement: The fetch runtime is tiered, plain-HTTP by default

**Reason**: Renamed to `satellite`. Carried over as the `satellite` capability's "The fetch runtime is tiered, plain-HTTP by default".

**Migration**: None — the plain-HTTP-default / browser-tier-on-demand behavior is unchanged.

### Requirement: Session capture is decoupled from the daemon and expiry is surfaced

**Reason**: Renamed to `satellite`. Carried over as the `satellite` capability's "Session capture is decoupled from the daemon and expiry is surfaced".

**Migration**: None — `login` / cookie-import capture and the `auth_expired` signal are unchanged.

### Requirement: Recipes are stripped to functional facts and pushed in per-source batches

**Reason**: Renamed to `satellite` and split: the functional-facts-only constraint is elevated to the capability-agnostic "The satellite reports only independently-checkable observations, never derived conclusions", and the per-source batch/backfill/backoff behavior is carried over as "Recipe observations are pushed in per-source batches with machine version" (now stamping `satellite_version` and `capability: "recipe-scrape"` under contract v2).

**Migration**: None functional — the same functional facts are pushed. The wire field `scraper_version` becomes `satellite_version` and the batch gains a `capability` tag under contract v2; the Worker accepts both v1 and v2 during the transition (see `recipe-ingestion`).

### Requirement: The scraper provides operator CLI verbs and ships as a container

**Reason**: Renamed to `satellite`. Carried over as the `satellite` capability's "The satellite provides operator CLI verbs and ships as a container".

**Migration**: None — the `login`/`test`/`backfill`/`run` verbs and the container packaging are unchanged; the CLI binary is renamed `grocery-scraper` → `grocery-satellite`.
