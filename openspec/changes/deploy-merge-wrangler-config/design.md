## Context

`data-deploy.yml` is a reusable workflow operators call from their data repo at `@main`, so fixing it in the code repo fixes it for everyone. Today its config step is:

```yaml
- name: Overlay the operator's wrangler config onto the source
  run: cp "${{ inputs.config_path }}" _code/wrangler.jsonc
```

A full replace. The deployed config is therefore 100% the operator's data-repo `wrangler.jsonc`; the code repo's `wrangler.jsonc` is used only for local dev / `--dry-run` and never ships. So code-level config (`triggers`, `compatibility_flags`, `main`, new bindings) is invisible to operators. The `operator-provisioning` capability already encodes the zero-config posture (auto-provision KV without ids, inject repo coords via `--var`, resolve bindings from the operator's config) — this change keeps all of that and adds a merge so code-level config is authoritative again.

The hazard: the code repo's `wrangler.jsonc` currently contains the **maintainer's real KV namespace ids**. Any merge that lets code ids reach another operator would bind that operator's Worker to the maintainer's KV — a cross-tenant data exposure. So the merge is security-sensitive, and KV-id provenance is the central decision.

## Goals / Non-Goals

**Goals:**
- Code-level wrangler config (`triggers`, `compatibility_*`, `main`, `observability`, `workers_dev`) propagates to operators automatically on deploy.
- No operator migration: existing full-copy `wrangler.jsonc` files keep deploying correctly.
- Preserve the zero-config posture (auto-provision KV, injected coords, by-binding KV writes).
- The KV-id provenance rule is enforced and tested.

**Non-Goals:**
- Migrating *existing* operators' `wrangler.jsonc` to the slim form (they keep working as-is via the merge; only the *template* for new operators is slimmed).
- Changing deploy auth, KV auto-provisioning, or secret posture.
- Merging arbitrary future keys without an explicit rule (the rule set is curated).

## Decisions

### 1. Merge, with the code config as the base and a curated per-key rule set

Replace the `cp` with a tested merge helper (`scripts/merge-wrangler-config.mjs`) run in the deploy. It takes the **code** `wrangler.jsonc` as the base and applies the operator's config by explicit per-key rules — *not* a blind deep merge, because the keys have different ownership and `kv_namespaces` needs by-binding handling.

| Key | Source / rule |
|---|---|
| `main`, `compatibility_date`, `compatibility_flags`, `observability`, `workers_dev` | **code** (operator value ignored — these are code-level) |
| `triggers` | **code** (so a new cron propagates) |
| `name` | operator if set, else code |
| `routes` / custom domain | **operator** |
| `vars` | **operator only** — the code repo's `vars` are the *maintainer's* (`GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `DATA_*`) and are **dropped**; the deploy injects `DATA_OWNER`/`DATA_REPO`/`DATA_REF` via `--var` (Decision 2) |
| `kv_namespaces` | **binding set from code**; **id always from the operator** (matched by binding name), else omitted → auto-provisioned. Code ids are dropped unconditionally (Decision 2). |

- **vs. blind deep merge:** arrays (`kv_namespaces`) don't deep-merge sensibly, and "operator wins everywhere" would let an operator's stale `compatibility_flags` or missing `triggers` override code. A curated rule set makes ownership explicit and reviewable.
- **vs. code-as-overlay-on-operator (closest to today):** would require operators to keep a full, correct copy of every code-level key — exactly the sync burden we're removing.

### 2. Operator-specific values (KV ids AND `vars`) ALWAYS originate from the operator; code's are never deployed elsewhere

The code repo's `wrangler.jsonc` is the *maintainer's real config*, so it carries the maintainer's KV ids **and** their `vars` (`GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `DATA_*`). Both are operator-specific and must never reach another operator.

- **`kv_namespaces`:** matched by **binding name** — the deployed entry uses the operator's id if present, else **no id** (auto-provisioned, the existing posture); code ids are **discarded unconditionally**. A fresh operator can never bind the maintainer's namespaces, and a new code-required binding still appears.
- **`vars`:** the deployed `vars` are the **operator's only**; the code repo's `vars` are dropped entirely (the deploy injects `DATA_OWNER`/`DATA_REPO`/`DATA_REF` via `--var`). Without this, a fresh operator would inherit the maintainer's GitHub App installation id — a cross-tenant exposure as severe as the KV one. *(This sharpens the original rule, which is `vars`-blind; both values get the same provenance guarantee, enforced by tests.)*

- Belt-and-suspenders: also **scrub the maintainer's real KV ids from the code repo's committed `wrangler.jsonc`** (replace with no-id bindings) so the footgun is gone even if the merge rule regresses. *(Open question — see below; the maintainer currently relies on those ids for their own deploy path.)*

### 3. No operator migration — the merge tolerates today's full-copy configs

Because code is the base and the operator only *contributes* its owned keys, an operator's existing full `wrangler.jsonc` still works: its KV ids, `vars`, `routes`, and `name` are read per the rules; its (possibly stale) `triggers`/`compatibility_*` are simply ignored in favor of code's. So operators do nothing; they just stop having to hand-sync. A future change could shrink their config to an overlay, but that's optional.

### 4. The merge is a tested, standalone helper

The merge logic is correctness- and security-critical, so it lives in `scripts/merge-wrangler-config.mjs` as a pure function over two parsed configs, unit-tested under `tests/` (Node `--test`, like the other build tooling), and the workflow just calls it. Tests cover: code `triggers` propagate; operator KV ids win and code KV ids never survive; a code-only binding appears id-less; operator `routes`/`name`/`vars` are honored; `compatibility_flags` come from code even if the operator's differ.

### 5. Slim the data-repo template to the minimal operator-owned set (coupled to the merge)

The template lives in `docs/data-template` (submodule → `groceries-agent-data-template`) and is `cp`'d as the operator's config at deploy. Today it carries `name`, `main`, `workers_dev`, `compatibility_date`, `compatibility_flags`, `vars.GITHUB_APP_ID`, id-less `kv_namespaces`, `observability` — and **no `triggers`** (the concrete cause of the missing cron). Once the merge supplies code-level keys, the template only needs the **operator-owned minimum**:

```jsonc
{
  // Code-level config (main, compatibility_*, triggers, observability) is merged in
  // from the upstream Worker at deploy — set only what's yours.
  "vars": { "GITHUB_APP_ID": "<app id>" }
  // optional: "name", or "workers_dev": false + "routes"/custom domain.
  // KV bindings come from code and auto-provision; their ids are pinned back here on first deploy.
}
```

- **Coupling:** the template can be slimmed **only because** the deploy now merges code-level config — a slim template deployed under the old `cp` model would ship without `main`/`compat`/`triggers` and break. So the template slim + submodule pointer bump land **in the same change** as the merge, never before it.
- **KV-id write-back is the catch.** The deploy pins auto-provisioned KV ids back into the operator's config so repeat deploys reuse namespaces (the existing "repeat deploys keep the same namespaces" requirement). With a slim template that omits `kv_namespaces`, the write-back must **create** that section (and the merge must still emit the bindings id-less on first deploy). The write-back operates on the *operator's* config file, not the merged artifact — confirm it tolerates an absent `kv_namespaces` and that ids persist across deploys.
- **Two repos:** implementing this edits the **template repo** (`groceries-agent-data-template`) and bumps the `docs/data-template` submodule pointer here. Existing operators are untouched (their full config still merges correctly per Decision 3).

## Risks / Trade-offs

- **Mis-binding KV (cross-tenant)** → the single most important risk; mitigated by Decision 2 + dedicated tests asserting code ids never appear in the output and operator/absent ids always do.
- **A code-level key an operator legitimately needs to override** (e.g. a custom `name` or extra route) → the rule table lets operator win for `name`/`routes`/`vars`; if a new override need appears, extend the table explicitly.
- **JSONC parsing** (the configs have comments) → the helper must parse JSONC (reuse the repo's TOML/JSON tooling pattern or a JSONC parser), not `JSON.parse` raw.
- **Drift between this rule table and reality** → keep the table small and tested; document the ownership boundary in `CONTRIBUTING.md`.

## Migration Plan

1. Land the merge helper + tests, swap the `cp` step for the merge step in `data-deploy.yml`.
2. Slim the template repo's `wrangler.jsonc` to the minimal operator-owned set (Decision 5) and bump the `docs/data-template` submodule pointer **in the same change** (after the merge step exists, never before).
3. Existing operators redeploy (no config change needed); code-level config now applies and the flyer cron registers. New operators start from the slim template.
4. Update `SELF_HOSTING.md` to drop the manual `triggers` stopgap, describe the merged-config model, and point at the slim template.
5. **Rollback:** revert the workflow step to the `cp` **and** the submodule pointer to the full template together (a slim template under the `cp` model would break). Existing operators are unaffected either way.

## Open Questions

- ~~**Scrub the maintainer's KV ids from the code repo's `wrangler.jsonc`?**~~ **RESOLVED (maintainer): yes — scrubbed.** The maintainer no longer deploys from the code repo (it's residual), so KV ids are id-less, `GITHUB_APP_ID` is a placeholder, and `GITHUB_INSTALLATION_ID`/`DATA_*` are dropped; real local-dev values live in `.dev.vars`. Both the scrub *and* the merge-strip are in place (defense in depth).
- **Where does the merge run** — inline `node scripts/merge-wrangler-config.mjs` in the workflow (needs `npm ci` first, already present) vs a self-contained script with no deps? Prefer reusing the installed toolchain.
- **`name` precedence** — is the Worker name code-default or operator-chosen? Defaulting to operator-if-set, else code, but confirm against how operators currently name their Worker.
