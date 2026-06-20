## Context

The Worker currently reads `_indexes/recipes.json` from the data repo via the GitHub App on every tool invocation that touches the recipe index — `list_recipes`, `retrospective`, `read_recipe` (slug validation), and the discovery idempotency check. Each call makes a synchronous GitHub API request (~100–300 ms) before any tool logic runs. The index is a 100% derived artifact: built deterministically from `recipes/*.md` by `build-indexes.mjs`, never edited directly.

Three existing KV namespaces (`KROGER_KV`, `TENANT_KV`, `OAUTH_KV`) follow a zero-config provisioning pattern: the code repo ships id-less bindings, `wrangler deploy` auto-provisions them, and a pin-back step commits the real IDs to the operator's `wrangler.jsonc`. The build-indexes CI step currently requires only `contents: write` (to commit the JSON file back) and carries no secrets.

## Goals / Non-Goals

**Goals:**
- Recipe index reads go to KV (~1 ms, no rate limit) rather than GitHub API.
- No new operator setup steps or secrets beyond what already exist.
- `DATA_KV` follows the same zero-config provisioning pattern as the existing namespaces.
- Bootstrap gap (index not yet in KV on first deploy) is closed automatically.

**Non-Goals:**
- Caching other files (recipe bodies, pantry, preferences, etc.) in KV — those are user-editable and correctly live in GitHub.
- Removing `_indexes/recipes.json` from git — it retains git-diff value; cost is negligible.
- Worker-side caching with TTL — unnecessary given CI publishes on every recipe push.
- Fallback to GitHub if KV is unavailable — adds permanent complexity for a failure mode that is indistinguishable from any other KV outage affecting existing bindings.

## Decisions

### D1: New `DATA_KV` namespace, not reuse of an existing one

`KROGER_KV`, `TENANT_KV`, and `OAUTH_KV` each have a clear semantic scope. Mixing recipe-index data into any of them makes the scope ambiguous and complicates future key management. `DATA_KV` is the right home for shared corpus artifacts.

### D2: KV key is `"index:recipes"`

A namespaced string key (not a bare `"recipes"`) leaves room for future derived artifacts (e.g., `"index:ready_to_eat"`) without introducing a naming collision. The value is the raw JSON string of `recipes.json` (identical to what was committed).

### D3: No Worker fallback to GitHub

If `DATA_KV` is unavailable, returning `index_unavailable` is the correct behaviour — the same error already surfaced when the JSON file was absent from git. A fallback path would keep the GitHub-read code alive indefinitely and create a two-speed system. The bootstrap gap is closed at the deploy layer (see Migration Plan), not with a runtime fallback.

### D4: Build-indexes reads the namespace ID from `wrangler.jsonc`

The reusable `data-build-indexes.yml` already checks out the data repo (for `recipes/`). After a deploy has run and pinned back the `DATA_KV` id, the ID is available in `wrangler.jsonc`. The publish step extracts it via a small inline script (`node -e "…"` with JSON5 parse) — no new input required from the operator.

### D5: Deploy workflow runs build-indexes after deploy to close the bootstrap gap

A new operator who deploys before ever pushing a recipe would have `DATA_KV` populated with an empty `{}` (or not at all). Running `build-indexes --publish` as a step in `data-deploy.yml` (after the deploy step, using the freshly-pinned namespace ID) ensures the index is always in KV immediately after a successful deploy. This step is a no-op if the namespace is already current.

### D6: `_indexes/recipes.json` kept in git

Removing it would require removing the git-commit step from `data-build-indexes.yml` and deleting the existing file — churn with no functional payoff. The file continues to be written and committed; the Worker simply stops reading it. A future cleanup could remove it, but that is out of scope here.

## Risks / Trade-offs

**Bootstrap ordering** — `DATA_KV` namespace ID must exist in `wrangler.jsonc` before `build-indexes` can publish. The deploy workflow's post-deploy publish step closes this for first deploy; subsequent recipe pushes always have the ID pinned.
→ Mitigation: deploy workflow runs build-indexes after deploy. The `data-build-indexes.yml` publish step fails gracefully (warn + skip) if the ID is absent rather than hard-failing the whole workflow.

**KV value size** — KV values are capped at 25 MiB. A recipe corpus large enough to hit this limit is implausible at friend-group scale.
→ No mitigation required; document the ceiling in a comment if desired.

**`CLOUDFLARE_API_TOKEN` scope expands to `build-indexes` workflow** — The token is already a data-repo secret used by deploy/onboard/revoke. Adding it to build-indexes (triggered on every `recipes/**` push) increases the attack surface of that workflow.
→ Accepted: single-operator project; the token is already present in the same repo. Operator can scope the token to KV-write-only if desired.

## Migration Plan

1. **Code repo**: Add `DATA_KV` id-less binding to `wrangler.jsonc`; add `DATA_KV: KVNamespace` to `src/env.ts`; switch Worker read sites to KV; add publish step to `data-build-indexes.yml`; add post-deploy build-indexes step to `data-deploy.yml`.
2. **Data-template repo**: Add id-less `DATA_KV` to `wrangler.jsonc`; add `secrets: inherit` to thin `build-indexes.yml` caller.
3. **Operator data repo**: Add id-less `DATA_KV` to `wrangler.jsonc` (or manually create in CF dashboard and insert the ID); add `secrets: inherit` to `build-indexes.yml`.
4. **Deploy**: Run Deploy Worker → auto-provisions `DATA_KV`, pins ID back, then runs build-indexes publish step → index is live in KV.
5. **Verify**: Call `list_recipes` and confirm response; check KV in CF dashboard for `index:recipes` key.

Rollback: revert the Worker read-site changes and redeploy. The `_indexes/recipes.json` file remains in git throughout, so the old read path can be restored instantly.

## Open Questions

None — all decisions were resolved during the exploration phase.
