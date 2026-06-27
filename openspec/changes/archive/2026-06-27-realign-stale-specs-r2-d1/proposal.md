## Why

Two living specs still describe the **pre-R2 / pre-D1 architecture** that has already been replaced in code. `mcp-server` documents an "Authenticated GitHub data-access client" that reads the recipe corpus from a private data repo via a GitHub App installation token; `agent-bug-reporting` says `report_bug` opens a **GitHub issue**. Neither is true: the corpus lives in Cloudflare **R2** (`src/corpus-store.ts`, owned by the `r2-corpus-store` capability), `report_bug` records to the D1 **`bug_reports`** table reviewed in the Access-gated `/admin` panel, the data repo is **public**, and a **push to the code repo auto-dispatches** the data-repo deploy. Prior changes (R2 corpus migration, D1 bug reports, operator-admin, public-data-repo marketplace, auto-deploy) updated the code but never these two specs, so the living contract now contradicts shipped reality. This realigns the specs. **Spec-only — no code changes** (the code already behaves this way).

## What Changes

- **`mcp-server`:**
  - **REMOVE** "Authenticated GitHub data-access client" — there is no GitHub App / installation token; corpus data-access is R2, owned by `r2-corpus-store`.
  - **MODIFY** "MCP server over Streamable HTTP" — the per-request server closes over the resolved tenant's **R2/D1 context**, not "repo coordinates / repo state."
  - **MODIFY** "Operator-controlled Worker deployment from the data repo" — the data repo is **public** (nothing secret); the Worker's runtime secrets are **Kroger creds only** (no GitHub App private key); and a push to the code repo **does** auto-dispatch the data-repo deploy (`ci.yml` `trigger-deploy` via a fine-grained `DATA_REPO_ACTIONS_TOKEN`, gated on green CI) — the public repo still never runs `wrangler deploy` itself.
  - Fix the Purpose line (drop "the authenticated GitHub data-access client").
- **`agent-bug-reporting`:**
  - **MODIFY** "Worker files attributed bug reports as GitHub issues" → records an attributed report to the D1 **`bug_reports`** table (reporter = resolved tenant, timestamp server-stamped, `status='open'`), returns `{ filed: true }`, reviewed via `GET /admin/api/bug-reports`. No GitHub issue / label / App.
  - **MODIFY** "Graceful degradation without Issues permission" → a D1 write failure surfaces as a structured **`storage_error`** (via `src/db.ts`); there is no GitHub Issues permission. The agent still relays the failure rather than implying it filed.
  - The `report-grocery-agent-bug` skill requirements stay; reword "attributed issue" / "returns the URL" → "attributed report" / "returns `{ filed: true }` and informs the user," and "never a public repo" → "only the operator's D1 review queue, never any public surface."

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `mcp-server`: remove the obsolete GitHub data-access requirement; correct the deployment requirement (public data repo, Kroger-only secrets, auto-deploy) and the per-request tenant-context wording.
- `agent-bug-reporting`: `report_bug` writes the D1 `bug_reports` table reviewed in `/admin` (not a GitHub issue); failure handling is `storage_error` (not an Issues-permission error); skill wording realigned.

## Impact

- **Specs only:** `openspec/specs/mcp-server/spec.md` and `openspec/specs/agent-bug-reporting/spec.md` corrected to current architecture. No `src/`, workflow, or doc changes.
- **Ownership cross-refs:** corpus data-access → `r2-corpus-store`; the `/admin` bug-reports read → `operator-admin`; the auto-deploy trigger → `operator-provisioning` / `repo-structure`.
- Removes a standing contradiction between the living contract and shipped behavior; no runtime effect.
