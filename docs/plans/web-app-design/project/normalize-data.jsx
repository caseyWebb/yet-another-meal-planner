/* Ingredient-normalization dataset for the grocery-agent admin. The identity
   system maps surface terms people type ("80/20 ground beef", "scallions") to
   canonical ingredient ids. A background job grows the mapping: it embeds a
   novel term, finds nearest known ids by cosine similarity, and a small LLM
   classifies the relationship as SAME · SPECIALIZATION · NOVEL · MERGE. Terms
   below a similarity floor resolve with NO LLM call; some FAIL (transient error
   or an invalid model answer) and "fail safe" to novel. An id is `base` or
   `base::detail` (e.g. `ground beef::fat-80-20`). Every decision is auto-made
   but the operator can OVERRIDE it — a human correction the auto job never
   overwrites. Illustrative values. */
(function () {
  window.GA = window.GA || {};
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  const now = Date.now();

  // Similarity floor below which no LLM is called (a novel base is minted).
  const FLOOR = 0.45;

  // Outcome → presentation. Colours match the filter pills:
  // same=green · specialization=blue · novel=zinc · merge=violet · no-llm=neutral · failed=red.
  const OUTCOMES = {
    same:           { label: "Same",           kind: "same"  },
    specialization: { label: "Specialization", kind: "spec"  },
    novel:          { label: "Novel",          kind: "novel" },
    merge:          { label: "Merge",          kind: "merge" },
    no_llm:         { label: "No-LLM",         kind: "nollm" },
    failed:         { label: "Failed",         kind: "fail"  },
  };

  // Known canonical ids — the corpus the embedder searches and the typeahead
  // used by the override panel. `base` or `base::detail`.
  const KNOWN_IDS = [
    "green onion", "chives", "leek", "ground beef", "ground beef::fat-80-20",
    "ground beef::fat-90-10", "lean ground beef", "ground turkey", "ground chicken",
    "zucchini", "yellow squash", "baking soda", "baking powder", "all-purpose flour",
    "cornstarch", "gochujang", "doenjang", "sriracha", "fresh mozzarella", "ricotta",
    "goat cheese", "feta", "chicken broth", "vegetable broth", "olive oil", "sesame oil",
    "kosher salt", "kosher salt::diamond-crystal", "table salt", "soy sauce", "shaoxing wine",
    "rice vinegar", "coriander", "garlic", "yellow onion", "shallot", "scallions",
  ];

  let seq = 0;
  function dec(o) {
    seq += 1;
    return {
      id: "nrm_" + String(seq).padStart(3, "0"),
      term: o.term,                 // the surface term, verbatim
      base: o.base,                 // resolved canonical base
      detail: o.detail || null,     // ::detail spec, if a specialization
      concept: !!o.concept,         // an abstract concept id (has member edges)
      outcome: o.outcome,
      kind: OUTCOMES[o.outcome].kind,
      source: o.source || "auto",   // "auto" | "human"
      createdAt: now - o.age,
      model: o.model || null,       // classifier model, null when no LLM called
      belowFloor: !!o.belowFloor,
      candidates: o.candidates || [],   // [{ id, score, chosen }]
      edges: o.edges || [],             // [{ from, to, rel }]
      members: o.members || [],         // membership edges for concept ids
      reason: o.reason || "",
      mergeInto: o.mergeInto || null,   // merge: term's old id → this id
      failedSafe: !!o.failedSafe,       // failed → novel(safe)
      attempts: o.attempts || 0,
    };
  }

  const decisions = [
    dec({
      term: "scallions", base: "green onion", outcome: "same", age: 2 * MIN,
      model: "mistral-small-3.1-24b",
      candidates: [
        { id: "green onion", score: 0.63, chosen: true },
        { id: "olive oil", score: 0.55 },
        { id: "baking soda", score: 0.51 },
      ],
      reason: "synonym of green onion",
    }),
    dec({
      term: "80/20 ground beef", base: "ground beef", detail: "fat-80-20",
      outcome: "specialization", age: 4 * MIN, model: "mistral-small-3.1-24b",
      candidates: [
        { id: "ground beef", score: 0.83, chosen: true },
        { id: "lean ground beef", score: 0.71 },
      ],
      edges: [{ from: "ground beef::fat-80-20", to: "ground beef", rel: "satisfies" }],
      reason: "ground beef at a specific fat ratio",
    }),
    dec({
      term: "shaoxing wine", base: "shaoxing wine", outcome: "same", age: 7 * MIN,
      model: "mistral-small-3.1-24b",
      candidates: [
        { id: "shaoxing wine", score: 0.68, chosen: true },
        { id: "rice vinegar", score: 0.52 },
      ],
      reason: "romanization variant of an existing id (shao xing → shaoxing)",
    }),
    dec({
      term: "kosher salt, diamond crystal", base: "kosher salt", detail: "diamond-crystal",
      outcome: "specialization", age: 12 * MIN, model: "mistral-small-3.1-24b",
      candidates: [
        { id: "kosher salt", score: 0.86, chosen: true },
        { id: "table salt", score: 0.64 },
      ],
      edges: [{ from: "kosher salt::diamond-crystal", to: "kosher salt", rel: "satisfies" }],
      reason: "kosher salt, a specific brand/grain — coarser volume-to-weight",
    }),
    dec({
      term: "gochujang", base: "gochujang", outcome: "novel", age: 18 * MIN,
      model: "mistral-small-3.1-24b",
      candidates: [
        { id: "doenjang", score: 0.61 },
        { id: "sriracha", score: 0.55 },
      ],
      reason: "distinct Korean fermented chili paste — not a synonym of nearby pastes",
    }),
    dec({
      term: "spring onions", base: "green onion", outcome: "same", source: "human",
      age: 22 * MIN, model: "mistral-small-3.1-24b",
      candidates: [
        { id: "green onion", score: 0.79, chosen: true },
        { id: "chives", score: 0.58 },
      ],
      reason: "operator-pinned synonym (UK term for green onion)",
    }),
    dec({
      term: "85% lean ground turkey", base: "ground turkey", detail: "fat-85-15",
      outcome: "specialization", age: 55 * MIN, model: "mistral-small-3.1-24b",
      candidates: [
        { id: "ground turkey", score: 0.80, chosen: true },
        { id: "ground chicken", score: 0.66 },
      ],
      edges: [{ from: "ground turkey::fat-85-15", to: "ground turkey", rel: "satisfies" }],
      reason: "ground turkey at a specific fat ratio",
    }),
    dec({
      term: "baking powder", base: "baking powder", outcome: "novel", age: 5 * MIN,
      model: "mistral-small-3.1-24b",
      candidates: [
        { id: "baking soda", score: 0.83 },
        { id: "all-purpose flour", score: 0.68 },
      ],
      reason: "distinct product from baking soda (contains an acid + starch)",
    }),
    dec({
      term: "courgette", base: "zucchini", outcome: "merge", age: 1 * HR, mergeInto: "zucchini",
      model: "mistral-small-3.1-24b",
      candidates: [
        { id: "zucchini", score: 0.88, chosen: true },
        { id: "yellow squash", score: 0.62 },
      ],
      reason: "same product, resolved via a shared Kroger SKU (0000000004067)",
    }),
    dec({
      term: "cilantro", base: "coriander", outcome: "merge", age: 40 * MIN, mergeInto: "coriander",
      model: "mistral-small-3.1-24b",
      candidates: [
        { id: "coriander", score: 0.90, chosen: true },
      ],
      reason: "same herb, US/UK naming — merged leaf ids under one canonical",
    }),
    dec({
      term: "a fresh soft cheese", base: "fresh-soft-cheese", outcome: "novel", concept: true,
      age: 2 * HR, model: "mistral-small-3.1-24b",
      candidates: [
        { id: "fresh mozzarella", score: 0.58 },
        { id: "ricotta", score: 0.56 },
        { id: "goat cheese", score: 0.54 },
      ],
      members: ["fresh mozzarella", "ricotta", "goat cheese"],
      reason: "an abstract category, not a single product — minted as a concept id with member edges",
    }),
    dec({
      term: "xanthan gum", base: "xanthan gum", outcome: "no_llm", age: 1 * HR + 10 * MIN,
      belowFloor: true,
      candidates: [
        { id: "guar gum", score: 0.38 },
        { id: "cornstarch", score: 0.33 },
      ],
      reason: "nearest neighbour below the " + FLOOR + " similarity floor — minted a new base, no LLM call",
    }),
    dec({
      term: "ras el hanout", base: "ras el hanout", outcome: "no_llm", age: 1 * HR + 30 * MIN,
      belowFloor: true,
      candidates: [
        { id: "garam masala", score: 0.41 },
      ],
      reason: "nearest neighbour below the " + FLOOR + " similarity floor — minted a new base, no LLM call",
    }),
    dec({
      term: "weird thing xyz", base: "weird thing xyz", outcome: "failed", failedSafe: true,
      age: 3 * HR, attempts: 3,
      candidates: [],
      reason: "classifier could not produce a contract-valid answer (3 attempts) — failed safe to a novel base",
    }),
    dec({
      term: "unicorn meat substitute?", base: "unicorn meat substitute", outcome: "failed",
      failedSafe: true, age: 6 * HR, attempts: 2,
      candidates: [
        { id: "seitan", score: 0.44 },
      ],
      reason: "env.AI returned AiError 3040 (capacity exceeded) mid-classify — failed safe to a novel base",
    }),
  ];

  // Newest first (operator log order).
  decisions.sort((a, b) => b.createdAt - a.createdAt);

  // The pending queue — novel terms awaiting a processing pass.
  const queue = [
    { term: "gochugaru", firstSeen: 3 * MIN, attempts: 0, nextRetry: 2 * MIN },
    { term: "n'duja", firstSeen: 15 * MIN, attempts: 0, nextRetry: 1 * MIN },
    { term: "sujeonggwa", firstSeen: 8 * MIN, attempts: 1, nextRetry: 10 * MIN },
    { term: "za'atar blend", firstSeen: 32 * MIN, attempts: 2, nextRetry: 20 * MIN },
    { term: "black garlic", firstSeen: 1 * HR, attempts: 1, nextRetry: 40 * MIN },
    { term: "amba sauce", firstSeen: 4 * HR, attempts: 2, nextRetry: 1 * HR },
    { term: "koji rice", firstSeen: 2 * HR, attempts: 3, nextRetry: 3 * HR },
  ].map((q, i) => ({ id: "q_" + String(i + 1).padStart(2, "0"), ...q, firstSeenAt: now - q.firstSeen, nextRetryAt: now + q.nextRetry }));

  // The live alias map — the actual surface-form → canonical id table the
  // matcher reads right now. The Decisions tab is a pruned history; this is
  // current state. Auto rows are grown by the cron; human rows are pinned.
  let aseq = 0;
  function al(variant, base, detail, source, extra) {
    aseq += 1;
    return { id: "al_" + String(aseq).padStart(3, "0"), variant, base, detail: detail || null, source, ...(extra || {}) };
  }
  const aliases = [
    al("evoo", "olive oil", null, "human"),
    al("extra virgin olive oil", "olive oil", null, "auto"),
    al("xtra virgin olive oil", "olive oil", null, "auto"),
    al("scallions", "green onion", null, "auto"),
    al("scallion", "green onion", null, "auto"),
    al("spring onions", "green onion", null, "human"),
    al("green onions", "green onion", null, "auto"),
    al("80/20 ground beef", "ground beef", "fat-80-20", "auto"),
    al("85/15 ground beef", "ground beef", "fat-85-15", "auto"),
    al("ground chuck", "ground beef", null, "auto"),
    al("courgette", "zucchini", null, "auto", { merged: true }),
    al("cilantro", "coriander", null, "auto"),
    al("cilantro leaves", "coriander", null, "auto"),
    al("diamond crystal kosher salt", "kosher salt", "diamond-crystal", "human"),
    al("morton kosher salt", "kosher salt", "morton", "auto"),
    al("a fresh soft cheese", "fresh-soft-cheese", null, "auto", { concept: true }),
    al("chx thighs", "chicken thighs", null, "human"),
    al("baby bella", "cremini mushroom", null, "auto"),
    al("garbanzo beans", "chickpeas", null, "auto"),
    al("corn starch", "cornstarch", null, "auto"),
    al("confectioners sugar", "powdered sugar", null, "auto"),
    al("soda water", "club soda", null, "auto"),
    al("roma tomatoes", "tomato", null, "auto"),
    al("ap flour", "all-purpose flour", null, "auto"),
    al("gochugaru", "korean chili flakes", null, "auto"),
    al("plain greek yogurt", "greek yogurt", null, "auto"),
    al("unsalted butter", "butter", "unsalted", "auto"),
    al("sea salt flakes", "flaky sea salt", null, "human"),
  ];


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
  function absTime(ms) {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // ── Edge decisions ────────────────────────────────────────────────────
  // The same decision log also records verdicts on directed satisfies-edges
  // (produced by the edge audit + the identity graph). They are shaped
  // differently from term decisions: a from→to edge, a KEEP or DROP outcome, a
  // direction verdict, and a reason. Kept out of the term stream — surfaced in
  // the Decisions tab's Edges segment. `origin` links a DROP that was later
  // revisited by a replay/restoration event.
  const EDGE_OUTCOMES = {
    edge_keep: { label: "Kept", kind: "edge_keep" },
    edge_drop: { label: "Dropped", kind: "edge_drop" },
  };
  let eseq = 0;
  function edge(o) {
    eseq += 1;
    return {
      id: "edg_" + String(eseq).padStart(3, "0"),
      from: o.from, to: o.to, rel: o.rel || "satisfies",
      outcome: o.outcome, kind: EDGE_OUTCOMES[o.outcome].kind,
      verdict: o.verdict,                 // the direction verdict, short
      reason: o.reason || "",
      source: o.source || "auto",
      createdAt: now - o.age,
      flag: o.flag || null,               // "self-loop" | "cycle" | null
      restoredBy: o.restoredBy || null,   // replay event id, if later revisited
    };
  }
  const edgeDecisions = [
    edge({ from: "ground beef::fat-80-20", to: "ground beef", outcome: "edge_keep",
      verdict: "specialization → base holds", age: 3 * MIN,
      reason: "a fat-ratio spec satisfies its base — sound directed edge" }),
    edge({ from: "green onion", to: "green onion", outcome: "edge_drop", flag: "self-loop",
      verdict: "self-loop — an id can't satisfy itself", age: 9 * MIN,
      reason: "dropped a reflexive edge introduced by a bad merge" }),
    edge({ from: "kosher salt::diamond-crystal", to: "kosher salt", outcome: "edge_keep",
      verdict: "grain spec → base holds", age: 21 * MIN,
      reason: "coarse-grain kosher salt satisfies the base id" }),
    edge({ from: "ricotta", to: "fresh-soft-cheese", outcome: "edge_keep", rel: "member-of",
      verdict: "member → concept holds", age: 34 * MIN,
      reason: "ricotta is a member of the fresh-soft-cheese concept" }),
    edge({ from: "yellow squash", to: "zucchini", outcome: "edge_drop",
      verdict: "spurious → distinct products", age: 48 * MIN,
      reason: "co-occurrence isn't satisfaction — different Kroger SKUs" }),
    edge({ from: "ground turkey::fat-85-15", to: "ground turkey", outcome: "edge_keep",
      verdict: "specialization → base holds", age: 1 * HR + 5 * MIN,
      reason: "fat-ratio spec satisfies its base" }),
    edge({ from: "chives", to: "green onion", outcome: "edge_drop",
      verdict: "closes a cycle → dropped", flag: "cycle", age: 2 * HR,
      reason: "chives→green onion + green onion→chives formed a 2-cycle; kept the higher-confidence direction",
      restoredBy: "rpl_002" }),
    edge({ from: "gochujang", to: "doenjang", outcome: "edge_drop",
      verdict: "spurious → distinct pastes", age: 3 * HR + 20 * MIN,
      reason: "nearest-neighbour edge, not a satisfaction relationship",
      restoredBy: "rpl_007" }),
    edge({ from: "lean ground beef", to: "ground beef", outcome: "edge_keep",
      verdict: "leaner variant → base holds", age: 5 * HR,
      reason: "lean ground beef satisfies the ground beef base" }),
    edge({ from: "shallot", to: "yellow onion", outcome: "edge_drop",
      verdict: "spurious → distinct alliums", age: 7 * HR,
      reason: "similar but not interchangeable — dropped the edge" }),
  ];
  edgeDecisions.sort((a, b) => b.createdAt - a.createdAt);

  const byOutcome = {};
  decisions.forEach((d) => { byOutcome[d.outcome] = (byOutcome[d.outcome] || 0) + 1; });
  const byEdgeOutcome = {};
  edgeDecisions.forEach((d) => { byEdgeOutcome[d.outcome] = (byEdgeOutcome[d.outcome] || 0) + 1; });

  window.GA.normalize = {
    floor: FLOOR,
    outcomes: OUTCOMES,
    edgeOutcomes: EDGE_OUTCOMES,
    knownIds: KNOWN_IDS,
    decisions,
    edgeDecisions,
    queue,
    aliases,
    byOutcome,
    byEdgeOutcome,
    relAge,
    relFuture,
    absTime,
    stats: {
      nodes: 412,
      aliases: 1038,
      satisfies: 156,
      pending: queue.length,
      decisions24h: 63,
      needsAttention: (byOutcome.failed || 0),
    },
    lastSweep: now - 3 * MIN,
  };
})();
