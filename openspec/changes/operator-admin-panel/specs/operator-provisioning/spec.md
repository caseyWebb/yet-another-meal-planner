## REMOVED Requirements

### Requirement: KV-writing workflows address namespaces by binding, not id

**Reason**: The onboard and revoke GitHub Actions are retired. Member onboarding, revocation, and invite rotation move into the Worker's Access-gated admin surface (the new `operator-admin` capability), which writes `TENANT_KV` and purges D1 through the Worker's own bindings — there is no longer a KV-writing workflow whose namespace addressing this requirement governs.

**Migration**: See `operator-admin` — "Member onboarding mints an invite without a public log" and "Member revocation fully purges tenant state". The reusable `data-onboard.yml` / `data-revoke.yml` workflows and the data-repo `onboard.yml` / `revoke.yml` callers are removed. Removing the invite-code-printing Actions is the point: it is the last operator workflow whose run logs carried sensitive data, so its removal is what later allows the data repo to be made public. The deploy workflow is unaffected and continues to resolve bindings from the operator's `wrangler.jsonc`.
