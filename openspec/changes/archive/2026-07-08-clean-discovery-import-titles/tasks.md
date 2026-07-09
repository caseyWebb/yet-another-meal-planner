# Tasks — clean-discovery-import-titles

Ordered so the import-time leg (§1–§3) lands first — it stops the bleeding (no new flowery rows) —
then the convergence pass (§4–§5) drains the existing backlog, then docs (§6) and the post-deploy
fixture verification (§7). **No spike tasks** — backlog size, the fixture rows, and the
flowery-title inventory are settled in `design.md` against production. Implementation is one
serial track: §1–§5 all touch the discovery/classify/scheduled() surfaces.

## 1. Classifier: the cleaned `title` output (ride-along + guard)

- [x] 1.1 In `packages/worker/src/discovery-classify.ts`, extend `SYSTEM_PROMPT` with a `title`
      output key: the clean dish name — strip SEO suffixes (trailing/embedded "Recipe"),
      marketing qualifiers ("the best", "easy", "homemade", "classic", superlatives), and
      editorial framing ("A Better …", "Our Go-To …", "… Recipe: X", "(Inspired By …)"); preserve
      foreign dish names over their gloss; KEEP identity-bearing dietary/method words ("Vegan",
      "Slow Cooker") and informative parenthetical glosses; when unsure, return the title
      unchanged. Add `title` to `CLASSIFIED_FIELDS`; do NOT add it to `DERIVED_FACET_FIELDS`.
- [x] 1.2 Anchor with few-shot exemplars: retitle ONE existing exemplar's input to a flowery form
      (e.g. "The Best Grilled Asparagus with Lemon Recipe") with the clean `title` in its output,
      and add `title` echoing the already-clean input on the other exemplars (clean-in →
      same-out, so the model learns not to rewrite clean titles). Keep the exemplars in sync with
      `scripts/spike-discovery-classify/prompt.mjs` per the file's comment, or note divergence.
