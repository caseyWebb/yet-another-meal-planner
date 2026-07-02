/* Ingest dataset for the grocery-agent admin — the walled-source ingest feature.
   A SCRAPER is one machine on the operator's home network. It holds exactly ONE
   ingest API key and may be configured with MANY sources — it logs in to each
   paid recipe site (NYT Cooking, Bon Appétit, Serious Eats, …), extracts recipes,
   and POSTs them in batches to the Worker's /admin/api/ingest endpoint. Accepted
   batches are deduped on arrival and handed to the existing background discovery
   sweep. The scraper + contract version are a property of the MACHINE (one
   binary), so version skew is per-scraper, not per-source.

   Single source of truth read by BOTH the Config › Ingest Keys editor (the key
   roster + mint/revoke) and Discovery › Scrapers (liveness hero, throughput
   funnel, recent pushes) plus the Status page's scraper section. Health uses the
   /health posture vocabulary: fresh · stale · never. Values are illustrative. */
(function () {
  window.GA = window.GA || {};
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  const now = Date.now();

  // The Worker's current recipe-contract version. A scraper reporting an older
  // contract is flagged with a skew chip on its liveness card.
  const CONTRACT_VERSION = "v4";

  // A scraper is "fresh" if its most recent push is within this window;
  // overdue → "stale"; no push ever → "never".
  const FRESH_WINDOW = 6 * HR;
  function healthFor(lastPush) {
    if (lastPush == null) return "never";
    return now - lastPush <= FRESH_WINDOW ? "fresh" : "stale";
  }

  // ── Scrapers (machines) ────────────────────────────────────────────────────
  // Each has ONE key (id/prefix — the secret is shown once at mint, never stored)
  // and a list of configured sources. `status`: active | revoked.
  const rawScrapers = [
    {
      id: "ik_9f2a", label: "home-nas-scraper", prefix: "ing_live_9f2a", created: now - 34 * DAY,
      status: "active", scraperVersion: "1.4.2", contractVersion: "v4",
      sources: [
        { name: "NYT Cooking", lastPush: now - 12 * MIN, pushes24h: 22, pushes7d: 128 },
        { name: "Serious Eats", lastPush: now - 3 * HR - 8 * MIN, pushes24h: 12, pushes7d: 84 },
      ],
    },
    {
      id: "ik_4c71", label: "basement-pi", prefix: "ing_live_4c71", created: now - 21 * DAY,
      status: "active", scraperVersion: "1.4.2", contractVersion: "v4",
      sources: [
        { name: "Bon Appétit", lastPush: now - 40 * MIN, pushes24h: 9, pushes7d: 61 },
      ],
    },
    {
      id: "ik_b8e3", label: "old-synology", prefix: "ing_live_b8e3", created: now - 12 * DAY,
      status: "active", scraperVersion: "1.3.0", contractVersion: "v3", // behind — skew
      sources: [
        { name: "America's Test Kitchen", lastPush: now - 9 * HR - 20 * MIN, pushes24h: 4, pushes7d: 40 },
        { name: "Cook's Illustrated", lastPush: now - 14 * HR, pushes24h: 2, pushes7d: 33 },
      ],
    },
    {
      id: "ik_2d55", label: "kitchen-backup", prefix: "ing_live_2d55", created: now - 2 * DAY,
      status: "active", scraperVersion: null, contractVersion: null,
      sources: [], // minted, not yet configured / never authenticated
    },
    {
      id: "ik_71aa", label: "old-laptop-cron", prefix: "ing_live_71aa", created: now - 90 * DAY,
      status: "revoked", scraperVersion: "1.2.0", contractVersion: "v2",
      sources: [{ name: "Epicurious", lastPush: now - 46 * DAY, pushes24h: 0, pushes7d: 0 }],
    },
  ];

  // Derive per-scraper rollups: last push across sources, health, version skew,
  // 24h/7d totals. Each source also carries its own derived health.
  const scrapers = rawScrapers.map((s) => {
    const sources = s.sources.map((src) => ({ ...src, health: healthFor(src.lastPush) }));
    const pushed = sources.filter((x) => x.lastPush != null).map((x) => x.lastPush);
    const lastPush = pushed.length ? Math.max(...pushed) : null;
    return {
      ...s,
      sources,
      lastPush,
      health: healthFor(lastPush),
      skew: s.contractVersion != null && s.contractVersion !== CONTRACT_VERSION,
      pushes24h: sources.reduce((n, x) => n + x.pushes24h, 0),
      pushes7d: sources.reduce((n, x) => n + x.pushes7d, 0),
      sourceCount: sources.length,
    };
  });
  const activeScrapers = scrapers.filter((s) => s.status === "active");

  // ── Throughput funnel (last 24h, aggregate across all scrapers/sources) ────
  const funnel = {
    arrival: [
      { key: "received", label: "Received", value: 62, tone: "neutral", note: "candidates POSTed" },
      { key: "accepted", label: "Accepted", value: 58, tone: "neutral", note: "valid payload + key" },
      { key: "deduped", label: "Deduped on arrival", value: 11, tone: "dup", note: "already in flight / corpus" },
      { key: "swept", label: "Handed to sweep", value: 47, tone: "accepted", note: "entered the pipeline" },
    ],
    downstream: [
      { key: "imported", label: "Imported", value: 21, kind: "accepted" },
      { key: "no_match", label: "No match", value: 14, kind: "reject" },
      { key: "duplicate", label: "Duplicate", value: 8, kind: "dup" },
      { key: "parked", label: "Parked", value: 4, kind: "park" },
    ],
  };

  // ── Recent pushes log ──────────────────────────────────────────────────────
  // A batch POST is a (scraper, source) pair. result: accepted · partial ·
  // rejected-bad-payload · rejected-bad-key. `count` is the batch size.
  const RESULTS = {
    accepted: { label: "Accepted", kind: "ok" },
    partial: { label: "Partially deduped", kind: "warn" },
    bad_payload: { label: "Rejected · bad payload", kind: "fail" },
    bad_key: { label: "Rejected · bad key", kind: "fail" },
  };
  let pseq = 0;
  function push(o) { pseq += 1; return { id: "px_" + String(pseq).padStart(3, "0"), ...o, at: now - o.age }; }
  const pushes = [
    push({ age: 12 * MIN, scraper: "home-nas-scraper", source: "NYT Cooking", count: 8, result: "accepted", detail: { deduped: 0 } }),
    push({ age: 40 * MIN, scraper: "basement-pi", source: "Bon Appétit", count: 11, result: "partial", detail: { deduped: 5 } }),
    push({ age: 1 * HR + 6 * MIN, scraper: "home-nas-scraper", source: "Serious Eats", count: 9, result: "accepted", detail: { deduped: 1 } }),
    push({ age: 1 * HR + 52 * MIN, scraper: "home-nas-scraper", source: "NYT Cooking", count: 5, result: "bad_payload", detail: { reason: "3 items missing `source`" } }),
    push({ age: 2 * HR + 30 * MIN, scraper: "basement-pi", source: "Bon Appétit", count: 7, result: "partial", detail: { deduped: 2 } }),
    push({ age: 3 * HR + 8 * MIN, scraper: "home-nas-scraper", source: "Serious Eats", count: 10, result: "accepted", detail: { deduped: 0 } }),
    push({ age: 5 * HR + 15 * MIN, scraper: "old-synology", source: "America's Test Kitchen", count: 6, result: "accepted", detail: { deduped: 1 } }),
    push({ age: 6 * HR + 40 * MIN, scraper: "kitchen-backup", source: "unknown", count: 0, result: "bad_key", detail: { reason: "key authenticated but sent no source header" } }),
    push({ age: 9 * HR + 20 * MIN, scraper: "old-synology", source: "Cook's Illustrated", count: 4, result: "accepted", detail: { deduped: 1 } }),
    push({ age: 13 * HR, scraper: "home-nas-scraper", source: "NYT Cooking", count: 8, result: "accepted", detail: { deduped: 2 } }),
    push({ age: 18 * HR + 12 * MIN, scraper: "home-nas-scraper", source: "NYT Cooking", count: 6, result: "accepted", detail: { deduped: 1 } }),
    push({ age: 22 * HR + 5 * MIN, scraper: "basement-pi", source: "Bon Appétit", count: 6, result: "bad_payload", detail: { reason: "malformed JSON-LD in 2 items" } }),
  ];
  pushes.sort((a, b) => b.at - a.at);

  // ── Relative-time helpers (match the other areas' phrasing) ───────────────
  function relAge(ms) {
    if (ms == null) return "never";
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtAt(ms) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
  }
  function mintSecret() {
    const seg = () => Math.random().toString(36).slice(2, 8);
    return "ing_live_" + seg() + seg() + seg();
  }

  const lastPushAll = Math.max(...activeScrapers.filter((s) => s.lastPush != null).map((s) => s.lastPush));

  window.GA.ingest = {
    contractVersion: CONTRACT_VERSION,
    freshWindowLabel: "6h",
    scrapers,              // all, incl. revoked (for the keys table)
    activeScrapers,        // for liveness + status
    funnel,
    pushes,
    results: RESULTS,
    relAge,
    fmtAt,
    mintSecret,
    healthFor,
    lastPush: lastPushAll,
    stats: {
      activeScrapers: activeScrapers.length,
      fresh: activeScrapers.filter((s) => s.health === "fresh").length,
      stale: activeScrapers.filter((s) => s.health === "stale").length,
      sources: activeScrapers.reduce((n, s) => n + s.sourceCount, 0),
      pushes24h: activeScrapers.reduce((n, s) => n + s.pushes24h, 0),
      pushedToday: funnel.arrival[0].value,
    },
  };
})();
