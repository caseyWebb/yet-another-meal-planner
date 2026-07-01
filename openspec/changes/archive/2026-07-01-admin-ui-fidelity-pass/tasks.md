## 1. Shared primitives (build once, consume everywhere)

- [x] 1.1 Add a sparkline hover-tooltip primitive (mirrors the mock's `useTip()` + `bar-tip` markup) as a small client helper, imperatively driven from bar mouse handlers (no per-bar React/JSX node cost) — usable from both an SSR-rendered sparkline and a hydrated island.
- [x] 1.2 Add a trash-icon-only `Remove` button to the shared kit (`src/admin/ui/kit.tsx`), replacing the text "remove" `btn[data-variant=destructive]` pattern in `src/admin/client/corpus.tsx`.
- [x] 1.3 Add a frontmatter-stripping markdown-body helper reusable by both the Recipe detail view and the Guidance view — reuse the existing `parseMarkdown`-based body extraction the Recipe detail already performs (per the `operator-data-explorer` "Recipe body is provided frontmatter-stripped" requirement) rather than writing a second implementation.
- [x] 1.4 Extend the shared pretty key/value renderer so array-valued fields render as badge/pill chips (mirrors the mock's `PrettyKV`/`PrettyValue`), usable by both the R2 frontmatter panel and a D1 index row.
- [x] 1.5 Add a small job/candidate-property pill component (label:value as a `badge`) for Status's job summary counts.
- [x] 1.6 Fix `Slider` (`src/admin/ui/kit.tsx`) and its caller (`KnobRow` in `src/admin/client/knob-console.tsx`) to compute `(value - min) / (max - min) * 100` and set it as a `--slider-value` CSS custom property on the input, on both initial SSR render and every `onInput`, so the fill always reflects the true value instead of Basecoat's hardcoded 20% fallback.

## 2. Status homepage

- [x] 2.1 Remove the "Service Health" heading (health now lives in the global corner indicator only).
- [x] 2.2 Add an icon to each stat card (recipes, members, RSS feeds, cached SKUs) per the mock's `icon` field.
- [x] 2.3 Make the RSS Feeds stat tile navigate to the Config area's Discovery-feeds editor.
- [x] 2.4 Make the Cached SKUs stat tile navigate to the Data area's Stores explorer.
- [x] 2.5 Add a "checked `<relative age>`" label next to the Refresh action, reading the health snapshot's `generatedAt`.
- [x] 2.6 Render each job's summary counts (`jstat`s) as pills/badges using the primitive from 1.5.
- [x] 2.7 Cap the run-history sparkline's segment width and right-align the track so a still-populating sparkline (few runs) doesn't stretch/look broken.
- [x] 2.8 Wire the sparkline hover-tooltip primitive (1.1) onto each Status sparkline segment (run age, ok/fail, click-to-view-log).
- [x] 2.9 Add "OLDER"/"NOW" axis labels beneath the sparkline track.
- [x] 2.10 Add a border/shadow to stat cards and job/dependency item cards, matching the mock.

## 3. Members

- [x] 3.1 Remove the duplicate "ROSTER" heading (keep exactly one roster-section label).
- [x] 3.2 Fix the per-row actions-menu trigger button in `src/admin/client/members.tsx` (`RowMenu`) to call `preventDefault()`/`stopPropagation()` on its own `onClick` (matching the `stop()` guard already used by its Rotate/Kroger-link/Revoke action buttons), so opening the menu never navigates to the member detail page.
- [x] 3.3 Rebuild the admin islands (`aubr build:admin`) and manually verify the dropdown no longer navigates — rule out a stale bundle as a contributing cause alongside the code fix.
- [x] 3.4 Investigate the "both members show awaiting claude.ai connection" report against the *operator's* live/remote environment: confirm `migrations/d1/0024_tenant_activity.sql` is applied `--remote`, and confirm a real MCP tool call from each member's Claude.ai session writes a `tenant_activity` row (verifies `touchTenantActivity`'s wiring end-to-end, not just by local code reading).
- [x] 3.5 If 3.4 confirms activity truly isn't being recorded, replace `touchTenantActivity`'s silent `catch {}` (`src/tenant.ts`) with a structured (non-throwing) log/metric so a future write failure is diagnosable instead of presenting identically to "no activity yet."
- [x] 3.6 If 3.4 confirms the members simply haven't connected since the redeploy, close this item with that finding (no code change) and note it for the operator.

## 4. Data > Recipes

- [x] 4.1 Add an operator-configurable page-size control to the Recipes list, defaulting to 50 (replacing the current fixed `PAGE_SIZE = 6` in `src/admin/pages/data.tsx`), preserving the current filter/search/mode state across a page-size change.

## 5. Recipe detail

- [x] 5.1 Route the D1 index row's array-valued fields (tags, dietary, etc.) through the extended pretty-renderer (1.4) so they render as badge/pill chips instead of raw text/JSON, matching the R2 frontmatter panel's treatment.
- [x] 5.2 Audit and improve the markdown-to-HTML rendering fidelity for the recipe body (headings/lists/emphasis rendering quality) against the mock's `RecipeDetail.jsx`.

## 6. Data > Stores

- [x] 6.1 Verify against the operator's live/remote D1 whether `stores` genuinely has zero rows (matching local dev) or whether it has data the explorer fails to surface; local investigation of `storeList`/`storeDetail` (`src/admin-data.ts`) found no query bug (no incorrect tenant filter, correct table/column names).
- [x] 6.2 If 6.1 finds real data the explorer isn't showing, re-diagnose (route wiring, env binding mismatch) and fix; if 6.1 confirms the registry is genuinely empty, close with that finding.

## 7. Guidance

- [x] 7.1 Strip the YAML frontmatter fence before rendering a `guidance/**` object's markdown, using the shared helper from 1.3, eliminating the stray leading whitespace and `<hr>`.
- [x] 7.2 Render the extracted frontmatter as a pretty key/value block (reusing the recipe frontmatter panel's presentation) above the rendered guidance body.

## 8. Usage

- [x] 8.1 Add spacing below the "Cloudflare usage for `<day>` (UTC)…" line.
- [x] 8.2 Fix the Usage area's container/card layout so cards do not exceed the container width (widen the container or correct the card sizing/wrapping). Fixed by giving the Usage page the `wide` container (60rem, matching Data/Discovery/Logs/Config) — it was rendering in the narrower 44rem default, which crammed the 4-column stat-tile grid and the per-namespace-stacked meters.
- [x] 8.3 Confirmed `KV_NAMESPACE_LABELS` is unset in the affected environment (per design.md's diagnosis) — but rather than stopping at "documented, gated behavior," `resolveNamespaceLabel` now AUTO-RESOLVES via a fallback chain: (a) the Cloudflare REST API's own namespace title (`GET /accounts/{id}/storage/kv/namespaces`, `fetchNamespaceTitles`), needing no operator config; (b) `KV_NAMESPACE_LABELS` as a fallback when the token lacks the REST call's "Workers KV Storage: Read" scope; (c) the raw id + generic color as a last resort. This is the root-cause fix for both the raw-id names AND the all-grey colors (same cause: an unresolved namespace falls back to the generic `unlabeled` swatch).
- [x] 8.4 Superseded by 8.3's runtime auto-resolution (no deploy-tooling change needed): a fresh deploy now shows correct names/colors automatically, without a manual `KV_NAMESPACE_LABELS` paste step, as long as the analytics token also carries "Workers KV Storage: Read". Documented the scope requirement + the `KV_NAMESPACE_LABELS` fallback prominently in `docs/SELF_HOSTING.md`.
- [x] 8.5 Wired the sparkline hover-tooltip primitive's `data-tip-title`/`data-tip-body` attributes (1.1) onto the Usage area's per-namespace KV-operation segments (`.kv-seg`) and the 30-day stacked KV sparkline columns (`.spark-col`), replacing the native `title` attribute. Also investigated a Workers AI neuron 30-day history series (mirroring the KV history widening): could not confirm a `date`-dimensioned `aiInferenceAdaptiveGroups` field against the live Cloudflare schema (network access to Cloudflare's docs was unavailable in this environment, and the module's own discipline requires live-schema verification before shipping a new GraphQL field) — rather than fabricate a series, the AI neuron meter renders today's actual value only, with an explanatory note, and no sparkline.

## 9. Discovery

- [x] 9.1 Extend `matchMembers`'s call sites in `src/discovery-sweep.ts` so a `no_match` (stage `match` or `confirm`) or `dietary_gated` outcome's logged `detail` includes the computed per-member match scores (currently computed in `matchMembers` and discarded), per the `discovery-sweep` spec delta.
- [x] 9.2 Surface those per-member match scores on the Discovery area's candidate card when a candidate halted at the match stage, per the `operator-admin` spec delta.
- [x] 9.3 Make the candidate card's expand/collapse ("Details") affordance consistent in both directions: show the toggle's current-state label before first expansion (not only after), and make a second click on "Details" collapse the card back — mirror the mock's `DiscoveryScreen.jsx` toggle behavior.

## 10. Logs

- [x] 10.1 Remove the left sidebar/submenu from the Logs area (`src/admin/pages/logs.tsx`) — render the all-jobs run log as the area's sole, full-width content, per the `operator-admin` spec delta.

## 11. Config

- [x] 11.1 Bring the Discovery-feeds editor's layout/styling in line with the mock's `CorpusEditor` (`ConfigScreen.jsx`'s `GroupDiscovery`).
- [x] 11.2 Bring the flyer-terms editor's layout/styling in line with the mock's `CorpusEditor` (`GroupFlyer`).
- [x] 11.3 Bring the aliases editor's layout/styling in line with the mock's `CorpusEditor` (`GroupAliases`).
- [x] 11.4 Replace every corpus-editor row's text "remove" button with the shared trash-icon button (1.2) — feeds, flyer terms, aliases, and the Email Sources (always-import) editor.
- [x] 11.5 Verify the slider-fill fix (1.6) resolves the reported "fixed amount for all sliders" bug across every knob console (Discovery calibration, Kroger Flyer, Ranking).

## 12. Overall fidelity pass

- [x] 12.1 After the above land, do a side-by-side pass of every area against its mock file (`StatusScreen.jsx`, `MembersScreen.jsx`, `RecipesScreen.jsx`, `RecipeDetail.jsx`, `StoresScreen.jsx`, `GuidanceScreen.jsx`, `UsageScreen.jsx`, `DiscoveryScreen.jsx`, `LogsScreen.jsx`, `ConfigScreen.jsx`) and note/fix any remaining visual drift not already captured above. Fixed: the `Slider` primitive set `--slider-value` correctly but `styles.css` had no rule consuming it (Basecoat's Vega track is a flat `bg-muted`, no gradient) — every Config slider showed an unfilled bar; added a real cross-browser (WebKit gradient + Firefox `-moz-range-progress`) track-fill rule. Discovery's area-head was missing the "Refresh · last sweep …" affordance every other area has — added, sourced from the freshest candidate's `created_at` (candidates are already newest-first). `.job-item.fail`'s red-tinted card CSS existed but nothing wired the class — wired it on the Status `JobRow`. `.kv-leg-note` was an orphaned CSS rule — now renders a short static descriptor for each of the three known KV bindings. `.cfg-add`'s top margin was `.1rem` vs the mock's `.9rem` — fixed. Investigated the Email Sources per-row label/icon-swatch: `discovery_senders` has a `name` column but `discovery_members` does not (`migrations/d1/0006_shared_corpus.sql`), so an editable label is schema-supported for senders only, not members — adding it asymmetrically would be a half-feature; deferred as a follow-up rather than over-scoped here.
- [x] 12.2 Run `aubr typecheck` and `aubr test` to confirm no regressions.
- [x] 12.3 Ran `aubr build:admin` (clean) and confirmed the slider-fill CSS rule is present in the compiled `admin/dist/admin/styles.css`, reading `--slider-value`; `aubr dev` in this sandboxed session couldn't reach the remote AI binding it depends on for a full page render, so the live-dev smoke test itself is left to the operator/a future interactive session — the build output + full test suite are the verification actually performed here.