- [x] 1.3 Add the pure guard `cleanedTitleOrFallback(raw: string, cleaned: unknown): string` —
      accept only a non-empty string whose lowercased alphanumeric word multiset is a subset of
      the raw title's; otherwise return `raw`. Apply it in `toFrontmatter` (`fm.title =
      cleanedTitleOrFallback(title, facets.title)`), so both the sweep and the corrective-retry
      loop see the guarded value. The contract validator gains NO title-quality clause (fail-open
      by design).
- [x] 1.4 Unit tests (`test/discovery-classify.test.ts` or sibling): guard accepts removal +
      re-casing ("Easy slow cooker BBQ pulled beef" → "Slow Cooker BBQ Pulled Beef"); rejects any
      inserted word (fallback to raw); rejects empty/non-string (fallback); "A Better Beer Can
      Chicken" → "Beer Can Chicken" passes; facet-consumer paths (`extractFacets` /
      `seedRecipeFacets`) ignore the classifier's `title` key.

## 2. Slug derivation: dish-name basis in `buildNewRecipe`

- [x] 2.1 In `packages/worker/src/discovery.ts`, derive the default slug from the title with any
      parenthetical segment(s) stripped (`stripParenthetical` — a small pure helper), falling
      back to the full title when the strip yields an empty slug; `slugOverride` behavior
      unchanged; `slugify` itself unchanged.
- [x] 2.2 Unit tests: "Jatjuk (Pine Nut Porridge)" → `jatjuk`; "Beer Can Chicken" →
      `beer-can-chicken`; "(Untitled)" falls back to the full-title basis; explicit `slugOverride`
      still wins.

## 3. Sweep: collision disambiguation + wiring the cleaned title through

- [x] 3.1 In `packages/worker/src/discovery-sweep.ts` `importRecipe`, catch the `slug_exists`
      `ToolError` from `buildNewRecipe` and retry with `slugOverride` = `<slug>-2` … `<slug>-9`
      (first free wins, deterministic); past `-9`, rethrow so the candidate parks as today. The
      import log entry records the final slug; the log's `title` stays the RAW candidate title
      (provenance — design Decision "title churn").
- [x] 3.2 Confirm (test) the cleaned title flows end-to-end: a sweep-imported candidate with a
      flowery page title writes the authored file with the clean `title` and the clean slug, and
      seeds description/facets from the same classified frontmatter (no behavior change there).
- [x] 3.3 Sweep unit tests (fake deps): collision → `-2` suffix imported (not parked); 9-deep
      exhaustion → parked `error`; `create_recipe` (via `discovery-tools`) still returns
      `slug_exists` unchanged.

## 4. D1 + the title re-audit pass

- [x] 4.1 Migration `packages/worker/migrations/d1/0044_title_audit.sql` (next available):
      `title_audit(slug TEXT PRIMARY KEY, audited_at INTEGER NOT NULL, outcome TEXT NOT NULL,
      before_title TEXT, after_title TEXT)`. Header comment: one-shot convergence stamp for the
      corpus title re-audit (`audited_at` pattern; new writes born-stamped); sibling-keyed to the
      replace-all `recipes` projection, NOT a column on it.
- [x] 4.2 D1 accessors (via `src/db.ts`, throw-free): `loadTitleAuditBacklog(env, limit)`
      (projected slugs+titles with no stamp, slug ASC), `stampTitleAudit(env, {slug, outcome,
      before?, after?}, now)`, `countTitleAuditRemaining(env)` — in the new
      `packages/worker/src/title-audit.ts` or `corpus-db.ts`, matching the surrounding idiom.
- [x] 4.3 `packages/worker/src/title-audit.ts`: the pass logic split from I/O (injected deps, the
      `runAliasAuditJob` shape). Per backlog recipe: read `recipes/<slug>.md` (skip+continue if
      vanished), one small `env.AI` title-clean call (same model binding as the classifier;
      title + compact ingredients excerpt as grounding), apply `cleanedTitleOrFallback`; different
      → `parseMarkdown` → set `frontmatter.title` → `serializeMarkdown` → `validateFile` →
      `store.put` → stamp `cleaned`; same/guarded-out → stamp `kept`. Transient error → no stamp
      (retries next tick). `TITLE_AUDIT_MAX_PER_TICK = 10` (code constant). NEVER touch the slug
      or path.
- [x] 4.4 Wire `runTitleAuditJob(env, buildTitleAuditDeps(env, corpus))` into `scheduled()`
      phase 1 (`packages/worker/src/index.ts`, beside the alias/edge audits — before the phase-2
      projection so a rewrite indexes the same tick). Add `"title-audit"` to `HEALTH_JOBS`
      (`src/health.ts`); write `job_health` + `job_runs` (`{audited, cleaned, kept, remaining}`,
      tenant-data-free), rethrow hard failures — the standard job shape. No admin-app changes
      (the Jobs/Health screens read the registry generically).
- [x] 4.5 Born-stamping: after a successful write in the sweep's `importRecipe` and in
      `create_recipe` (`discovery-tools.ts`), best-effort `stampTitleAudit(…, outcome: 'kept')`
      (catch + log, never fail the committed import).
- [x] 4.6 Unit tests (in-memory R2/D1 fakes): flowery title rewritten + stamped `cleaned` with
      before/after; clean title stamped `kept`, file byte-identical; guard-rejected model output
      stamps `kept` (no loop); batch bounded at the cap with the remainder deferred; drained
      backlog → zero model calls (quiesce); transient model failure leaves no stamp and the next
      run retries; born-stamped slug never enters the backlog; rewrite output passes
      `validateFile` and body/other frontmatter are preserved through the round-trip.

## 5. Downstream-propagation checks

- [x] 5.1 Test: a title rewrite changes the recipe-derived `content_hash` (title is in its
      domain, `recipe-embeddings.ts`) so the describe pass regenerates; the facet gate hash is
      unchanged (no reclassification).
- [x] 5.2 Run `aubr typecheck` and the full `aubr test`; run `aubr test:tooling` if any shared
      helper moved.

## 6. Docs in lockstep (current-state voice, no history narration)

- [x] 6.1 `docs/SCHEMAS.md` — the `title_audit` table (columns, the one-shot stamp semantics,
      born-stamped writes).
- [x] 6.2 `docs/ARCHITECTURE.md` — the title re-audit in the scheduled-job list (bounded,
      one-shot-stamped, quiescing; slug immutability).
- [x] 6.3 `docs/TOOLS.md` + the `create_recipe` tool description — slug derives from the dish
      name (parenthetical gloss excluded from the slug basis); `slug_exists` semantics unchanged.

## 7. Acceptance fixture — post-deploy verification (read-only)

- [ ] 7.1 After the deploy has run ≥ ~25 cron ticks, verify against production (read-only
      `wrangler d1 execute DB --remote`): `recipes.title` for `a-better-beer-can-chicken` =
      "Beer Can Chicken" (slug unchanged); its `title_audit` row is
      `cleaned / A Better Beer Can Chicken / Beer Can Chicken`; `title_audit` count = 205 and the
      `title-audit` job health shows `remaining: 0`; spot-check `super-soft-and-tender-lemon-
      yogurt-loaf` → "Lemon Yogurt Loaf" and negatives (`jatjuk-pine-nut-porridge`,
      `vegan-meatballs` stamped `kept`, unchanged). Record findings on the PR/issue #219.
