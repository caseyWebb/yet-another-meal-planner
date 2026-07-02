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
  },
  // Mirrors src/health.ts HEALTH_JOBS (every registered job gets health + run history so no
  // Status row renders never-run).
  jobs: [
    "flyer-warm",
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
      const summary = ok ? '{"processed":3}' : '{"error":"upstream timeout"}';
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
  stmts.push(`DELETE FROM ingredient_identity WHERE id IN ('butter','green-onion','allium');`);
  stmts.push(
    `INSERT INTO ingredient_identity (id, base, detail, concrete, source, decided_at) VALUES` +
      ` ('butter', 'butter', NULL, 1, 'human', ${now - 10 * DAY}),` +
      ` ('green-onion', 'green onion', NULL, 1, 'auto', ${now - 8 * DAY}),` +
      ` ('allium', 'allium', NULL, 0, 'auto', ${now - 8 * DAY});`,
  );
  stmts.push(`DELETE FROM ingredient_edge WHERE from_id = 'green-onion';`);
  stmts.push(
    `INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES ('green-onion', 'allium', 'membership', 'auto', ${now - 8 * DAY});`,
  );
  stmts.push(
    `DELETE FROM ingredient_alias WHERE variant IN (${q(normalize.decisionTerm)}, ${q(normalize.aliasVariant)});`,
  );
  stmts.push(
    `INSERT INTO ingredient_alias (variant, id, source, confidence, decided_at) VALUES` +
      ` (${q(normalize.decisionTerm)}, 'butter', 'auto', 0.97, ${now - 90 * MIN}),` +
      ` (${q(normalize.aliasVariant)}, ${q(normalize.canonicalId)}, 'auto', 0.93, ${now - 8 * DAY});`,
  );
  stmts.push(`DELETE FROM ingredient_normalization_log WHERE term IN (${q(normalize.decisionTerm)});`);
  stmts.push(
    `INSERT INTO ingredient_normalization_log (term, outcome, resolved_id, candidates, model, created_at) VALUES` +
      ` (${q(normalize.decisionTerm)}, 'same', 'butter', '[{"id":"butter","score":0.97}]', 'bge', ${now - 90 * MIN});`,
  );
  stmts.push(`DELETE FROM novel_ingredient_terms WHERE term = ${q(normalize.queueTerm)};`);
  stmts.push(
    `INSERT INTO novel_ingredient_terms (term, first_seen, attempts, next_retry_at) VALUES (${q(normalize.queueTerm)}, ${now - 2 * DAY}, 1, ${now + 4 * HOUR});`,
  );

  // --- Status stat tiles: one discovery feed (the RSS-feeds count; the SKU tile counting 0 is
  // fine — a Kroger cache row needs live-API shapes the seed deliberately doesn't fake).
  stmts.push(`INSERT OR REPLACE INTO feeds (url, name, weight, tags) VALUES ('https://example-kitchen.com/feed.xml', 'Example Kitchen', 1.0, '["demo"]');`);

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
