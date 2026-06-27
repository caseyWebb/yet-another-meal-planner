## Why

The GitHub data repo wears **two hats**: a **content store** (`recipes/*.md` + `guidance/**/*.md`, the human-authored markdown) and a **control plane** (config + the deploy/onboard/revoke/index workflows). The `operator-admin-panel` change is removing the control-plane hat (onboard/revoke move in-Worker). This change removes the **content-store** hat.

Keeping recipe content on GitHub forces the single gnarliest piece of operator setup — registering a **GitHub App**, converting a PKCS#1 key to PKCS#8 with `openssl`, installing it on the repo, and pasting the private key as a Cloudflare secret — and a **second data plane** (the Worker mints a short-lived installation token per request just to read a markdown file). Moving the authored markdown to a **Cloudflare R2 bucket** bound to the Worker:

- **deletes the GitHub App entirely** for data access (no registration, no key, no installation, no per-request token mint) — the biggest setup-friction reduction available;
- **unifies the data plane** on Cloudflare (Worker + D1 + KV + R2), with lower-latency reads (a native binding, no GitHub API round-trip or rate limit);
- makes **Obsidian-native authoring** first-class — authors edit a vault synced to the same R2 the Worker reads ([Remotely Save] supports R2), replacing today's "point Obsidian at a local git clone" story;
- removes the GitHub **Pro** requirement for the cookbook (it moves to the Worker's static assets / Cloudflare Pages).

**Code and plugin distribution stay on GitHub** (public repo + marketplace — unaffected). Only *data* leaves. Combined with `operator-admin-panel`, this leaves GitHub needed for code+marketplace only, and removes the data repo as a content dependency. The deliberately-accepted trade is **git history for the recipe corpus** (the operator has confirmed history is not load-bearing here).

## What Changes

- **Authored markdown moves to R2.** `recipes/*.md` and `guidance/**/*.md` live in an R2 bucket bound to the Worker. The existing `GitHubClient` seam (`src/github.ts`, already an interface) is replaced by an R2-backed corpus store with the same read/list/write surface; `gh-read.ts` and `commit.ts` retarget to R2.
- **The recipe index is projected by the Worker reconcile, not CI.** `scripts/build-indexes.mjs` (the only CI script that writes D1) retires; the scheduled reconcile reads R2, **validates the whole corpus** (now including the `pairs_with` cross-resolution CI did, because the reconcile holds the entire corpus), and projects the D1 `recipes` table. CI stops writing D1.
- **Validation consolidates to one validator.** The workerd `src/validate.ts` (already the full required-field + vocab contract) runs on agent writes **and** on the reconcile; the Node build validator is retired. Human-edit feedback becomes **eventual** — a malformed Obsidian edit is skipped by the reconcile and surfaced via `/health`, an ntfy push, and an agent-readable `reconcile_errors` record — instead of red CI. (Eventual consistency is the system's accepted model; the `obsidian-authoring-vault` change additionally restores *fast* feedback at the editing surface via constrained dropdowns.)
- **Eventual, not event-driven.** Reprojection rides the existing cron reconcile (the accepted eventual model, no new infra), not R2 event-notifications + Queues (a paid, lower-latency alternative noted but not adopted).
- **Loose ends move off GitHub:** `report_bug` (today GitHub issues) writes a D1 `bug_reports` table surfaced by the operator admin panel; `recipe_site_url` / the cookbook move to the Worker's static assets or Cloudflare Pages; the GitHub App + installation-token path is removed for data.

## Capabilities

### New Capabilities
- `r2-corpus-store`: the R2-backed authored-corpus tier — its read/list/write contract, the Worker-reconcile projection + corpus-wide validation that replaces the CI build, and the eventual-feedback model for human-direct edits.

### Modified Capabilities
- `cloudflare-data-platform`: the three-tier boundary's authored-markdown tier moves from **GitHub → R2**; the Worker binds an R2 bucket; the "build-indexes is the only CI D1 writer" note is retired (the reconcile is the writer).

## Impact

- **Worker (`src/`):** `github.ts`/`gh-read.ts`/`commit.ts` → an R2 corpus store (`src/corpus-store.ts`); `guidance.ts`, `recipes.ts`/`read_recipe`, the recipe write tools retarget; the reconcile gains the index-projection + corpus-validation pass; `github-app.ts` + the installation-token resolver are removed for data; `report_bug` retargets to D1.
- **Build/CI:** `scripts/build-indexes.mjs` + `scripts/d1-rest.mjs` retire (no CI D1 writes); the data-repo `build-indexes.yml` workflow goes away.
- **Config:** `wrangler.jsonc` gains an `r2_buckets` binding, added to the `merge-wrangler-config.mjs` allowlist (the documented silent-drop trap) with a merge test.
- **Migration:** a one-time copy of the git corpus → R2; a dual-read window during cutover.
- **Docs (lockstep):** `docs/ARCHITECTURE.md` (three-tier boundary, the reconcile-owns-projection move, validation consolidation), `docs/SCHEMAS.md` (corpus tier is R2), `docs/SELF_HOSTING.md` (no GitHub App; R2 + Obsidian authoring; cookbook host), `docs/TOOLS.md` (`report_bug` sink, `recipe_site_url`).
- **Out of scope:** the **deploy substrate** ("Deploy to Cloudflare" button + fork vs. a featherweight control repo) — a separate decision; this change moves the *content store*, not how the Worker is deployed. `operator-admin-panel` (the `bug_reports` surface, the control-plane half) and `ai-derived-recipe-metadata` (smaller authored surface, the reconcile-derive loop now proven in prod) have **both merged** — this change builds on them.

[Remotely Save]: https://github.com/remotely-save/remotely-save
