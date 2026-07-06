// The harness's deterministic fixture set: every data-hungry admin area gets fixed-id rows so
// the suite asserts (and screenshots) populated surfaces, never accidental empty states.
//
// Timestamps are computed RELATIVE TO THE RUN'S CLOCK at stable-bucket offsets (2 h, 3 d — the
// hour/day buckets hide minute drift between runs), so the panel's relative-age labels ("5m ago", "2h ago") render the same text on every
// run without any injected clock or product-code change. Page objects assert on the literals
// exported here (SEED) and never on relative-age text. Typed for the TS harness by seed.d.mts —
// keep the two in lockstep when adding a literal.
//
// Idempotent: every statement DELETEs its fixed ids (or upserts by PK) before inserting, so a
// re-run against a previously-seeded local D1 converges instead of duplicating.

/** The literals the page objects assert on (one source of truth with the SQL below). */
export const SEED = {
  members: { active: "casey", pending: "pat" },
  recipe: {
    slug: "viz-miso-salmon",
    title: "Miso-Glazed Salmon Bowls",
    source: "https://example-kitchen.com/recipes/miso-salmon",
  },
  discovery: {
    errId: "viz-err",
    errTitle: "Example Recipe A",
    rejId: "viz-rej",
    rejTitle: "Example Recipe B",
    importedId: "viz-imp",
    importedTitle: "Example Recipe C",
  },
  normalize: {
    decisionTerm: "unsalted butter",
    queueTerm: "guanciale",
    aliasVariant: "scallions",
    canonicalId: "green-onion",
    // A canonical self-entry (variant === id): counted by the Aliases tab's chip, never listed.
    selfEntryVariant: "butter",
  },
  // The audit surface (Normalize › Audits + Decisions › Edges + the Status identity-audit row):
  // one kept edge decision, one dropped-then-restored edge decision (the restorations log +
  // the "revisited" pointer), and one merge-rejection pair.
  audit: {
    keptEdge: { from: "green-onion", to: "allium" },
    droppedEdge: { from: "chives", to: "green-onion" },
    rejection: { a: "chives", b: "green-onion" },
  },
  // Config › Ingest Keys: one operator-global key (no tenant binding) + one key bound to the
  // connected member — so the roster's binding column renders both the muted "operator-global"
  // and a bound-member badge, and the mint dialog's tenant selector offers the allowlist.
  ingestKeys: {
    global: { id: "ik-viz-global", label: "kitchen-nas", prefix: "ing_live_a1b2" },
    bound: { id: "ik-viz-bound", label: "casey-laptop", prefix: "ing_live_c3d4", tenant: "casey" },
  },
  // Discovery › Satellites source-audit (satellite-source-audit): the operator-global key's three
  // recipe sources, one per quality state — a CLEAN source (empty drill-down), a DEGRADING source
  // (a quarantine recommendation; an aggregatable worker reject + a pre-aggregated local flood in
  // the ledger), and a QUARANTINED source (the held block + the un-quarantine toggle).
  satellites: {
    clean: { source: "NYT Cooking" },
    degrading: { source: "Bon Appétit", localCount: 40 },
    quarantined: { source: "Cook's Illustrated" },
  },
  // Mirrors src/health.ts HEALTH_JOBS (every registered job gets health + run history so no
  // Status row renders never-run).
  jobs: [
    "flyer-warm",
    "sale-scan-plan",
    "recipe-classify",
    "recipe-index",
    "recipe-embed",
    "night-vibe-embed",
    "email",
    "discovery-sweep",
    "reconcile-signals",
    "archetype-derive",
  ],
};

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The D1 seed statements for `wrangler d1 execute --command` (now = the run's epoch ms). */
export function d1Statements(now) {
  const iso = (ms) => new Date(ms).toISOString();
  const day = (ms) => iso(ms).slice(0, 10);
  const { members, recipe, discovery, normalize, jobs } = SEED;
  const stmts = [];

  // --- Status / Logs: job_health (current state) + job_runs (sparkline + run-log history).
  stmts.push(`DELETE FROM job_health WHERE name IN (${[...jobs, "ingredient-normalize", "grocery-reconcile"].map(q).join(",")});`);
  for (const [i, job] of [...jobs, "ingredient-normalize", "grocery-reconcile"].entries()) {
    stmts.push(
      `INSERT INTO job_health (name, ok, last_run_at, summary) VALUES (${q(job)}, 1, ${now - 2 * HOUR - i * MIN}, '{"processed":3}');`,
    );
  }
  stmts.push(`DELETE FROM job_runs WHERE id LIKE 'viz-run-%';`);
  for (const job of jobs) {
    for (let k = 0; k < 8; k++) {
      // Newest run 2h ago (an hour-bucket label — stable across runs), older ones every 6h; one
      // mid-history failure per job keeps the sparkline's ok/fail bars visually mixed without
      // flipping current health (ok=1 above).
      const ranAt = now - 2 * HOUR - (7 - k) * 6 * HOUR;
      const ok = k === 4 ? 0 : 1;
      // recipe-index runs carry the recipe-backfill convergence (unresolved draining toward
      // zero; the NEWEST tick degraded so the calm amber chip renders); other jobs get a
      // generic summary. The failure run keeps its {error} shape (no unresolved — the gauge
      // derivation skips it).
      const RECIPE_INDEX_UNRESOLVED = [259, 210, 168, 141, 128, 120, 114, 112];
      const summary = !ok
        ? '{"error":"upstream timeout"}'
        : job === "recipe-index"
          ? JSON.stringify({ projected: 3, skipped: 0, unresolved: RECIPE_INDEX_UNRESOLVED[k], degraded: k === 7 })
          : '{"processed":3}';
      stmts.push(
        `INSERT INTO job_runs (id, job, ok, ran_at, duration_ms, summary) VALUES (${q(`viz-run-${job}-${k}`)}, ${q(job)}, ${ok}, ${ranAt}, 1200, '${summary}');`,
      );
    }
  }
  // The grocery/pantry key-reconcile ticks (Normalize › Reconcile card + the Status row).
  for (let k = 0; k < 6; k++) {
    const ranAt = now - 2 * HOUR - (5 - k) * 2 * HOUR;
    stmts.push(
      `INSERT INTO job_runs (id, job, ok, ran_at, duration_ms, summary) VALUES (${q(`viz-run-reconcile-${k}`)}, 'grocery-reconcile', 1, ${ranAt}, 800, '{"grocery_rekeyed":3,"pantry_rekeyed":1,"truncated":false}');`,
    );
  }
  // The identity-audit passes (Normalize › Audits + the Status identity-audit row): three
  // self-terminating convergence jobs plus the normalize job's disjunction sweep, each with a
  // draining worked-per-tick history (the burndown series back-sum these onto the live
  // counts). Per-card burndown states the seed pins: alias + edge cards CONVERGING (one
  // un-audited row each, below), sku + disjunction cards CONVERGED (no sku_cache rows, no
  // disjunctive identity rows), replay backlog 1 (log row 9103 lacks a replayed_at mark).
  const auditRuns = {
    "ingredient-alias-audit": [40, 32, 25, 18, 10, 6].map((audited) => {
      const repointed = Math.round(audited * 0.15);
      const minted = Math.round(audited * 0.05);
      const merged = Math.round(audited * 0.05);
      const kept = audited - repointed - minted - merged;
      return { audited, self_stamped: Math.round(kept * 0.6), kept, repointed, minted, merged, skipped: 0 };
    }),
    "ingredient-edge-audit": [12, 9, 7, 5, 3, 2].map((audited, k) => {
      const self_loops = k < 2 ? 1 : 0;
      const cycles = k === 1 ? 1 : 0;
      const dropped = self_loops + cycles + (k === 3 ? 1 : 0);
      return {
        audited,
        self_loops,
        cycles,
        dropped,
        kept: audited - dropped,
        skipped: 0,
        structural: 1,
        structural_restored: k === 3 ? 1 : 0,
        self_loops_swept: 0,
        replayed: k === 5 ? 1 : 0,
        restored: k === 5 ? 1 : 0,
      };
    }),
    "sku-cache-rekey": [5, 4, 3, 2, 1, 0].map((rekeyed, k) => ({ rekeyed, merged: k < 2 ? 1 : 0, truncated: false })),
    // The disjunction sweep rides the normalize job: its flip+fold counters drain to zero and
    // no disjunctive identity row is seeded (live-concrete count 0), so the fourth pass card
    // renders settled with a burndown trend landing on the green floor.
    "ingredient-normalize": [
      [3, 2],
      [2, 1],
      [1, 1],
      [1, 0],
      [0, 0],
      [0, 0],
    ].map(([disjunctionFlipped, disjunctionFolded], k) => ({
      processed: Math.max(0, 4 - k),
      disjunctionFlipped,
      disjunctionFolded,
      disjunctionEdges: k < 3 ? 1 : 0,
      disjunctionEnqueued: k < 2 ? 2 : 0,
      disjunctionSkipped: 0,
    })),
  };
  for (const [job, runs] of Object.entries(auditRuns)) {
    for (const [k, summary] of runs.entries()) {
      const ranAt = now - 2 * HOUR - (runs.length - 1 - k) * 2 * HOUR;
      stmts.push(
        `INSERT INTO job_runs (id, job, ok, ran_at, duration_ms, summary) VALUES (${q(`viz-run-${job}-${k}`)}, ${q(job)}, 1, ${ranAt}, 600, ${q(JSON.stringify(summary))});`,
      );
    }
  }

  // --- Discovery: a retryable park (non-null next_retry_at → Retry/Delete buttons), a
  // dietary-gated skip, and an import attributed to the connected member.
  stmts.push(`DELETE FROM discovery_log WHERE id IN (${[discovery.errId, discovery.rejId, discovery.importedId].map(q).join(",")});`);
  stmts.push(
    `INSERT INTO discovery_log (id, url, title, source, outcome, slug, detail, created_at, attempts, next_retry_at) VALUES` +
      ` (${q(discovery.errId)}, 'https://example.com/recipe-a', ${q(discovery.errTitle)}, 'demo-feed', 'error', NULL, '{"error":"fetch failed after 3 tries"}', ${q(iso(now - 2 * HOUR))}, 1, ${q(iso(now + 6 * HOUR))}),` +
      ` (${q(discovery.rejId)}, 'https://example.com/recipe-b', ${q(discovery.rejTitle)}, 'demo-feed', 'dietary_gated', NULL, '{"reason":"off-diet (contains shellfish)"}', ${q(iso(now - 3 * HOUR))}, 0, NULL),` +
      ` (${q(discovery.importedId)}, 'https://example.com/recipe-c', ${q(discovery.importedTitle)}, 'demo-feed', 'imported', ${q(recipe.slug)}, '{"member":"${members.active}"}', ${q(iso(now - 26 * HOUR))}, 0, NULL);`,
  );

  // --- Data / Insights: one indexed recipe (D1-only renders as "orphaned" in the Data list —
  // fine, the local R2 corpus is empty by design) + cooks and a favorite for the boards.
  stmts.push(`DELETE FROM recipes WHERE slug = ${q(recipe.slug)};`);
  stmts.push(
    `INSERT INTO recipes (slug, title, protein, cuisine, time_total, source_url, tags, ingredients_key) VALUES` +
      ` (${q(recipe.slug)}, ${q(recipe.title)}, 'fish', 'japanese', 35, ${q(recipe.source)}, '["weeknight"]', '["salmon","rice","miso"]');`,
  );
  stmts.push(`DELETE FROM cooking_log WHERE tenant IN (${q(members.active)}, ${q(members.pending)});`);
  stmts.push(
    `INSERT INTO cooking_log (tenant, date, type, recipe, name) VALUES` +
      ` (${q(members.active)}, ${q(day(now - 1 * DAY))}, 'recipe', ${q(recipe.slug)}, NULL),` +
      ` (${q(members.active)}, ${q(day(now - 3 * DAY))}, 'recipe', ${q(recipe.slug)}, NULL),` +
      ` (${q(members.active)}, ${q(day(now - 5 * DAY))}, 'ad_hoc', NULL, 'Fridge pasta');`,
  );
  stmts.push(`DELETE FROM overlay WHERE tenant = ${q(members.active)};`);
  stmts.push(`INSERT INTO overlay (tenant, recipe, favorite, reject) VALUES (${q(members.active)}, ${q(recipe.slug)}, 1, 0);`);

  // --- Members: activity (joined/last-active) + a little domain data so member-detail sections
  // render populated. (The allowlist + OAuth grant + Kroger link are KV — see kvEntries.)
  stmts.push(`DELETE FROM tenant_activity WHERE tenant IN (${q(members.active)}, ${q(members.pending)});`);
  stmts.push(
    `INSERT INTO tenant_activity (tenant, first_seen_at, last_seen_at) VALUES (${q(members.active)}, ${now - 40 * DAY}, ${now - 2 * HOUR});`,
  );
  stmts.push(`DELETE FROM meal_plan WHERE tenant = ${q(members.active)};`);
  stmts.push(
    `INSERT INTO meal_plan (tenant, recipe, planned_for, sides) VALUES (${q(members.active)}, ${q(recipe.slug)}, ${q(day(now + 2 * DAY))}, '[]');`,
  );
  stmts.push(`DELETE FROM pantry WHERE tenant = ${q(members.active)};`);
  stmts.push(
    `INSERT INTO pantry (tenant, name, normalized_name, quantity, category, added_at) VALUES` +
      ` (${q(members.active)}, 'Jasmine rice', 'jasmine rice', '2 lb', 'grain', ${q(iso(now - 10 * DAY))});`,
  );

  // --- Normalization: an identity graph corner (two concrete nodes + a concept + edges), an
  // alias row, a decision row (carries the Override button), and one queued novel term.
  stmts.push(`DELETE FROM ingredient_identity WHERE id IN ('butter','green-onion','allium','chives');`);
  stmts.push(
    `INSERT INTO ingredient_identity (id, base, detail, concrete, source, decided_at) VALUES` +
      ` ('butter', 'butter', NULL, 1, 'human', ${now - 10 * DAY}),` +
      ` ('green-onion', 'green onion', NULL, 1, 'auto', ${now - 8 * DAY}),` +
      ` ('chives', 'chives', NULL, 1, 'auto', ${now - 8 * DAY}),` +
      ` ('allium', 'allium', NULL, 0, 'auto', ${now - 8 * DAY});`,
  );
  // One un-audited edge (the audit backlog) + one already-stamped edge (audited_at set).
  stmts.push(`DELETE FROM ingredient_edge WHERE from_id IN ('green-onion', 'chives');`);
  stmts.push(
    `INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at, audited_at) VALUES` +
      ` ('green-onion', 'allium', 'membership', 'auto', ${now - 8 * DAY}, NULL),` +
      ` ('chives', 'allium', 'membership', 'auto', ${now - 8 * DAY}, ${now - 2 * HOUR});`,
  );
  stmts.push(
    `DELETE FROM ingredient_alias WHERE variant IN (${q(normalize.decisionTerm)}, ${q(normalize.aliasVariant)}, ${q(normalize.selfEntryVariant)});`,
  );
  // One audited alias + one un-audited alias (the alias half of the audit backlog) + one
  // canonical self-entry (variant === id — the Aliases tab's chip, not a listed row; audited
  // so it stays out of the backlog burndown).
  stmts.push(
    `INSERT INTO ingredient_alias (variant, id, source, confidence, decided_at, audited_at) VALUES` +
      ` (${q(normalize.decisionTerm)}, 'butter', 'auto', 0.97, ${now - 90 * MIN}, ${now - 2 * HOUR}),` +
      ` (${q(normalize.aliasVariant)}, ${q(normalize.canonicalId)}, 'auto', 0.93, ${now - 8 * DAY}, NULL),` +
      ` (${q(normalize.selfEntryVariant)}, ${q(normalize.selfEntryVariant)}, 'auto', 1, ${now - 8 * DAY}, ${now - 2 * HOUR});`,
  );
  stmts.push(`DELETE FROM ingredient_normalization_log WHERE term IN (${q(normalize.decisionTerm)});`);
  stmts.push(
    `INSERT INTO ingredient_normalization_log (term, outcome, resolved_id, candidates, model, created_at) VALUES` +
      ` (${q(normalize.decisionTerm)}, 'same', 'butter', '[{"id":"butter","score":0.97}]', 'bge', ${now - 90 * MIN});`,
  );
  // Edge-decision log rows (Decisions › Edges + the Audits restorations log): a structured
  // keep, a deterministic self-loop drop, a LEGACY drop (edge encoded only in the term — the
  // strict `from -[kind]-> to` parse), and the replay restore that revisits it (replay_of →
  // the drop's fixed id). Fixed high ids so replay_of links deterministically.
  const au = SEED.audit;
  stmts.push(`DELETE FROM ingredient_normalization_log WHERE id IN (9101, 9102, 9103, 9104);`);
  stmts.push(
    `INSERT INTO ingredient_normalization_log (id, term, outcome, resolved_id, candidates, model, detail, created_at) VALUES` +
      ` (9101, '${au.keptEdge.from} -[membership]-> ${au.keptEdge.to}', 'edge_keep', NULL, NULL, 'bge', '${JSON.stringify({ audit: "edge", from: au.keptEdge.from, to: au.keptEdge.to, kind: "membership", direction: "forward", reason: "a green onion is an allium" })}', ${now - 3 * HOUR}),` +
      ` (9102, 'butter -[general]-> butter', 'edge_drop', NULL, NULL, NULL, '${JSON.stringify({ audit: "edge", from: "butter", to: "butter", kind: "general", note: "self_loop", replayed_at: now - 2 * HOUR })}', ${now - 2 * HOUR}),` +
      ` (9103, '${au.droppedEdge.from} -[general]-> ${au.droppedEdge.to}', 'edge_drop', NULL, NULL, 'bge', '${JSON.stringify({ direction: "neither", reason: "distinct alliums — not interchangeable" })}', ${now - 5 * HOUR}),` +
      ` (9104, '${au.droppedEdge.from} -[general]-> ${au.droppedEdge.to}', 'edge_restore', NULL, NULL, 'bge', '${JSON.stringify({ audit: "edge", replay_of: 9103, direction: "forward", reason: "satisfies holds on re-check", from: au.droppedEdge.from, to: au.droppedEdge.to, kind: "general" })}', ${now - 90 * MIN});`,
  );
  // The merge-rejection memory (co-resolution pair under backoff).
  stmts.push(`DELETE FROM ingredient_coresolution_rejection WHERE a = ${q(au.rejection.a)} AND b = ${q(au.rejection.b)};`);
  stmts.push(
    `INSERT INTO ingredient_coresolution_rejection (a, b, decided_at) VALUES (${q(au.rejection.a)}, ${q(au.rejection.b)}, ${now - 3 * DAY});`,
  );
  stmts.push(`DELETE FROM novel_ingredient_terms WHERE term = ${q(normalize.queueTerm)};`);
  stmts.push(
    `INSERT INTO novel_ingredient_terms (term, first_seen, attempts, next_retry_at) VALUES (${q(normalize.queueTerm)}, ${now - 2 * DAY}, 1, ${now + 4 * HOUR});`,
  );

  // --- Status stat tiles: one discovery feed (the RSS-feeds count; the SKU tile counting 0 is
  // fine — a Kroger cache row needs live-API shapes the seed deliberately doesn't fake).
  stmts.push(`INSERT OR REPLACE INTO feeds (url, name, weight, tags) VALUES ('https://example-kitchen.com/feed.xml', 'Example Kitchen', 1.0, '["demo"]');`);

  // --- Config › Ingest Keys: an operator-global key + a tenant-bound key (satellite-pull-channel).
  // Only a dummy hash/prefix is stored (the roster never shows the secret); the binding column
  // renders NULL as "operator-global" and the bound id as a badge.
  const ik = SEED.ingestKeys;
  stmts.push(`DELETE FROM ingest_keys WHERE id IN (${q(ik.global.id)}, ${q(ik.bound.id)});`);
  // The global key reports a build on the current contract (no skew); the bound key never authenticated.
  stmts.push(
    `INSERT INTO ingest_keys (id, label, key_hash, key_prefix, created_at, last_used_at, status, tenant, last_scraper_version, last_contract_version) VALUES` +
      ` (${q(ik.global.id)}, ${q(ik.global.label)}, 'viz-hash-global', ${q(ik.global.prefix)}, ${now - 20 * DAY}, ${now - 3 * HOUR}, 'active', NULL, '1.4.2', 'v2'),` +
      ` (${q(ik.bound.id)}, ${q(ik.bound.label)}, 'viz-hash-bound', ${q(ik.bound.prefix)}, ${now - 5 * DAY}, NULL, 'active', ${q(ik.bound.tenant)}, NULL, NULL);`,
  );

  // --- Discovery › Satellites source-audit (satellite-source-audit): three recipe sources on the
  // operator-global key exercising all three quality states + the drill-down. Recipe pushes give the
  // recency; satellite_source_stats the windowed accept denominator; satellite_rejections the ledger;
  // satellite_quarantine the held flag. All operator-global (tenant NULL) recipe — the SAME key the
  // intake quarantine check uses, so the toggle's flag actually keys to the source's accounting.
  const sat = SEED.satellites;
  const auditDay = Math.floor(now / DAY); // epoch-day bucket = floor(now / 86_400_000)
  const srcs = [sat.clean.source, sat.degrading.source, sat.quarantined.source];
  // Recency: one accepted-bearing push per source (2h/3h buckets → fresh, stable relative labels).
  stmts.push(`DELETE FROM ingest_pushes WHERE id LIKE 'viz-push-%';`);
  stmts.push(
    `INSERT INTO ingest_pushes (id, key_id, source, received, accepted, deduped, rejected, result, created_at) VALUES` +
      ` ('viz-push-clean', ${q(ik.global.id)}, ${q(sat.clean.source)}, 8, 8, 0, 0, 'accepted', ${now - 2 * HOUR}),` +
      ` ('viz-push-degrading', ${q(ik.global.id)}, ${q(sat.degrading.source)}, 12, 9, 1, 2, 'partial', ${now - 2 * HOUR - 5 * MIN}),` +
      ` ('viz-push-quarantined', ${q(ik.global.id)}, ${q(sat.quarantined.source)}, 4, 2, 0, 2, 'partial', ${now - 3 * HOUR});`,
  );
  // Accept-tally (the windowed rate denominator), today's day bucket, operator-global.
  stmts.push(`DELETE FROM satellite_source_stats WHERE kind = 'recipe' AND source IN (${srcs.map(q).join(",")});`);
  stmts.push(
    `INSERT INTO satellite_source_stats (tenant, kind, source, day, accepted, deduped, last_accepted_at) VALUES` +
      ` (NULL, 'recipe', ${q(sat.clean.source)}, ${auditDay}, 50, 3, ${now - 2 * HOUR}),` +
      ` (NULL, 'recipe', ${q(sat.degrading.source)}, ${auditDay}, 30, 2, ${now - 2 * HOUR - 5 * MIN}),` +
      ` (NULL, 'recipe', ${q(sat.quarantined.source)}, ${auditDay}, 3, 0, ${now - 2 * DAY});`,
  );
  // Ledger: the degrading source's five identical worker rejects (aggregate to 5×) + a pre-aggregated
  // local flood (40×), and the quarantined source's pre-quarantine local flood (30×) + the on-arrival
  // quarantine rejects (22×). The clean source has none → the empty drill-down state.
  const degradingUrl = "https://www.bonappetit.com/recipe/miso-glazed-salmon";
  const localSample = "ingredients: [] (expected ≥1) — selector '.ingredient-list li' matched 0";
  stmts.push(`DELETE FROM satellite_rejections WHERE id LIKE 'viz-srej-%';`);
  const rejRows = [];
  for (let k = 0; k < 5; k++) {
    rejRows.push(
      `('viz-srej-deg-w${k}', NULL, ${q(ik.global.id)}, 'recipe', ${q(sat.degrading.source)}, 'worker', 'contract_invalid', ${q(degradingUrl)}, 1, ${now - 3 * HOUR - k * MIN})`,
    );
  }
  rejRows.push(
    `('viz-srej-deg-local', NULL, ${q(ik.global.id)}, 'recipe', ${q(sat.degrading.source)}, 'local', 'contract_invalid', ${q(localSample)}, ${sat.degrading.localCount}, ${now - 35 * MIN})`,
  );
  rejRows.push(
    `('viz-srej-quar-local', NULL, ${q(ik.global.id)}, 'recipe', ${q(sat.quarantined.source)}, 'local', 'contract_invalid', ${q("recipe-card selector returned null on 30 pages")}, 30, ${now - 2 * DAY - 1 * HOUR})`,
  );
  rejRows.push(
    `('viz-srej-quar-worker', NULL, ${q(ik.global.id)}, 'recipe', ${q(sat.quarantined.source)}, 'worker', 'quarantined', ${q("https://www.cooksillustrated.com/recipes/12345-classic-pot-roast")}, 22, ${now - 20 * MIN})`,
  );
  stmts.push(
    `INSERT INTO satellite_rejections (id, tenant, key_id, kind, source, origin, reason, provenance, count, rejected_at) VALUES ${rejRows.join(", ")};`,
  );
  // The held flag on the quarantined source (operator-global recipe).
  stmts.push(`DELETE FROM satellite_quarantine WHERE kind = 'recipe' AND source = ${q(sat.quarantined.source)};`);
  stmts.push(
    `INSERT INTO satellite_quarantine (tenant, kind, source, quarantined_at, note) VALUES (NULL, 'recipe', ${q(sat.quarantined.source)}, ${now - 2 * DAY}, ${q("adapter flooding contract_invalid after a site redesign")});`,
  );

  return stmts;
}

/** KV seeds ([binding, key, value]) applied via `wrangler kv key put --local`: the member
 *  allowlist (pending = allowlist only), the connected member's OAuth grant (active status)
 *  and Kroger link. */
export function kvEntries() {
  const { members } = SEED;
  return [
    ["TENANT_KV", `tenant:${members.active}`, JSON.stringify({ id: members.active })],
    ["TENANT_KV", `tenant:${members.pending}`, JSON.stringify({ id: members.pending })],
    ["OAUTH_KV", `grant:${members.active}:seed-grant`, JSON.stringify({ id: "seed-grant" })],
    ["KROGER_KV", `kroger:refresh:${members.active}`, "seed-refresh-token"],
  ];
}
