## 1. `update_stockup` write tool (per-tenant)

- [x] 1.1 Add a pure, unit-testable `addStockup(existingRaw, additions)` helper (e.g. `src/stockup.ts`) mirroring `addSources` in `src/email.ts`: parse existing `stockup.toml`, merge `[[items]]` deduped by normalized `name` (existing untouched), set an optional top-level `freezer_capacity_estimate`, and serialize via `stringifyTomlWithHeader`. Return `{ text, added }`.
- [x] 1.2 Register `update_stockup` in `src/write-tools.ts` using the **prefixed (per-tenant) client** (writes `users/<username>/stockup.toml`): zod input of `items[]` (`name` required; optional `unit`, `typical_purchase`, `notes`, `baseline_price`, `buy_at_or_below`) plus optional `freezer_capacity_estimate` (enum `tight|moderate|spacious`); commit via `commitFiles`; return `{ added, commit_sha }`; no-commit when nothing new.
- [x] 1.3 Add `test/stockup.test.ts` for the helper (dedup by name, threshold fields optional/omitted, freezer estimate, empty-file create) and a tool-level test in `test/write-tools.test.ts` (per-tenant path, no-op-on-duplicate returns `commit_sha: null`).

## 2. `update_feeds` write tool (shared)

- [x] 2.1 Add a pure `addFeeds(existingRaw, feeds)` helper (in `src/feeds.ts` or a small helper module) mirroring `addSources`: dedup by `canonicalizeUrl(url)` (existing untouched), accept `url` (required), `name?`, `weight?` (default 1), `tags?`, serialize via `stringifyTomlWithHeader`. Return `{ text, added }`.
- [x] 2.2 Register `update_feeds` in `src/discovery-tools.ts` using the **shared client** (writes data-repo-root `feeds.toml`), alongside `update_discovery_sources`: zod input `feeds[]`; commit via `commitFiles`; return `{ added, commit_sha }`; no-commit when nothing new.
- [x] 2.3 Add helper tests (`test/feeds.test.ts`) and a tool-level test in `test/discovery.test.ts` (shared root path, dedup-by-canonical-url no-op).

## 3. `recipe_site_url` tool (runtime GitHub Pages lookup)

- [x] 3.1 Add `getPagesUrl()` to the GitHub client (`src/github.ts`): `GET /repos/{owner}/{repo}/pages` → `{ url, enabled }`; 404 → `{ url: null, enabled: false }`; a 403 (no `Pages: read`) rethrown as `GitHubError`. Add to the `GitHubClient` interface and the `prefixedClient` wrapper (repo-level, like `createIssue`).
- [x] 3.2 Register the `recipe_site_url` read tool (`src/tools.ts`, shared client), mapping a 403 to a structured `insufficient_permission` error. Cover `getPagesUrl` (enabled 200 / not-enabled 404 / 403) in `test/github.test.ts`.

## 4. Rewrite the onboarding flow in the canonical source

- [x] 4.1 Rewrite the `### Configure grocery profile` flow in `AGENT_INSTRUCTIONS.md`: branch-by-area resumability; ordered areas (store ZIP → taste → diet → equipment → starter corpus → thorough inventory → optional stockup → optional ready-to-eat → "first menu?" handoff); fix the stale "five areas" count.
- [x] 4.2 Add the **store ZIP** area (write `[stores].preferred_location` via `update_preferences`; ZIP only, no brand interrogation).
- [x] 4.3 Add the **starter-corpus bootstrap**: curate a soft-capped set (~12–18, LLM-judged) of taste/diet-fit, makeable recipes — the agent maps the free-form taste narrative to `list_recipes` filters, issuing multiple queries (per loved cuisine/protein) or pulling `status:'all'` and reasoning over the returned set; confirm; bulk-promote to `active` in one `commit_changes` `recipe_updates`; for the full corpus call `recipe_site_url()` and surface the link (relay `enabled:false`/`insufficient_permission` as a setup step); degrade to discovery seeding when the corpus is sparse (senders via `update_discovery_sources`, feeds via `update_feeds`, URLs via `import_recipe`).
- [x] 4.4 Deepen the **first-run inventory** area: room-by-room walk incl. the spice drawer, suggest voice/dictation; move "keep it light, self-corrects" to the returning-member branch.
- [x] 4.5 Add the optional **bulk-buy watchlist** area via `update_stockup` (names + `typical_purchase` + `freezer_capacity_estimate`; do not prompt for price thresholds; skippable).
- [x] 4.6 Wire **ready-to-eat ↔ pantry cross-recording** in onboarding: in the inventory area, recognize heat-and-eat items the member names and offer to catalog them (`add_draft_ready_to_eat`, `status: active`) in addition to recording pantry stock; in the heat-and-eat area, record on-hand stock via `update_pantry` for items the member currently has — consistent name across both so the restock cross-reference matches.
- [x] 4.7 Handle the two flow-correctness traps in the rewritten flow: treat a `not_found` from `read_preferences`/`read_pantry`/`read_taste`/`read_diet_principles` as an empty area (never a bug to report); and write the **complete** `preferences.toml` content on every `update_preferences` call (read-merge-write) so a later area doesn't clobber the store ZIP (it overwrites verbatim).
- [x] 4.8 Update the skill marker `description` to reflect the new areas (store, starter corpus) for triggering.
- [x] 4.9 Run `npm run build:plugin` (connector URL only) to regenerate the `plugin/grocery-agent/` bundle from source.

## 4b. Cross-record ready-to-eat in the standalone pantry-update flow

- [x] 4b.1 Extend the `### Pantry update` flow in `AGENT_INSTRUCTIONS.md`: when an ad-hoc `update_pantry` haul includes heat-and-eat items (e.g. a freezer-load of frozen dinners), record their pantry stock and **offer** to catalog the not-already-cataloged ones via `add_draft_ready_to_eat` (`status: active`), using a consistent name so the favorites↔on-hand restock cross-reference matches (per the `cooking-history` cross-record requirement).

## 5. Docs

- [x] 5.1 Add `update_stockup` and `update_feeds` entries to `docs/TOOLS.md` (params/returns), keeping it in sync with the implementations.
- [x] 5.2 `docs/SCHEMAS.md` cleanups: quote the `feeds.toml` `tags` array example, note that stockup `baseline_price`/`buy_at_or_below` are advisory/LLM-reasoned (not gates), and note `stockup.toml` is now agent-writable via `update_stockup`.
- [x] 5.3 Fix the stale comment at `src/tools.ts:720` that calls `feeds.toml` "this tenant's personal config" — it is shared (data-repo root) since discovery went group-wide; correct it while touching discovery tooling.
- [x] 5.4 Add a `recipe_site_url()` entry to `docs/TOOLS.md` (returns `{ url, enabled }`; `insufficient_permission` on missing `Pages: read`).
- [x] 5.5 Note the GitHub App's new **`Pages: read`** permission requirement in `docs/SELF_HOSTING.md` (one-time operator grant, needed for `recipe_site_url` on a private repo).

## 6. Verify & operator setup

- [x] 6.1 `npm run typecheck`, `npm test` (Worker/vitest), and `npm run test:tooling` (build scripts) all green.
- [x] 6.2 `node scripts/build-plugin.mjs --check` passes; `openspec validate improve-onboarding` passes.
- [x] 6.3 Operator: grant the GitHub App the **`Pages: read`** permission (so `recipe_site_url` resolves the private data repo's Pages site).
- [ ] 6.4 After merge to `main`: push the Worker changes, trigger the data-repo `deploy.yml`, and let the marketplace pull-update carry the regenerated onboarding skill.
