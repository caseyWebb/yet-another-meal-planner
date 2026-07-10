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

import { createHash } from "node:crypto";

/** The literals the page objects assert on (one source of truth with the SQL below). */
export const SEED = {
  members: { active: "casey", pending: "pat" },
  // The deterministic invite mapping (member-app-foundations): the code the APP suite's
  // login flow submits, resolving to the active member — one fixture set for both suites.
  invite: "PW-APP-INVITE",
  // A second deterministic invite, resolving to the PENDING member (member-app-offline
  // D9): the app suite's different-tenant login spec needs two real, independently
  // loggable identities to exercise the stamp-mismatch purge for real.
  inviteAlt: "PW-APP-INVITE-2",
  // Group invite codes (self-service-signup): `open` is a live, redeemable code (headroom +
  // provenance) the app signup spec redeems and the admin roster lists; `revoked` is a dead
  // code that renders its "revoked" badge. Both D1-backed (signup_invites), not KV.
  groupCode: { open: "PW-GROUP-OPEN", revoked: "PW-GROUP-REVOKED" },
  // Cross-device MCP approval refs (webauthn-passkey-auth): pending `authz:<ref>` KV records
  // the /connect approval screen reads + approves. Two independent refs so the view
  // (smoke screenshot) and the approve round-trip never disturb each other regardless of
  // test order — the approve test mutates its own ref only.
  connect: {
    clientName: "Claude",
    code: "ABC234",
    viewRef: "pw-app-authz-view",
    approveRef: "pw-app-authz-approve",
  },
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
  // Member-app fixtures (member-app-core): the grocery rows the app's category groups +
  // in-cart flows drive, the EMPTY palette + pending reconciliation proposals (production's
  // observed state: palettes start empty with a proposal backlog), a community note on the
  // seeded recipe, and the profile fields the taste/preferences tabs render.
  app: {
    grocery: {
      active: ["chicken thighs", "scallions", "coconut milk"],
      household: "paper towels",
      inCart: "olive oil",
    },
    proposals: {
      addA: { id: "viz-prop-add-a", vibe: "cozy weeknight noodles" },
      addB: { id: "viz-prop-add-b", vibe: "a bright citrusy salad night" },
      prune: { id: "viz-prop-prune", target: "forgotten-stir-fry" },
      // A dup-scan merge_recipes pair (recipe-dedup): Dismiss-only in the app — the
      // merge itself is chat-guided, so no accept button renders for this kind.
      merge: {
        id: "viz-prop-merge",
        target: "fresh-pasta+homemade-pasta-dough",
        titles: ["Fresh Pasta", "Homemade Pasta Dough"],
        rationale:
          "“Fresh Pasta” and “Homemade Pasta Dough” look like the same dish — description similarity 0.77, sharing eggs and flour. Review and merge?",
      },
    },
    note: { body: "Swapped honey for the brown sugar — better glaze.", tag: "tweak" },
    tasteLead: "Big on bold heat and acid",
    // Brand-tier fixtures (brand-tier model): one ladder of singleton tiers (the
    // migrated-production shape) and one don't-care family, for the Preferred-brands
    // card's tier moves / any-brand toggle / remove-family specs.
    brands: {
      ladder: { term: "butter", tiers: [["Kerrygold"], ["store brand"]] },
      dontCare: { term: "yellow_onion" },
    },
    // The propose flow (member-app-propose D12): the shared seed keeps the PALETTE empty
    // (production's first render — the profile + propose empty states assert it), and
    // pre-plants everything the propose specs' SELF-PROVISIONED palette needs to fill a
    // week with ZERO model calls: night_vibe_derived vectors for these exact vibe ids
    // (the spec creates the night_vibes rows through the real API), recipe_derived
    // embeddings for the whole corpus, and the pre-warmed query-embedding cache entry
    // for the exact freeform phrase the spec types.
    propose: {
      vibes: {
        seafood: { id: "viz-vibe-seafood", vibe: "something from the sea" },
        comfort: { id: "viz-vibe-comfort", vibe: "cozy comfort food" },
      },
      freeform: "more cozy soup",
      soup: { slug: "viz-chicken-soup", title: "Weeknight Chicken Soup" },
      side: { slug: "viz-garlic-bread", title: "Garlic Bread" },
      extraRecipes: ["viz-fish-tacos", "viz-beef-ragu", "viz-spinach-curry", "viz-cacio-pepe"],
    },
    // The derived to-buy view (member-app-grocery D9): the seeded meal_plan row's recipe
    // carries `ingredients_full`, so the grocery page renders REAL virtual rows. `virtual`
    // is a derived-only line (no grocery row); `both` is the seeded active row the plan
    // also needs (canonical-id merge); `covered` is the stale-verified perishable pantry
    // row that cancels a derived need (the verify nudge); `underived` is a recipe the
    // specs plan that has NO ingredients_full (the honesty notice).
    toBuy: {
      planned: "viz-miso-salmon",
      virtual: "salmon",
      both: "scallions",
      covered: "baby spinach",
      underived: "viz-beef-ragu",
    },
    // Differentiator fixtures (member-app-differentiators D11): the trending row's
    // threshold-crossing cook (pat's cook of the seeded recipe makes 3 cooks / 2
    // tenants — deleting the active member's own rows drops it below the guard for
    // the empty-state test), the picked-for-you expectation (nearest embedded
    // neighbor of the favorited recipe's vector), the pre-resolved Kroger locationId
    // that IS the seeded profile's default `preferred_location` (a bare id, whitespace-
    // free → the client short-circuit, zero Kroger network on every enriched grocery
    // read — the app suite's default state, not something a spec PATCHes in), the
    // aisle-tagged sku_cache rows, and the production-shaped sibling edge family (edges
    // born-audited so the edge-audit backlog the admin suite pins stays at 1).
    differentiators: {
      topPick: "viz-fish-tacos",
      location: "03500520",
      aisles: {
        meat: { ingredient: "chicken thighs", number: "11", description: "Meat & Seafood" },
        produce: { ingredient: "green-onion", number: "3", description: "Produce" },
      },
      siblings: {
        line: "cabbage::type-napa",
        family: ["cabbage::color-green", "cabbage::color-red"],
        parent: "cabbage",
        // inline-substitution-hints D1-D3/D8: a pantry row for one sibling (the
        // enriched to-buy read's `in_pantry` hint) and a warmed flyer rollup matching
        // the family's shared base term (the `on_sale_hint` hint) — both live, not
        // intercepted, in the app suite's inline-hint spec.
        pantryHit: "cabbage::color-red",
        saleHit: { sku: "0009999012345", price: { regular: 2.5, promo: 2 } },
        // reify-ingredient-display-names: a curated `display_name` per CONCRETE family
        // node, distinct from the raw canonical id — so `labelOf` renders these clean
        // labels ("Red cabbage", not "cabbage::color-red") on the inline hint, and an
        // accepted swap materializes a grocery row carrying the clean label. The PARENT
        // ("cabbage") deliberately gets none: its `via_label` then falls back to the base
        // synthesis ("cabbage"), which the inline-hint relation assertion pins.
        displayNames: {
          "cabbage::type-napa": "Napa cabbage",
          "cabbage::color-green": "Green cabbage",
          "cabbage::color-red": "Red cabbage",
        },
      },
    },
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

// --- synthetic embeddings (member-app-propose D12) -------------------------------
// Deterministic EMBED_DIM one-hot-ish vectors: equal dimension, distinct directions, so
// cosine ordering across the seeded corpus/vibes/freeform phrase is stable and the
// propose flow computes entirely from these — zero Workers AI calls in the harness.
/** Must match src/embedding.ts EMBED_DIM/EMBED_MODEL (the cache validates both). */
const EMBED_DIM = 768;
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
/** JSON vector with weight w at each given index ([[i, w], …]), zeros elsewhere. */
function embedVec(on) {
  const v = new Array(EMBED_DIM).fill(0);
  for (const [i, w] of on) v[i] = w;
  return JSON.stringify(v);
}
/** The query-embedding cache key for a phrase — sha256(model + "\n" + normalized),
 *  mirroring src/embedding.ts embedCacheKey (keep in lockstep). */
function embedCacheKey(text) {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  const hex = createHash("sha256").update(`${EMBED_MODEL}\n${normalized}`).digest("hex");
  return `embed:${hex}`;
}

/** The D1 seed statements for `wrangler d1 execute --command` (now = the run's epoch ms). */
export function d1Statements(now) {
  const iso = (ms) => new Date(ms).toISOString();
  const day = (ms) => iso(ms).slice(0, 10);
  const { members, recipe, discovery, normalize, jobs, groupCode } = SEED;
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
  // The propose corpus (member-app-propose D12): the seeded recipe plus a small varied
  // set (distinct proteins/cuisines/times) so slot pools, alternates, facet pins, and the
  // swap menu all have material. Perishables line up with the at-risk pantry row below
  // (baby spinach) so uses_perishables/waste flags render. `viz-garlic-bread` is a corpus
  // SIDE (pairs_with target, deliberately unembedded — sides need no vector).
  // The last element is `ingredients_full` (member-app-grocery): derived for the planned
  // miso-salmon (the to-buy view's virtual rows) and the soup; NULL elsewhere so a spec
  // that plans viz-beef-ragu exercises the honest `underived` report.
  const proposeRecipes = [
    [recipe.slug, recipe.title, "fish", "japanese", 35, recipe.source, '["weeknight"]', '["salmon","rice","miso"]', null, null, '["salmon","rice","miso","scallions","baby spinach"]'],
    ["viz-chicken-soup", "Weeknight Chicken Soup", "chicken", "american", 40, null, '["cozy"]', '["chicken","stock"]', '["baby spinach"]', '["viz-garlic-bread"]', '["chicken","stock","carrots","baby spinach"]'],
    ["viz-fish-tacos", "Charred Fish Tacos", "fish", "mexican", 25, null, '["weeknight"]', '["white fish","tortillas"]', null, null, null],
    ["viz-beef-ragu", "Sunday Beef Ragu", "beef", "italian", 90, null, '["project"]', '["beef","tomato"]', null, null, null],
    ["viz-spinach-curry", "Spinach Coconut Curry", "vegetarian", "indian", 45, null, '["cozy"]', '["coconut milk","chickpeas"]', '["baby spinach"]', null, null],
    ["viz-cacio-pepe", "Cacio e Pepe", null, "italian", 30, null, '["fast"]', '["pasta","pecorino"]', null, null, null],
    ["viz-garlic-bread", "Garlic Bread", null, "italian", 15, null, '["side"]', '["bread","butter"]', null, null, null],
  ];
  stmts.push(`DELETE FROM recipes WHERE slug IN (${proposeRecipes.map((r) => q(r[0])).join(", ")});`);
  stmts.push(
    "INSERT INTO recipes (slug, title, protein, cuisine, time_total, source_url, tags, ingredients_key, perishable_ingredients, pairs_with, course, ingredients_full) VALUES " +
      proposeRecipes
        .map(
          ([slug, title, protein, cuisine, time, source, tags, keys, perishable, pairs, full]) =>
            `(${q(slug)}, ${q(title)}, ${protein ? q(protein) : "NULL"}, ${q(cuisine)}, ${time}, ${source ? q(source) : "NULL"}, ${q(tags)}, ${q(keys)}, ${perishable ? q(perishable) : "NULL"}, ${pairs ? q(pairs) : "NULL"}, ${slug === "viz-garlic-bread" ? q('["side"]') : "NULL"}, ${full ? q(full) : "NULL"})`,
        )
        .join(", ") +
      ";",
  );
  // The classify-time snapshot rows for the derived recipes (recipe_facets mirrors what a
  // real classify pass would have stored; the projected `recipes` value above is what the
  // Worker reads — the sibling row keeps the harness's data model honest).
  const facetRows = proposeRecipes.filter((r) => r[10]);
  stmts.push(`DELETE FROM recipe_facets WHERE slug IN (${facetRows.map((r) => q(r[0])).join(", ")});`);
  stmts.push(
    "INSERT INTO recipe_facets (slug, body_hash, ingredients_key, ingredients_full) VALUES " +
      facetRows.map((r) => `(${q(r[0])}, 'viz-seeded', ${q(r[7])}, ${q(r[10])})`).join(", ") +
      ";",
  );
  stmts.push(`DELETE FROM cooking_log WHERE tenant IN (${q(members.active)}, ${q(members.pending)});`);
  stmts.push(
    `INSERT INTO cooking_log (tenant, date, type, recipe, name) VALUES` +
      ` (${q(members.active)}, ${q(day(now - 1 * DAY))}, 'recipe', ${q(recipe.slug)}, NULL),` +
      ` (${q(members.active)}, ${q(day(now - 3 * DAY))}, 'recipe', ${q(recipe.slug)}, NULL),` +
      // The pending member's cook (member-app-differentiators D11): the seeded recipe
      // crosses the trending min-signal guard GROUP-WIDE (3 cooks, 2 distinct tenants),
      // and stays below it (1 cook, 1 tenant) once the active member deletes their own
      // rows — the browse spec's empty-state provisioning.
      ` (${q(members.pending)}, ${q(day(now - 2 * DAY))}, 'recipe', ${q(recipe.slug)}, NULL),` +
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
    `INSERT INTO pantry (tenant, name, normalized_name, quantity, category, added_at, last_verified_at) VALUES` +
      ` (${q(members.active)}, 'Jasmine rice', 'jasmine rice', '2 lb', 'grain', ${q(day(now - 10 * DAY))}, ${q(day(now - 10 * DAY))}),` +
      // A perishable past the 7-day staleness threshold — the app pantry page's
      // needs-verification section (member-app-core) renders + clears from this row.
      ` (${q(members.active)}, 'Baby spinach', 'baby spinach', '1 bag', 'produce', ${q(day(now - 10 * DAY))}, ${q(day(now - 10 * DAY))});`,
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

  // --- Member app (member-app-core): grocery rows, the EMPTY palette + pending
  // proposals, a community recipe note, the derived description, and the profile row
  // the taste/preferences tabs render. All additive — the admin suite reads none of it.
  const app = SEED.app;
  stmts.push(`DELETE FROM grocery_list WHERE tenant = ${q(members.active)};`);
  // `normalized_name` is the canonical id the funnel resolves the name to — for an ALIASED name
  // (scallions → green-onion) that is the alias target, NOT `name.toLowerCase()`, exactly as
  // production's write funnel stores it. Pass `key` to pin it; default to the lowercased name.
  const g = (name, kind, status, source, extra = {}) =>
    `(${q(members.active)}, ${q(name)}, ${q(extra.key ?? name.toLowerCase())}, ${q(extra.quantity ?? "1")}, ${q(kind)}, 'grocery', ${q(status)}, ${q(source)}, ${q(JSON.stringify(extra.for_recipes ?? []))}, ${extra.note ? q(extra.note) : "NULL"}, ${q(day(now - 2 * DAY))}, NULL)`;
  stmts.push(
    "INSERT INTO grocery_list (tenant, name, normalized_name, quantity, kind, domain, status, source, for_recipes, note, added_at, ordered_at) VALUES " +
      [
        g(app.grocery.active[0], "grocery", "active", "menu", { quantity: "2 lb", for_recipes: [recipe.slug] }),
        g(app.grocery.active[1], "grocery", "active", "ad_hoc", { note: "the thin ones", key: SEED.normalize.canonicalId }),
        g(app.grocery.active[2], "grocery", "active", "pantry_low"),
        g(app.grocery.household, "household", "active", "ad_hoc"),
        g(app.grocery.inCart, "grocery", "in_cart", "stockup"),
      ].join(", ") +
      ";",
  );
  // The palette starts EMPTY (production's observed first render) with a pending backlog.
  stmts.push(`DELETE FROM night_vibes WHERE tenant = ${q(members.active)};`);
  stmts.push(`DELETE FROM pending_proposals WHERE tenant = ${q(members.active)};`);
  const prop = app.proposals;
  stmts.push(
    "INSERT INTO pending_proposals (id, tenant, kind, target, payload, rationale, evidence, status, producer, created_at) VALUES " +
      `(${q(prop.addA.id)}, ${q(members.active)}, 'add_vibe', 'cozy-noodles', ${q(JSON.stringify({ id: "cozy-noodles", vibe: prop.addA.vibe, cadence_days: 10 }))}, 'You keep cooking dishes like this — set a night aside for it?', '{}', 'pending', 'edge', ${q(iso(now - 3 * DAY))}), ` +
      `(${q(prop.addB.id)}, ${q(members.active)}, 'add_vibe', 'citrus-salad', ${q(JSON.stringify({ id: "citrus-salad", vibe: prop.addB.vibe, cadence_days: 14 }))}, 'Three bright salads in two weeks — make it a rotation slot?', '{}', 'pending', 'edge', ${q(iso(now - 2 * DAY))}), ` +
      `(${q(prop.prune.id)}, ${q(members.active)}, 'prune_vibe', ${q(prop.prune.target)}, ${q(JSON.stringify({ id: prop.prune.target }))}, 'Added months ago and never cooked from — retire it?', '{}', 'pending', 'edge', ${q(iso(now - 1 * DAY))}), ` +
      `(${q(prop.merge.id)}, ${q(members.active)}, 'merge_recipes', ${q(prop.merge.target)}, ${q(JSON.stringify({ slugs: prop.merge.target.split("+"), titles: prop.merge.titles, cosine: 0.767, shared_ingredients: ["eggs", "flour"], jaccard: 0.67, detector: "corroborated" }))}, ${q(prop.merge.rationale)}, '{}', 'pending', 'dup-scan', ${q(iso(now - 0.5 * DAY))});`,
  );
  // A shared community note from the pending member (the detail page's group half).
  stmts.push(`DELETE FROM recipe_notes WHERE recipe = ${q(recipe.slug)};`);
  stmts.push(
    "INSERT INTO recipe_notes (id, recipe, author, body, tags, private, created_at) VALUES " +
      `(${q(`${members.pending} ${recipe.slug} viz-note`)}, ${q(recipe.slug)}, ${q(members.pending)}, ${q(app.note.body)}, ${q(JSON.stringify([app.note.tag]))}, 0, ${q(iso(now - 4 * DAY))});`,
  );
  // The derived layer (recipe_derived): the description the detail page renders, plus
  // SYNTHETIC deterministic embeddings (equal dimension, distinct directions — cosine
  // ordering is stable and assertable) so the propose flow fills slots with zero model
  // calls (member-app-propose D12). The garlic-bread side stays unembedded on purpose.
  const derived = [
    [recipe.slug, "Miso-lacquered salmon over rice with quick-pickled cucumber.", embedVec([[0, 1]])],
    ["viz-chicken-soup", "A bright weeknight chicken soup with greens.", embedVec([[2, 1]])],
    ["viz-fish-tacos", "Charred white fish in warm tortillas.", embedVec([[1, 1], [0, 0.2]])],
    ["viz-beef-ragu", "A long-simmered Sunday ragu.", embedVec([[3, 1], [2, 0.2]])],
    ["viz-spinach-curry", "Coconut-braised chickpeas and spinach.", embedVec([[4, 1]])],
    ["viz-cacio-pepe", "Pasta, pecorino, black pepper — fifteen minutes.", embedVec([[5, 1], [2, 0.3]])],
    ["viz-garlic-bread", "Buttered, toasted, essential.", null],
  ];
  stmts.push(`DELETE FROM recipe_derived WHERE slug IN (${derived.map((r) => q(r[0])).join(", ")});`);
  stmts.push(
    "INSERT INTO recipe_derived (slug, description, embedding) VALUES " +
      derived.map(([slug, desc, vec]) => `(${q(slug)}, ${q(desc)}, ${vec ? q(vec) : "NULL"})`).join(", ") +
      ";",
  );
  // Cron-shaped vibe vectors for the propose specs' self-provisioned palette: derived
  // rows for vibe ids that do NOT yet exist in night_vibes (invisible to every other
  // surface — the palette stays empty until the spec creates the vibes via the API).
  const pv = app.propose.vibes;
  stmts.push(`DELETE FROM night_vibe_derived WHERE tenant = ${q(members.active)};`);
  stmts.push(
    "INSERT INTO night_vibe_derived (tenant, id, embedding) VALUES " +
      `(${q(members.active)}, ${q(pv.seafood.id)}, ${q(embedVec([[0, 0.8], [1, 0.6]]))}), ` +
      `(${q(members.active)}, ${q(pv.comfort.id)}, ${q(embedVec([[2, 0.8], [3, 0.4], [5, 0.4]]))});`,
  );
  // The profile row + one ranked brand (taste markdown, planning knobs, stores, dietary).
  stmts.push(`DELETE FROM profile WHERE tenant = ${q(members.active)};`);
  stmts.push(
    "INSERT INTO profile (tenant, taste, diet_principles, default_cooking_nights, lunch_strategy, ready_to_eat_default_action, stores, dietary, rotation) VALUES " +
      `(${q(members.active)}, ${q(`**${app.tasteLead}** — weeknights lean Asian, weekends get a project.`)}, ${q("- Keep shellfish off the table\n- Go easy on red meat")}, 3, NULL, 'opt-in', ${q(JSON.stringify({ primary: "kroger", preferred_location: app.differentiators.location }))}, ${q(JSON.stringify({ avoid: ["shellfish"], limit: ["red meat"] }))}, ${q(JSON.stringify({ resurface_after_days: 30, novelty_boost: 0.2 }))});`,
  );
  stmts.push(`DELETE FROM brand_prefs WHERE tenant = ${q(members.active)};`);
  stmts.push(
    `INSERT INTO brand_prefs (tenant, term, tiers, any_brand) VALUES ` +
      `(${q(members.active)}, ${q(app.brands.ladder.term)}, ${q(JSON.stringify(app.brands.ladder.tiers))}, 0), ` +
      `(${q(members.active)}, ${q(app.brands.dontCare.term)}, '[]', 1);`,
  );

  // --- Differentiators (member-app-differentiators D11) ---------------------------
  const diff = app.differentiators;
  // Aisle-tagged sku_cache rows at the pre-resolved location the aisle spec PATCHes
  // into preferences: two seeded to-buy lines gain captured placements ("chicken
  // thighs" by its own key; the scallions row keys under the green-onion alias), the
  // rest stay honest "Aisle unknown". Keys are canonical fixpoints, so the sku-cache
  // re-key burndown the admin suite pins stays converged (plan empty).
  stmts.push(`DELETE FROM sku_cache WHERE location_id = ${q(diff.location)};`);
  stmts.push(
    "INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used, aisle_number, aisle_description, aisle_side, aisle_captured_at) VALUES " +
      `(${q(diff.aisles.meat.ingredient)}, ${q(diff.location)}, '0001111091234', 'Kroger', '1.5 lb', ${q(day(now - 4 * DAY))}, ${q(diff.aisles.meat.number)}, ${q(diff.aisles.meat.description)}, 'L', ${q(day(now - 4 * DAY))}), ` +
      `(${q(diff.aisles.produce.ingredient)}, ${q(diff.location)}, '0001111046025', 'Kroger', '1 bunch', ${q(day(now - 4 * DAY))}, ${q(diff.aisles.produce.number)}, ${q(diff.aisles.produce.description)}, NULL, ${q(day(now - 4 * DAY))});`,
  );
  // The production-shaped sibling edge family (the spike's cabbage fixture): three
  // concrete specializations satisfying the concrete base, kind `general`. Edges are
  // BORN-AUDITED (audited_at set) so the edge-audit backlog stays exactly 1.
  const fam = [diff.siblings.line, ...diff.siblings.family];
  const dn = diff.siblings.displayNames;
  stmts.push(`DELETE FROM ingredient_edge WHERE to_id = ${q(diff.siblings.parent)};`);
  stmts.push(`DELETE FROM ingredient_identity WHERE id IN (${[diff.siblings.parent, ...fam].map(q).join(", ")});`);
  // reify-ingredient-display-names: concrete family nodes carry a curated `display_name`
  // (so `labelOf` yields "Red cabbage", not "cabbage::color-red"); the parent stays NULL.
  stmts.push(
    "INSERT INTO ingredient_identity (id, base, detail, display_name, concrete, source, decided_at) VALUES " +
      `(${q(diff.siblings.parent)}, ${q(diff.siblings.parent)}, NULL, NULL, 1, 'auto', ${now - 9 * DAY}), ` +
      fam
        .map(
          (id) =>
            `(${q(id)}, ${q(id.slice(0, id.indexOf("::")))}, ${q(id.slice(id.indexOf("::") + 2))}, ${q(dn[id])}, 1, 'auto', ${now - 9 * DAY})`,
        )
        .join(", ") +
      ";",
  );
  stmts.push(
    "INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at, audited_at) VALUES " +
      fam.map((id) => `(${q(id)}, ${q(diff.siblings.parent)}, 'general', 'auto', ${now - 9 * DAY}, ${now - 9 * DAY})`).join(", ") +
      ";",
  );
  // The family's LINE as a real to-buy row (inline-substitution-hints D1-D3): the
  // enriched read's substitutes[] walks from a live grocery_list row, not a mock.
  stmts.push(`DELETE FROM grocery_list WHERE tenant = ${q(members.active)} AND normalized_name = ${q(diff.siblings.line)};`);
  stmts.push(
    "INSERT INTO grocery_list (tenant, name, normalized_name, quantity, kind, domain, status, source, for_recipes, note, added_at, ordered_at) VALUES " +
      `(${q(members.active)}, ${q(diff.siblings.line)}, ${q(diff.siblings.line)}, '1', 'grocery', 'grocery', 'active', 'ad_hoc', '[]', NULL, ${q(day(now - 2 * DAY))}, NULL);`,
  );
  // The pantry hint (D1/D3): a pantry row for one sibling lights up its `in_pantry` flag.
  stmts.push(`DELETE FROM pantry WHERE tenant = ${q(members.active)} AND normalized_name = ${q(diff.siblings.pantryHit)};`);
  stmts.push(
    `INSERT INTO pantry (tenant, name, normalized_name, quantity, category, added_at, last_verified_at) VALUES (${q(members.active)}, 'Red cabbage', ${q(diff.siblings.pantryHit)}, '1 head', 'produce', ${q(day(now - 3 * DAY))}, ${q(day(now - 3 * DAY))});`,
  );

  // Group invite codes (self-service-signup): an OPEN code with headroom (10 cap, 2 used) and
  // two provenance rows, plus a REVOKED code. The app signup spec redeems `open` (unique
  // usernames, so its used count only climbs and never collides); the admin roster lists both.
  stmts.push(`DELETE FROM signup_invites WHERE code IN (${q(groupCode.open)}, ${q(groupCode.revoked)});`);
  stmts.push(
    "INSERT INTO signup_invites (code, max_redemptions, used, expires_at, revoked_at, label, created_at) VALUES " +
      `(${q(groupCode.open)}, 10, 2, NULL, NULL, 'summer camp crew', ${now - 3 * DAY}), ` +
      `(${q(groupCode.revoked)}, 5, 5, NULL, ${now - 1 * DAY}, 'closed beta', ${now - 20 * DAY});`,
  );
  stmts.push(`DELETE FROM signup_redemptions WHERE code = ${q(groupCode.open)};`);
  stmts.push(
    "INSERT INTO signup_redemptions (code, tenant, created_at) VALUES " +
      `(${q(groupCode.open)}, 'riley', ${now - 2 * DAY}), (${q(groupCode.open)}, 'sky', ${now - 1 * DAY});`,
  );

  return stmts;
}

/** KV seeds ([binding, key, value]) applied via `wrangler kv key put --local`: the member
 *  allowlist (pending = allowlist only), the connected member's OAuth grant (active status),
 *  their Kroger link, and the invite code the app suite's login flow submits. */
export function kvEntries() {
  const { members } = SEED;
  return [
    ["TENANT_KV", `tenant:${members.active}`, JSON.stringify({ id: members.active })],
    ["TENANT_KV", `tenant:${members.pending}`, JSON.stringify({ id: members.pending })],
    ["TENANT_KV", `invite:${SEED.invite}`, members.active],
    ["TENANT_KV", `invite:${SEED.inviteAlt}`, members.pending],
    // Two pending cross-device approval refs (webauthn-passkey-auth): the connect screen's
    // viewApproval reads clientName/code/status; `oauth` is any non-empty string (the
    // /authorize completion path isn't exercised in the app suite). Independent refs so
    // the approve round-trip never flips the view fixture to "approved".
    [
      "TENANT_KV",
      `authz:${SEED.connect.viewRef}`,
      JSON.stringify({ oauth: "cGVuZGluZw", clientName: SEED.connect.clientName, code: SEED.connect.code, status: "pending" }),
    ],
    [
      "TENANT_KV",
      `authz:${SEED.connect.approveRef}`,
      JSON.stringify({ oauth: "cGVuZGluZw", clientName: SEED.connect.clientName, code: SEED.connect.code, status: "pending" }),
    ],
    ["OAUTH_KV", `grant:${members.active}:seed-grant`, JSON.stringify({ id: "seed-grant" })],
    ["KROGER_KV", `kroger:refresh:${members.active}`, "seed-refresh-token"],
    // The pre-warmed query-embedding cache entry (member-app-propose D12): the exact
    // freeform phrase the propose spec types, pointed at the chicken-soup axis — so the
    // freeform path runs as a deterministic cache HIT (no Workers AI in the harness).
    ["KROGER_KV", embedCacheKey(SEED.app.propose.freeform), embedVec([[2, 1]])],
    // The warmed flyer rollup (inline-substitution-hints D1/D3/D8): a sale item whose
    // `matched_terms` carries the cabbage family's shared base term, so the enriched
    // to-buy read's `on_sale_hint` lights up for the family's siblings off the seeded
    // default `preferred_location` (the same pre-resolved bare id, no whitespace → no
    // live Kroger Locations call needed to reach it).
    [
      "KROGER_KV",
      `flyer:kroger:${SEED.app.differentiators.location}`,
      JSON.stringify({
        sweep_id: "viz-sweep-1",
        as_of: Date.now(),
        store: "kroger",
        location_id: SEED.app.differentiators.location,
        items: [
          {
            sku: SEED.app.differentiators.siblings.saleHit.sku,
            brand: "Kroger",
            description: "Green Cabbage",
            size: "1 head",
            price: SEED.app.differentiators.siblings.saleHit.price,
            savings: SEED.app.differentiators.siblings.saleHit.price.regular - SEED.app.differentiators.siblings.saleHit.price.promo,
            categories: [],
            matched_terms: [SEED.app.differentiators.siblings.parent],
          },
        ],
      }),
    ],
  ];
}
