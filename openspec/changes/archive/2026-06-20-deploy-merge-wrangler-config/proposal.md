## Why

The operator deploy (`data-deploy.yml`) **replaces** the wrangler config wholesale — `cp "<operator wrangler.jsonc>" _code/wrangler.jsonc` — then runs `wrangler deploy` from that. So **no code-level wrangler config ever reaches operators**: a new cron trigger, a `compatibility_flags` bump, a new KV binding the code needs — all silently fail to deploy unless every operator hand-edits their own `wrangler.jsonc`. This already bit us: the flyer-cache cron (`triggers.crons`, added in `warm-flyer-cache`) deployed to nobody, registered no cron, and the warm never ran — with no error, because `wrangler deploy` is declaratively *correct* about a config that simply lacked the block. It's a latent class of silent deploy bug.

## What Changes

- **CHANGE** The deploy assembles the deployed `wrangler.jsonc` by **merging** the code repo's config (the source of code-level keys) with the operator's data-repo config (the source of operator-owned keys), instead of replacing the former with the latter. Code-level keys — `main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`, `workers_dev` — flow from code, so they propagate to operators automatically. Operator-owned keys — KV namespace **ids**, account-specific `vars`, `routes`/custom domain, `name` — flow from (or are overlaid by) the operator's config.
- **BREAKING (security-critical merge rule)** `kv_namespaces` merge **by binding name**: the binding *set* comes from code (so a newly-required binding propagates), but each binding's **id ALWAYS comes from the operator** (or is absent → auto-provisioned). The code repo's KV ids (the maintainer's namespaces) MUST NEVER be deployed to another operator — otherwise a fresh operator's Worker would bind the maintainer's KV and cross tenants. The merge strips code-repo KV ids unconditionally.
- The existing zero-config posture is preserved: operators still declare bindings without ids (auto-provision), repo coords are still injected via `--var`, and onboard/revoke still resolve bindings from the operator's `wrangler.jsonc`.
- **Removes the manual sync step** documented as a stopgap (operators adding `triggers` to their own `wrangler.jsonc`) — once merged, code-level config is authoritative again.
- **Slims the data-repo template** (`docs/data-template` submodule → `groceries-agent-data-template`) to the **minimal operator-owned set**. Today the template's `wrangler.jsonc` is a near-full copy carrying code-level keys (`main`, `compatibility_*`, `observability`, and — tellingly — **no `triggers`**, the exact reason new operators got no cron). Post-merge it should declare only what's the operator's: `GITHUB_APP_ID`, optional `name`/custom domain, and id-less KV bindings (or none) for auto-provision + write-back. Coupled to the merge — the template can only be slimmed because the deploy now supplies code-level config, so the two land together.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `operator-provisioning`: add the requirement that the deploy **merges** code-level wrangler config with the operator's, including the security-critical rule that KV namespace ids always originate from the operator (never the code repo). The existing auto-provision / coord-injection / by-binding requirements are unchanged in intent but now operate over the merged config.

## Impact

- **Code**: `.github/workflows/data-deploy.yml` — replace the `cp` overlay step with a merge step (a small `node`/`jq` script that deep-merges with per-key rules: code base for code-level keys; operator wins for `vars`/`routes`/`name`; `kv_namespaces` merged by binding with operator/absent ids only). Add a tested merge helper (e.g. `scripts/merge-wrangler-config.mjs`) with unit tests under `tests/`.
- **Config**: the code repo's `wrangler.jsonc` carries the maintainer's real KV ids today — the merge must drop code-repo KV ids; consider also scrubbing them from the code repo's committed config to remove the footgun entirely (open question).
- **Docs**: `docs/SELF_HOSTING.md` (remove the manual "add `triggers` to your data-repo wrangler" stopgap once this lands; explain the merged-config model and what an operator's `wrangler.jsonc` is now responsible for), `docs/ARCHITECTURE.md` and/or `CONTRIBUTING.md` (the code-vs-operator wrangler ownership boundary), and the heads-up comment in `wrangler.jsonc`.
- **Template**: `docs/data-template` submodule (separate repo `groceries-agent-data-template`) — slim its `wrangler.jsonc` to the minimal operator-owned set, and bump the submodule pointer in this repo. New operators start from the slim template; existing operators need no migration (their full-copy config still merges correctly — see below).
- **Migration**: none required for existing operators — a merge with code as the base adds code's missing keys (e.g. `triggers`) while the operator's keys (KV ids, vars, routes) still win, so existing full-copy `wrangler.jsonc` files keep working. The template slim only changes what *new* operators start with.
- **Risk**: a wrong merge could mis-bind KV (cross-tenant) or mis-route — so the KV-id-provenance rule and the merge helper's tests are the heart of the change. A second risk: a slim template must not lose the KV-id **write-back** (provisioned ids pinned back into the operator's config across deploys) — see design.
- **Non-goals**: changing the deploy trigger/auth model; auto-provisioning beyond KV.
