/* Discovery dataset for the grocery-agent admin — the autonomous candidate
   pipeline (background-discovery-sweep). Grounded in the real schema: the
   discovery_log row (id/url/title/source/outcome/slug/detail/created_at/attempts/
   next_retry_at) and the sequential per-candidate pipeline
     triage → acquire → classify → describe → dedup → match → import
   plus the outcome taxonomy (imported · duplicate · no_match · dietary_gated ·
   rejected_source · error[park] · failed[infra] · deferred) and the retry
   lifecycle (backoff 1h/6h/1d/3d, max 5 attempts). Illustrative values. */
(function () {
  window.GA = window.GA || {};
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  const now = Date.now();

  // The seven sequential stages every candidate flows through, in order.
  const STAGES = [
    { key: "triage", label: "Triage", icon: "target", blurb: "Cheap taste pre-filter — title+summary embed near any member?" },
    { key: "acquire", label: "Acquire", icon: "download", blurb: "Fetch the page + parse to structured recipe content." },
    { key: "classify", label: "Classify", icon: "sparkles", blurb: "env.AI classification → contract-valid frontmatter facets." },
    { key: "describe", label: "Describe", icon: "fileText", blurb: "Generate the description and embed it — the authoritative vector." },
    { key: "dedup", label: "Dedup", icon: "gitMerge", blurb: "Near-duplicate cosine vs the corpus (and this tick's imports)." },
    { key: "match", label: "Match", icon: "scan", blurb: "Taste cosine + dietary gate, then the negation-aware LLM confirm." },
    { key: "import", label: "Import", icon: "download", blurb: "Assemble body + frontmatter, validate, write to the corpus." },
  ];
  const STAGE_IX = {}; STAGES.forEach((s, i) => { STAGE_IX[s.key] = i; });

  // Outcome → presentation + the stage at which the pipeline halted.
  const OUTCOMES = {
    imported:        { label: "Imported",      kind: "accepted", halt: "import" },
    duplicate:       { label: "Duplicate",     kind: "dup",      halt: "dedup" },
    no_match:        { label: "No match",      kind: "reject",   halt: "match" },
    dietary_gated:   { label: "Dietary gated", kind: "reject",   halt: "match" },
    rejected_source: { label: "Source rejected", kind: "reject", halt: "triage" },
    error:           { label: "Parked",        kind: "park",     halt: "acquire" },
    failed:          { label: "Failed",        kind: "fail",     halt: "acquire" },
    deferred:        { label: "Deferred",      kind: "defer",    halt: "import" },
  };

  // Acquire/classify park reasons (the real taxonomy). `unreachable` is the only
  // retryable acquire reason; infra `failed` is always retryable.
  // reason copy used in detail lines.
  const REASONS = {
    unreachable: "Page unreachable",
    no_jsonld: "No recipe JSON-LD on page",
    not_a_recipe: "Not a recipe page",
    incomplete: "Recipe markup incomplete",
  };

  // Candidate factory. `halt` overrides the outcome's default halt stage (for
  // errors that park at classify/import, or infra failures at a given stage).
  let seq = 0;
  function cand(o) {
    seq += 1;
    const oc = OUTCOMES[o.outcome];
    const haltKey = o.halt || oc.halt;
    return {
      id: "dl_" + String(seq).padStart(3, "0"),
      url: o.url,
      title: o.title,
      source: o.source,
      sourceType: o.sourceType || "feed",
      outcome: o.outcome,
      kind: oc.kind,
      haltKey,
      haltIx: STAGE_IX[haltKey],
      slug: o.slug || null,
      detail: o.detail || {},
      createdAt: now - o.age,
      attempts: o.attempts || 0,
      nextRetryAt: o.nextRetryAt != null ? now + o.nextRetryAt : null, // ms from now; null = terminal
      retryable: o.nextRetryAt != null,
      pushed: !!o.pushed,       // arrived via a home-scraper push (walled-source ingest)
      origin: o.origin || null, // short source tag for the origin badge, e.g. "NYT"
    };
  }

  const candidates = [
    // ── Walled-source pushes (home scrapers → /admin/api/ingest → sweep). Their
    //    acquire stage is satisfied-by-push: content arrives pre-parsed. ──
    cand({ outcome: "imported", pushed: true, origin: "NYT", title: "Braised Short Ribs with Citrus", url: "https://cooking.nytimes.com/braised-short-ribs-citrus", source: "NYT Cooking", sourceType: "scraper", age: 9 * MIN, slug: "braised-short-ribs-citrus", detail: { via: "home-nas-scraper", attribution: [{ tenant: "casey", score: 0.72 }, { tenant: "marcus", score: 0.64 }] } }),
    cand({ outcome: "duplicate", pushed: true, origin: "Bon App\u00e9tit", title: "Weeknight Chicken Piccata", url: "https://www.bonappetit.com/weeknight-chicken-piccata", source: "Bon App\u00e9tit", sourceType: "scraper", age: 44 * MIN, detail: { via: "bon-appetit-box", duplicate_of: "chicken-piccata", cosine: 0.95 } }),
    cand({ outcome: "error", halt: "classify", pushed: true, origin: "Serious Eats", title: "The Food Lab's Roast Potatoes", url: "https://www.seriouseats.com/food-lab-roast-potatoes", source: "Serious Eats", sourceType: "scraper", age: 1 * HR + 12 * MIN, detail: { via: "serious-eats-pi", reason: "validation_failed: `cuisine` off-vocab (\u201cbritish-ish\u201d)" } }),
    cand({ outcome: "no_match", pushed: true, origin: "NYT", title: "Whole Roasted Duck, Two Ways", url: "https://cooking.nytimes.com/whole-roasted-duck", source: "NYT Cooking", sourceType: "scraper", age: 2 * HR + 25 * MIN, detail: { via: "home-nas-scraper", stage: "match", bestCosine: 0.43 } }),
    cand({ outcome: "imported", pushed: true, origin: "Serious Eats", title: "Extra-Smooth Hummus", url: "https://www.seriouseats.com/extra-smooth-hummus", source: "Serious Eats", sourceType: "scraper", age: 4 * HR + 40 * MIN, slug: "extra-smooth-hummus", detail: { via: "serious-eats-pi", attribution: [{ tenant: "priya", score: 0.75 }, { tenant: "sage", score: 0.6 }] } }),

    cand({ outcome: "imported", title: "Miso-Butter Roast Chicken", url: "https://smittenkitchen.com/2024/miso-butter-chicken", source: "Smitten Kitchen", sourceType: "feed", age: 38 * MIN, slug: "miso-butter-roast-chicken", detail: { attribution: [{ tenant: "casey", score: 0.71 }, { tenant: "sage", score: 0.63 }] } }),
    cand({ outcome: "imported", title: "Charred Cabbage with Gochujang Butter", url: "https://www.seriouseats.com/charred-cabbage-gochujang", source: "Serious Eats", sourceType: "feed", age: 52 * MIN, slug: "charred-cabbage-gochujang-butter", detail: { attribution: [{ tenant: "dlo", score: 0.68 }] } }),
    cand({ outcome: "duplicate", title: "Weeknight Thai Basil Chicken", url: "https://hot-thai-kitchen.com/thai-basil-chicken-2", source: "Hot Thai Kitchen", sourceType: "feed", age: 1 * HR + 4 * MIN, detail: { duplicate_of: "thai-basil-chicken", cosine: 0.94 } }),
    cand({ outcome: "no_match", title: "Liver and Onions, the British Way", url: "https://www.greatbritishchefs.com/liver-onions", source: "Great British Chefs", sourceType: "feed", age: 1 * HR + 20 * MIN, detail: { stage: "triage", bestCosine: 0.31 } }),
    cand({ outcome: "error", halt: "acquire", title: "Sheet-Pan Gnocchi with Sausage", url: "https://cooking.nytimes.com/sheet-pan-gnocchi", source: "NYT Cooking", sourceType: "feed", age: 1 * HR + 31 * MIN, attempts: 2, nextRetryAt: 42 * MIN, detail: { reason: "unreachable", status: 503 } }),
    cand({ outcome: "dietary_gated", title: "Brown Butter Scallops", url: "https://www.bonappetit.com/brown-butter-scallops", source: "Bon Appétit", sourceType: "feed", age: 2 * HR, detail: { stage: "match", restriction: "shellfish-free", tenant: "priya" } }),
    cand({ outcome: "imported", title: "Crispy Tofu in Chili Crisp", url: "https://thewoksoflife.com/crispy-tofu-chili-crisp", source: "The Woks of Life", sourceType: "feed", age: 2 * HR + 12 * MIN, slug: "crispy-tofu-chili-crisp", detail: { attribution: [{ tenant: "priya", score: 0.74 }, { tenant: "bex", score: 0.66 }, { tenant: "dlo", score: 0.61 }] } }),
    cand({ outcome: "error", halt: "acquire", title: "Grandma's Sunday Gravy (member submission)", url: "https://sugo-blog.example/sunday-gravy", source: "ravi@hey.com", sourceType: "email", age: 2 * HR + 40 * MIN, detail: { reason: "not_a_recipe" } }),
    cand({ outcome: "failed", halt: "classify", title: "Smoky Black Bean Tacos", url: "https://www.loveandlemons.com/smoky-black-bean-tacos", source: "Love & Lemons", sourceType: "feed", age: 3 * HR, attempts: 1, nextRetryAt: 18 * MIN, detail: { reason: "unexpected: AiError: 3040 capacity exceeded" } }),
    cand({ outcome: "no_match", title: "Classic Beef Wellington", url: "https://www.gordonramsay.com/beef-wellington", source: "Gordon Ramsay", sourceType: "feed", age: 3 * HR + 15 * MIN, detail: { stage: "confirm", note: "cleared cosine, LLM confirm declined for all 2 candidates" } }),
    cand({ outcome: "imported", title: "Lemony White Bean Soup", url: "https://www.budgetbytes.com/lemony-white-bean-soup", source: "Budget Bytes", sourceType: "feed", age: 3 * HR + 50 * MIN, slug: "lemony-white-bean-soup", detail: { attribution: [{ tenant: "tomk", score: 0.69 }, { tenant: "ortega", score: 0.6 }] } }),
    cand({ outcome: "error", halt: "acquire", title: "Paywalled Pasta alla Vodka", url: "https://www.americastestkitchen.com/pasta-vodka", source: "America's Test Kitchen", sourceType: "feed", age: 4 * HR, detail: { reason: "no_jsonld" } }),
    cand({ outcome: "deferred", title: "Sticky Sesame Cauliflower", url: "https://minimalistbaker.com/sticky-sesame-cauliflower", source: "Minimalist Baker", sourceType: "feed", age: 4 * HR + 18 * MIN, detail: { note: "rate cap (10/tick) reached — re-queued for next tick", wouldImport: true } }),
    cand({ outcome: "duplicate", title: "One-Pot Creamy Tomato Pasta", url: "https://www.recipetineats.com/creamy-tomato-pasta", source: "RecipeTin Eats", sourceType: "feed", age: 5 * HR, detail: { duplicate_of: "creamy-tomato-orzo", cosine: 0.91 } }),
    cand({ outcome: "imported", title: "Harissa Chickpea Stew", url: "https://www.themediterraneandish.com/harissa-chickpea-stew", source: "The Mediterranean Dish", sourceType: "feed", age: 5 * HR + 30 * MIN, slug: "harissa-chickpea-stew", detail: { attribution: [{ tenant: "casey", score: 0.7 }, { tenant: "priya", score: 0.67 }, { tenant: "sage", score: 0.64 }, { tenant: "marcus", score: 0.58 }] } }),
    cand({ outcome: "error", halt: "acquire", title: "Air Fryer Salmon Bites", url: "https://wellplated.com/air-fryer-salmon-bites", source: "Well Plated", sourceType: "feed", age: 6 * HR, attempts: 4, nextRetryAt: 3 * DAY, detail: { reason: "unreachable", status: 522 } }),
    cand({ outcome: "rejected_source", title: "Listicle: 50 Best Air Fryer Hacks", url: "https://contentfarm.example/air-fryer-hacks", source: "contentfarm.example", sourceType: "email", age: 6 * HR + 22 * MIN, detail: { note: "source on the member reject list (toggle_reject)", tenant: "casey" } }),
    cand({ outcome: "no_match", title: "Offal Trio: Kidney, Tripe, Tongue", url: "https://nose-to-tail.example/offal-trio", source: "Nose to Tail", sourceType: "feed", age: 7 * HR, detail: { stage: "triage", bestCosine: 0.19 } }),
    cand({ outcome: "imported", title: "Gochujang Glazed Eggplant", url: "https://www.koreanbapsang.com/gochujang-eggplant", source: "Korean Bapsang", sourceType: "feed", age: 7 * HR + 44 * MIN, slug: "gochujang-glazed-eggplant", detail: { attribution: [{ tenant: "dlo", score: 0.72 }, { tenant: "sage", score: 0.61 }] } }),
    cand({ outcome: "error", halt: "classify", title: "Mystery Casserole (scanned card)", url: "https://recipe-snap.example/mystery-casserole", source: "noor@dirtbag.social", sourceType: "email", age: 8 * HR, detail: { reason: "validation_failed: missing required field `cuisine`" } }),
    cand({ outcome: "duplicate", title: "Best Banana Bread", url: "https://www.simplyrecipes.com/best-banana-bread", source: "Simply Recipes", sourceType: "feed", age: 9 * HR, detail: { duplicate_of: "brown-butter-banana-bread", cosine: 0.93 } }),
    cand({ outcome: "imported", title: "Coconut Dal with Crispy Shallots", url: "https://www.bonappetit.com/coconut-dal", source: "Bon Appétit", sourceType: "feed", age: 10 * HR, slug: "coconut-dal-crispy-shallots", detail: { attribution: [{ tenant: "priya", score: 0.76 }, { tenant: "bex", score: 0.62 }] } }),
    cand({ outcome: "no_match", title: "Deconstructed Lobster Thermidor Foam", url: "https://molecular.example/lobster-foam", source: "Molecular Monthly", sourceType: "feed", age: 11 * HR, detail: { stage: "match", bestCosine: 0.41 } }),
    cand({ outcome: "error", halt: "import", title: "Skillet Cornbread", url: "https://www.kingarthurbaking.com/skillet-cornbread", source: "King Arthur Baking", sourceType: "feed", age: 12 * HR, detail: { reason: "import: storage_error writing corpus object (R2 503)" } }),
    cand({ outcome: "imported", title: "Sheet-Pan Chili-Lime Shrimp", url: "https://www.skinnytaste.com/chili-lime-shrimp", source: "Skinnytaste", sourceType: "feed", age: 13 * HR, slug: "sheet-pan-chili-lime-shrimp", detail: { attribution: [{ tenant: "marcus", score: 0.65 }] } }),
    cand({ outcome: "error", halt: "acquire", title: "Vintage Jell-O Salad Mold", url: "https://retro-recipes.example/jello-salad", source: "Retro Recipes", sourceType: "feed", age: 14 * HR, detail: { reason: "incomplete" } }),
    cand({ outcome: "dietary_gated", title: "Bacon-Wrapped Pork Tenderloin", url: "https://www.delish.com/bacon-pork-tenderloin", source: "Delish", sourceType: "feed", age: 16 * HR, detail: { stage: "match", restriction: "pork-free", tenant: "sage" } }),
    cand({ outcome: "imported", title: "Roasted Tomato & White Bean Bowls", url: "https://www.nytimes.com/roasted-tomato-bowls", source: "NYT Cooking", sourceType: "feed", age: 18 * HR, slug: "roasted-tomato-white-bean-bowls", detail: { attribution: [{ tenant: "tomk", score: 0.66 }, { tenant: "ortega", score: 0.63 }] } }),
    cand({ outcome: "duplicate", title: "Easy Weeknight Carbonara", url: "https://www.bonappetit.com/easy-carbonara", source: "Bon Appétit", sourceType: "feed", age: 20 * HR, detail: { duplicate_of: "spaghetti-carbonara", cosine: 0.96 } }),
    cand({ outcome: "no_match", title: "Headcheese from Scratch", url: "https://charcuterie.example/headcheese", source: "Charcuterie Weekly", sourceType: "feed", age: 22 * HR, detail: { stage: "triage", bestCosine: 0.12 } }),
    cand({ outcome: "imported", title: "Spiced Carrot & Lentil Soup", url: "https://www.bbcgoodfood.com/spiced-carrot-lentil-soup", source: "BBC Good Food", sourceType: "feed", age: 1 * DAY + 2 * HR, slug: "spiced-carrot-lentil-soup", detail: { attribution: [{ tenant: "ortega", score: 0.69 }, { tenant: "tomk", score: 0.6 }] } }),
    cand({ outcome: "error", halt: "acquire", title: "TikTok Feta Pasta (link redirect)", url: "https://t.co/xY3kQ", source: "wyn@dirtbag.social", sourceType: "email", age: 1 * DAY + 5 * HR, attempts: 5, nextRetryAt: null, detail: { reason: "unreachable", status: 0, terminal: "retry cap (5) reached" } }),
    cand({ outcome: "imported", title: "Crispy Smashed Potatoes with Aioli", url: "https://www.seriouseats.com/smashed-potatoes", source: "Serious Eats", sourceType: "feed", age: 1 * DAY + 9 * HR, slug: "crispy-smashed-potatoes-aioli", detail: { attribution: [{ tenant: "casey", score: 0.64 }, { tenant: "marcus", score: 0.6 }] } }),
    cand({ outcome: "duplicate", title: "Fluffy Buttermilk Pancakes", url: "https://www.loveandlemons.com/buttermilk-pancakes", source: "Love & Lemons", sourceType: "feed", age: 1 * DAY + 14 * HR, detail: { duplicate_of: "classic-buttermilk-pancakes", cosine: 0.92 } }),
    cand({ outcome: "no_match", title: "Sous-Vide Octopus, 6 Hours", url: "https://www.chefsteps.com/sous-vide-octopus", source: "ChefSteps", sourceType: "feed", age: 2 * DAY, detail: { stage: "match", bestCosine: 0.44 } }),
  ];

  // Newest first (the operator log order).
  candidates.sort((a, b) => b.createdAt - a.createdAt);

  function relAge(ms) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function relFuture(ms) {
    const s = Math.max(0, Math.floor((ms - now) / 1000));
    if (s < 60) return "any moment";
    if (s < 3600) return `in ${Math.floor(s / 60)}m`;
    if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
    return `in ${Math.floor(s / 86400)}d`;
  }

  const byOutcome = {};
  candidates.forEach((c) => { byOutcome[c.outcome] = (byOutcome[c.outcome] || 0) + 1; });
  const retrying = candidates.filter((c) => c.retryable).length;
  const imported = byOutcome.imported || 0;
  const parked = (byOutcome.error || 0);
  const failed = (byOutcome.failed || 0);

  window.GA.discovery = {
    stages: STAGES,
    stageIx: STAGE_IX,
    outcomes: OUTCOMES,
    reasons: REASONS,
    candidates,
    relAge,
    relFuture,
    stats: {
      total: candidates.length,
      imported,
      parked: parked + failed,
      retrying,
      importRate: Math.round((imported / candidates.length) * 100),
    },
    byOutcome,
    lastSweep: now - 6 * MIN,
  };
})();
