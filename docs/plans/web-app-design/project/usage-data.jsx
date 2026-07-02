/* Usage dataset for the grocery-agent admin. Three observability surfaces, as in
   the real Usage area: account resource usage against Cloudflare's daily free
   tier (KV ops + Workers AI neurons), per-job run trends over 30 days, and
   per-tool MCP call/error/latency. Tenant-clean aggregates only. Illustrative.

   KV operations are split across the three bound namespaces (KROGER_KV tokens +
   flyer cache, OAUTH_KV provider storage, TENANT_KV directory + invites) so the
   meter bar and its sparkline stack into per-store segments. */
(function () {
  window.GA = window.GA || {};

  // Deterministic-ish 30-day series around a daily mean (oldest → newest); the
  // final point is pinned to today's actual value.
  function series(mean, spread, seed, last) {
    const a = [];
    let s = seed;
    for (let i = 0; i < 30; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const r = (s / 0x7fffffff - 0.5) * 2; // -1..1
      a.push(Math.max(0, Math.round(mean + r * spread)));
    }
    if (last != null) a[29] = last;
    return a;
  }

  // The three KV namespaces, in stack order (bottom → top), each a warm accent tone.
  const KV_NS = [
    { id: "KROGER_KV", note: "tokens · flyer cache", color: "var(--kv-kroger)" },
    { id: "OAUTH_KV", note: "oauth grants · tokens", color: "var(--kv-oauth)" },
    { id: "TENANT_KV", note: "directory · invites", color: "var(--kv-tenant)" },
  ];

  // Today's per-namespace usage for each KV operation (sums = the op total).
  const KV_TODAY = {
    read: { KROGER_KV: 9000, OAUTH_KV: 7500, TENANT_KV: 1920 },
    write: { KROGER_KV: 380, OAUTH_KV: 210, TENANT_KV: 22 },
    delete: { KROGER_KV: 14, OAUTH_KV: 30, TENANT_KV: 3 },
    list: { KROGER_KV: 40, OAUTH_KV: 13, TENANT_KV: 180 },
  };
  const KV_LIMITS = { read: 100000, write: 1000, delete: 1000, list: 1000 };
  const OPS = ["read", "write", "delete", "list"];
  const SEED = { read: 70, write: 80, delete: 90, list: 100 };

  const ops = {};
  const totals = {};
  OPS.forEach((op) => {
    const byNs = KV_TODAY[op];
    const history = {};
    KV_NS.forEach((ns, idx) => {
      const today = byNs[ns.id];
      history[ns.id] = series(today, Math.max(2, today * 0.22), SEED[op] + idx, today);
    });
    ops[op] = { limit: KV_LIMITS[op], byNs, history };
    totals[op] = KV_NS.reduce((n, ns) => n + byNs[ns.id], 0);
  });

  const jobs = [
    { job: "recipe-index", runs: series(96, 10, 7), avgMs: 210 },
    { job: "flyer-warm", runs: series(96, 8, 11), avgMs: 324 },
    { job: "recipe-classify", runs: series(48, 9, 23), avgMs: 1840 },
    { job: "recipe-embed", runs: series(48, 7, 31), avgMs: 1455 },
    { job: "discovery-sweep", runs: series(24, 11, 41), avgMs: 2210 },
    { job: "email", runs: series(6, 4, 53), avgMs: 540 },
  ].map((j) => ({ ...j, total: j.runs.reduce((n, x) => n + x, 0) }));

  const tools = [
    { tool: "search_recipes", calls: 1840, errors: 3, p50: 120, p95: 410 },
    { tool: "get_recipe", calls: 1520, errors: 2, p50: 90, p95: 260 },
    { tool: "get_meal_plan", calls: 1210, errors: 0, p50: 60, p95: 180 },
    { tool: "match_ingredient_to_kroger_sku", calls: 980, errors: 22, p50: 340, p95: 1200 },
    { tool: "add_to_grocery_list", calls: 760, errors: 1, p50: 80, p95: 240 },
    { tool: "get_pantry", calls: 540, errors: 0, p50: 45, p95: 130 },
    { tool: "place_order", calls: 210, errors: 4, p50: 880, p95: 2400 },
    { tool: "log_cooking", calls: 180, errors: 0, p50: 70, p95: 190 },
  ];

  window.GA.usage = {
    day: "Jun 30",
    windowDays: 30,
    kv: { namespaces: KV_NS, limits: KV_LIMITS, totals, ops },
    ai: {
      neuronsUsed: 6800,
      neuronsLimit: 10000,
      history: series(6300, 3100, 61, 6800),
      byModel: [
        { model: "@cf/meta/llama-3.1-8b-instruct", neurons: 4700 },
        { model: "@cf/baai/bge-base-en-v1.5", neurons: 2100 },
      ],
    },
    jobs,
    tools,
  };
})();
