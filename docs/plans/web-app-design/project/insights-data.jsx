/* Insights dataset for the grocery-agent admin — group popularity over the
   recipe corpus, with a dated cooking-event stream.
     • favorites — per-member `overlay.favorite` flags; a recipe's favorite count
       is COUNT(favorite) across the group. Favorites are a CURRENT state, not an
       event, so they don't change with the time window.
     • cooking events — individual rows in the D1 `cooking_log` (one per cook),
       each with a timestamp. "Times cooked" = events for the slug; the activity
       heatmap and every window-scoped stat derive from this stream.
   Per-recipe all-time cook totals are authored (illustrative); the dated events,
   favoriter usernames, per-source rollups, and windowed views are all derived so
   the numbers stay internally consistent. */
(function () {
  window.GA = window.GA || {};
  const DAY = 86_400_000;
  const now = Date.now();
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today0 = startOfDay(now);

  // slug → [favorites, timesCooked(all-time)]
  const STATS = {
    "weeknight-red-lentil-dal": [8, 34],
    "crispy-sheet-pan-chicken-thighs": [6, 31],
    "miso-butter-salmon": [7, 28],
    "kimchi-fried-rice": [5, 26],
    "smashed-cucumber-salad": [6, 24],
    "brown-butter-chocolate-chip-cookies": [9, 22],
    "mapo-tofu": [5, 19],
    "tuscan-white-bean-soup": [4, 17],
    "coconut-shrimp-curry": [4, 14],
    "green-shakshuka": [3, 12],
    "classic-margherita-pizza": [4, 11],
    "chicken-tortilla-soup": [3, 9],
    "red-wine-braised-short-ribs": [7, 8],
    "herby-spring-grain-bowl": [2, 7],
    "grandmas-apple-cake": [4, 6],
    "summer-tomato-galette": [5, 6],
    "leftover-veggie-frittata": [1, 5],
    "lemongrass-pork-banh-mi": [3, 5],
    "miso-glazed-eggplant-donburi": [2, 4],
    "spiced-lamb-meatballs": [2, 3],
  };

  const recipes = window.GA.recipes || [];
  const activeMembers = (window.GA.members || []).filter((m) => m.status === "active").map((m) => m.user);
  const fallbackMembers = ["casey", "dlo", "marcus", "priya", "tomk", "sage", "bex", "ortega", "ravi"];
  const pool = activeMembers.length ? activeMembers : fallbackMembers;

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function favoritersFor(slug, n) {
    const out = []; const seed = hash(slug);
    for (let i = 0; out.length < n && i < pool.length * 2; i++) {
      const u = pool[(seed + i * 3) % pool.length];
      if (!out.includes(u)) out.push(u);
    }
    return out;
  }

  // Generate the dated cooking-event stream: each recipe's all-time cook total,
  // spread over the trailing ~16 months with a recency bias and a light weekend
  // lean (the friend group cooks more on weekends). Deterministic per slug.
  const SPAN_DAYS = 480;
  const events = [];
  Object.entries(STATS).forEach(([slug, [, cooks]]) => {
    const rng = mulberry32(hash(slug));
    for (let i = 0; i < cooks; i++) {
      const r = rng();
      let off = Math.floor(Math.pow(r, 1.7) * SPAN_DAYS); // recency-biased 0..480
      let at = today0 - off * DAY;
      // weekend lean: nudge a weekday cook onto the nearest weekend ~35% of the time
      const dow = new Date(at).getDay();
      if (dow > 0 && dow < 5 && rng() < 0.35) { at -= dow * DAY; }
      at += Math.floor(rng() * DAY); // random time-of-day
      events.push({ at, slug });
    }
  });
  events.sort((a, b) => a.at - b.at);

  // Daily aggregation for the heatmap.
  const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const dayCount = new Map();
  events.forEach((e) => { const k = dayKey(e.at); dayCount.set(k, (dayCount.get(k) || 0) + 1); });
  function countOnDay(ms) { return dayCount.get(dayKey(ms)) || 0; }

  // Source naming.
  const SOURCE_NAMES = {
    "nytimes.com": "NYT Cooking", "cooking.nytimes.com": "NYT Cooking",
    "smittenkitchen.com": "Smitten Kitchen", "seriouseats.com": "Serious Eats",
    "bonappetit.com": "Bon Appétit", "food52.com": "Food52",
    "kingarthurbaking.com": "King Arthur Baking", "thewoksoflife.com": "The Woks of Life",
    "justonecookbook.com": "Just One Cookbook", "cookieandkate.com": "Cookie and Kate",
    "gimmesomeoven.com": "Gimme Some Oven",
  };
  function domainOf(url) { if (!url) return null; return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; }
  function sourceLabel(domain) { return domain ? (SOURCE_NAMES[domain] || domain) : "Member submissions"; }
  const feedDomains = new Set(((window.GA.config && window.GA.config.corpus && window.GA.config.corpus.feeds) || []).map((f) => domainOf(f.url)));

  // Per-recipe constant fields (favorites, source, etc.).
  const recipeBase = recipes
    .filter((r) => STATS[r.slug])
    .map((r) => {
      const [favorites] = STATS[r.slug];
      const domain = domainOf(r.source);
      return {
        slug: r.slug, title: r.title, cuisine: r.cuisine, protein: r.protein, status: r.status,
        source: r.source, domain, sourceName: sourceLabel(domain),
        favorites, favoriters: favoritersFor(r.slug, favorites),
      };
    });
  const baseBySlug = new Map(recipeBase.map((r) => [r.slug, r]));

  // ── Window-scoped views ─────────────────────────────────────────────────────
  const WINDOWS = { all: Infinity, year: 365, month: 30, week: 7 };
  function windowStart(w) { const d = WINDOWS[w]; return d === Infinity ? -Infinity : now - d * DAY; }
  function inWindow(at, w) { return at >= windowStart(w); }

  function recipeRowsForWindow(w) {
    const start = windowStart(w);
    const cookBySlug = new Map(); const lastBySlug = new Map();
    for (const e of events) {
      if (e.at < start) continue;
      cookBySlug.set(e.slug, (cookBySlug.get(e.slug) || 0) + 1);
      if (e.at > (lastBySlug.get(e.slug) || 0)) lastBySlug.set(e.slug, e.at);
    }
    const rows = recipeBase.map((b) => ({
      ...b, cooks: cookBySlug.get(b.slug) || 0, lastCookedAt: lastBySlug.get(b.slug) || null, combined: 0,
    }));
    const maxFav = Math.max(1, ...rows.map((r) => r.favorites));
    const maxCook = Math.max(1, ...rows.map((r) => r.cooks));
    rows.forEach((r) => { r.combined = Math.round(r.favorites / maxFav * 50 + r.cooks / maxCook * 50); });
    return { rows, maxFav, maxCook };
  }

  function sourceRowsForWindow(w) {
    const { rows } = recipeRowsForWindow(w);
    const map = new Map();
    rows.forEach((r) => {
      const key = r.domain || "__member__";
      if (!map.has(key)) map.set(key, { key, domain: r.domain, name: r.sourceName, isFeed: r.domain ? feedDomains.has(r.domain) : false, isMember: !r.domain, favorites: 0, cooks: 0, recipeCount: 0, recipes: [] });
      const s = map.get(key);
      s.favorites += r.favorites; s.cooks += r.cooks; s.recipeCount += 1;
      s.recipes.push({ slug: r.slug, title: r.title, cuisine: r.cuisine, favorites: r.favorites, cooks: r.cooks, lastCookedAt: r.lastCookedAt });
    });
    const out = [...map.values()];
    const maxFav = Math.max(1, ...out.map((s) => s.favorites));
    const maxCook = Math.max(1, ...out.map((s) => s.cooks));
    out.forEach((s) => { s.combined = Math.round(s.favorites / maxFav * 50 + s.cooks / maxCook * 50); });
    return { rows: out, maxFav, maxCook };
  }

  function totalsForWindow(w) {
    const start = windowStart(w);
    let cooks = 0;
    for (const e of events) if (e.at >= start) cooks += 1;
    const { rows } = recipeRowsForWindow(w);
    const favorites = rows.reduce((n, r) => n + r.favorites, 0);
    const activeDays = new Set(events.filter((e) => e.at >= start).map((e) => dayKey(e.at))).size;
    return { cooks, favorites, activeDays, sources: sourceRowsForWindow(w).rows.length };
  }

  function relAge(ms) {
    if (ms == null) return "never";
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 86400) return "today";
    const d = Math.floor(s / 86400);
    if (d === 1) return "yesterday";
    if (d < 14) return `${d}d ago`;
    if (d < 60) return `${Math.floor(d / 7)}w ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }

  window.GA.insights = {
    windows: [
      { key: "all", label: "All time" },
      { key: "year", label: "Year" },
      { key: "month", label: "Month" },
      { key: "week", label: "Week" },
    ],
    events, countOnDay, inWindow, windowStart,
    recipeRowsForWindow, sourceRowsForWindow, totalsForWindow,
    relAge, today0, DAY,
  };
})();
