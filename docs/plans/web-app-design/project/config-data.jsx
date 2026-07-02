/* Config dataset for the grocery-agent admin — the operator calibration console.
   Grounded in the real config schema: DiscoveryConfig (the sweep knobs +
   DEFAULT_CONFIG), OperatorConfig (DEFAULT_OPERATOR_CONFIG ranking weights +
   flyer behavior), and the five shared-corpus tables. The eight server sub-views
   are consolidated to four operator-facing groups:
     • Discovery   — calibration knobs + RSS feeds + "Always import" addresses
                     (the discovery members + senders tables, abstracted)
     • Kroger Flyer — flyer behaviour knobs + flyer search terms
     • Ranking     — recipe ranking weights
     • Aliases     — ingredient alias corpus
   Analyze / Dry-run are simulated against the shared members + discovery data. */
(function () {
  window.GA = window.GA || {};

  // ── Knob consoles ─────────────────────────────────────────────────────────
  // floor = the safe minimum; saving below it asks to confirm (the real
  // needsConfirm gate). pct renders/edits as a percentage of a 0–1 value.
  const calibration = {
    title: "Calibration",
    blurb: "Tune the sweep's thresholds and per-tick budgets. Preview with Analyze (cheap, no AI) or Dry-run (full pipeline, no writes), then Save. A value below its safe floor asks to confirm.",
    knobs: [
      { key: "tasteThreshold", label: "τ taste threshold", value: 0.55, step: 0.01, min: 0, max: 1, floor: 0.4, help: "Cosine a candidate must clear against a member's taste to match them. Lower = more imports, looser fit." },
      { key: "triageThreshold", label: "Triage threshold", value: 0.45, step: 0.01, min: 0, max: 1, floor: 0.3, help: "Looser gate on the cheap title+summary embed before the expensive fetch/classify." },
      { key: "dedupThreshold", label: "δ dedup threshold", value: 0.9, step: 0.01, min: 0, max: 1, floor: 0.8, help: "At/above this cosine vs the corpus, a candidate is treated as a near-duplicate and skipped." },
      { key: "classifyMaxPerTick", label: "Classify cap / tick", value: 12, step: 1, min: 1, max: 50, floor: 4, help: "Max env.AI classification calls per sweep tick — the AI budget bound." },
      { key: "fetchMaxPerTick", label: "Fetch max / tick", value: 16, step: 1, min: 1, max: 50, floor: 6, help: "Max external recipe-page fetches per tick. Shares the 50-subrequest budget with the flyer warm." },
      { key: "rateCap", label: "Import cap / tick", value: 10, step: 1, min: 1, max: 50, floor: 3, help: "Max imports per tick — the corpus-bloat governor. Excess defers to later ticks." },
      { key: "maxCandidatesPerTick", label: "Max candidates / tick", value: 150, step: 10, min: 10, max: 500, floor: 50, help: "Bounds the triage-embed + log-write cost so an intake backlog can't balloon one invocation." },
      { key: "retryMaxAttempts", label: "Retry max attempts", value: 5, step: 1, min: 1, max: 10, floor: 2, help: "Retryable parks/failures stop retrying after this many attempts (then terminal)." },
      { key: "logRetentionDays", label: "Log retention (days)", value: 60, step: 1, min: 1, max: 365, floor: 14, help: "How long discovery_log rows are kept for audit + dedup." },
    ],
  };

  const ranking = {
    title: "Ranking weights",
    blurb: "Group-default weights for the recipe ranker. Per-member profile rotation overrides layer on top of these.",
    knobs: [
      { key: "favoriteWeight", label: "Favorite weight", value: 0.15, step: 0.05, min: 0, max: 2, floor: 0, help: "How strongly a recipe's similarity to a member's favorites lifts its rank." },
      { key: "noveltyBoost", label: "Novelty boost", value: 0.1, step: 0.05, min: 0, max: 2, floor: 0, help: "Lift for dishes unlike what's been suggested recently — keeps the plan fresh." },
      { key: "pantryWeight", label: "Pantry weight", value: 0.12, step: 0.05, min: 0, max: 2, floor: 0, help: "Reward for recipes that use what's already in the member's pantry." },
      { key: "perishWeight", label: "Perishable weight", value: 1.0, step: 0.5, min: 0, max: 10, floor: 0, help: "Urgency multiplier for using soon-to-expire perishables first." },
      { key: "keyWeight", label: "Key-ingredient weight", value: 0.4, step: 0.5, min: 0, max: 10, floor: 0, help: "Reward for hitting a recipe's defining ingredient when it's on sale / in pantry." },
      { key: "overlapCap", label: "Overlap cap", value: 2, step: 1, min: 0, max: 7, floor: 0, help: "Max recipes in a plan that may share a key ingredient — caps repetition." },
    ],
  };

  const flyer = {
    title: "Flyer behaviour",
    blurb: "How the Kroger flyer warm selects and batches deals.",
    knobs: [
      { key: "minFlyerDiscount", label: "Min flyer discount", value: 0.05, step: 0.01, min: 0, max: 1, floor: 0, pct: true, help: "Ignore flyer items discounted less than this — filters noise from token markdowns." },
      { key: "flyerRefreshHours", label: "Flyer refresh (hours)", value: 24, step: 1, min: 1, max: 168, floor: 6, help: "How often the warm re-pulls the weekly flyer per store." },
      { key: "flyerBatchUnits", label: "Flyer batch units", value: 12, step: 1, min: 1, max: 50, floor: 4, help: "Items embedded per warm batch — bounds the per-tick embedding cost." },
    ],
  };

  // ── Shared corpus tables ───────────────────────────────────────────────────
  const feeds = [
    { url: "https://smittenkitchen.com/feed", name: "Smitten Kitchen", weight: 1.0, tags: ["baking", "weeknight"] },
    { url: "https://www.seriouseats.com/rss", name: "Serious Eats", weight: 1.0, tags: ["technique"] },
    { url: "https://thewoksoflife.com/feed", name: "The Woks of Life", weight: 1.2, tags: ["chinese"] },
    { url: "https://www.budgetbytes.com/feed", name: "Budget Bytes", weight: 0.8, tags: ["budget", "weeknight"] },
    { url: "https://www.bonappetit.com/feed/rss", name: "Bon Appétit", weight: 0.9, tags: [] },
    { url: "https://www.themediterraneandish.com/feed", name: "The Mediterranean Dish", weight: 1.0, tags: ["mediterranean"] },
    { url: "https://minimalistbaker.com/feed", name: "Minimalist Baker", weight: 0.7, tags: ["vegan"] },
    { url: "https://www.koreanbapsang.com/feed", name: "Korean Bapsang", weight: 1.1, tags: ["korean"] },
    { url: "https://www.recipetineats.com/feed", name: "RecipeTin Eats", weight: 1.0, tags: [] },
  ];

  // "Always import" — the discovery members + senders tables, abstracted. Mail
  // forwarded from these addresses skips taste-matching and imports directly.
  // kind: "member" (someone in the friend group) | "automated" (a third-party
  // newsletter/service set up to auto-forward here).
  const alwaysImport = [
    { address: "casey@dirtbag.social", label: "Casey (owner)", kind: "member" },
    { address: "dani@dirtbag.social", label: "Dani Lopez", kind: "member" },
    { address: "priya@dirtbag.social", label: "Priya Nair", kind: "member" },
    { address: "sage@dirtbag.social", label: "Sage Okafor", kind: "member" },
    { address: "digest@nyt-cooking-forward.example", label: "NYT Cooking weekly digest", kind: "automated" },
    { address: "newsletter@seriouseats-forward.example", label: "Serious Eats newsletter", kind: "automated" },
  ];

  const flyerTerms = [
    { term: "boneless chicken thighs" }, { term: "ground beef 80/20" }, { term: "russet potatoes" },
    { term: "yellow onions" }, { term: "block cheddar" }, { term: "roma tomatoes" },
    { term: "olive oil" }, { term: "frozen peas" }, { term: "canned chickpeas" }, { term: "pasta" },
  ];

  const aliases = [
    { variant: "scallion", canonical: "green onion" }, { variant: "spring onion", canonical: "green onion" },
    { variant: "coriander (fresh)", canonical: "cilantro" }, { variant: "aubergine", canonical: "eggplant" },
    { variant: "courgette", canonical: "zucchini" }, { variant: "capsicum", canonical: "bell pepper" },
    { variant: "garbanzo beans", canonical: "chickpeas" }, { variant: "passata", canonical: "tomato purée" },
    { variant: "rocket", canonical: "arugula" }, { variant: "caster sugar", canonical: "superfine sugar" },
  ];

  // ── Analyze simulator (cheap, no AI) ───────────────────────────────────────
  // Per-member match count at τ + δ pair stats, derived from the shared roster.
  function analyze(tasteThreshold, dedupThreshold) {
    const members = (window.GA.members || []).filter((m) => m.status === "active");
    const corpusSize = (window.GA.recipes ? window.GA.recipes.length : 0) || 248;
    const memberTau = members.map((m, i) => {
      // Higher τ → fewer matches; more-active members match more. Deterministic.
      const base = 6 + ((m.cooked || 0) % 9) + ((i * 5) % 4);
      const shrink = Math.round((tasteThreshold - 0.4) * 28);
      const matchCount = Math.max(0, base - shrink);
      return { tenant: m.user, matchCount, coldStart: (m.favorites || 0) < 5 };
    });
    const deltaPairs = Math.round(corpusSize * (corpusSize - 1) / 2 * (1 - dedupThreshold) * 0.04);
    return { memberTau, deltaPairCount: deltaPairs, deltaBounded: corpusSize > 200, deltaCorpusSize: corpusSize };
  }

  // ── Dry-run simulator (full pipeline, no writes) ───────────────────────────
  // Reuse the discovery candidates as the "would-process" set; surface outcome +
  // who it would match. Tightening τ pushes marginal imports → no_match.
  function dryRun(tasteThreshold) {
    const cands = (window.GA.discovery ? window.GA.discovery.candidates : []).slice(0, 8);
    return cands.map((c) => {
      let outcome = c.outcome;
      const att = (c.detail && c.detail.attribution) || [];
      let who = att.map((a) => "@" + a.tenant);
      if (outcome === "imported" && tasteThreshold > 0.6) {
        // a tighter threshold drops the weakest match; may flip to no_match
        const survivors = att.filter((a) => a.score >= tasteThreshold);
        if (survivors.length === 0) { outcome = "no_match"; who = []; }
        else who = survivors.map((a) => "@" + a.tenant);
      }
      return { url: c.url, title: c.title, outcome, wouldMatchMembers: who };
    });
  }

  window.GA.config = {
    groups: ["Discovery", "Ingest Keys", "Kroger Flyer", "Ranking", "Aliases"],
    calibration, ranking, flyer,
    corpus: { feeds, alwaysImport, flyerTerms, aliases },
    analyze, dryRun,
  };
})();
