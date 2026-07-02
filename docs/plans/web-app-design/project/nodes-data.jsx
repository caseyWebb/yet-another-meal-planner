/* Ingredient identity graph — the canonical node + satisfies-edge dataset that
   backs the Normalization › Nodes lens. Nodes are canonical ids (`base` or
   `base::detail`); some are CONCRETE (a buyable product) and some are CONCEPT
   classes (concrete=false, e.g. ⟨fresh-soft-cheese⟩). Directed, ASYMMETRIC
   "satisfies" edges join them, in three kinds:
     · general      — a specific type satisfies its base   (kielbasa → sausage)
     · containment  — a whole satisfies a part             (chicken::whole → chicken::thighs)
     · membership   — a member satisfies a concept class   (mozzarella::fresh → ⟨fresh-soft-cheese⟩)
   Edges read "from satisfies to": `from` fulfils a request for `to`. The reverse
   does NOT hold (generic sausage does NOT satisfy a "cajun sausage" request), so
   incoming ≠ outgoing and the detail view keeps them on one left-to-right
   "satisfies" axis. Edgeless CONCRETE nodes are derivable ORPHANS — the audit
   signal for an early below-floor mint that never got linked. Illustrative. */
(function () {
  window.GA = window.GA || {};

  // Edge-kind presentation. general=blue · containment=amber · membership=violet.
  const KINDS = {
    general:     { label: "general",     verb: "is a type of",  gloss: "a specific type satisfies its base" },
    containment: { label: "containment", verb: "contains",      gloss: "a whole satisfies a part" },
    membership:  { label: "membership",  verb: "is a",          gloss: "a member satisfies a concept class" },
  };

  // ── Node table. concrete defaults true; concept nodes pass concrete:false.
  //    `rep` = merged into another node (this id is retired, requests re-key to rep).
  let seq = 0;
  function node(o) {
    seq += 1;
    return {
      id: o.detail ? o.base + "::" + o.detail : o.base,
      base: o.base,
      detail: o.detail || null,
      concrete: o.concrete !== false,
      concept: o.concrete === false,
      rep: o.rep || null,                 // representative id if merged away
      aliases: o.aliases || [],
      seenAt: o.seenAt || null,           // when the node was first minted (for orphan context)
      note: o.note || null,
    };
  }

  const N = [
    // ── Sausage family (general + membership) ──────────────────────────
    node({ base: "sausage", aliases: ["sausages", "link sausage", "smoked sausage"] }),
    node({ base: "sausage", detail: "cajun", aliases: ["cajun sausage", "cajun-style sausage"] }),
    node({ base: "sausage", detail: "italian", aliases: ["italian sausage", "sweet italian sausage", "hot italian sausage"] }),
    node({ base: "chorizo", aliases: ["mexican chorizo", "chorizo sausage"] }),
    node({ base: "andouille", aliases: ["andouille sausage"] }),
    node({ base: "kielbasa", aliases: ["polish sausage"], seenAt: "below-floor mint · 6 weeks ago",
      note: "Minted below the similarity floor with no LLM call — never picked up a general edge to sausage." }),
    node({ base: "cured-meat", concrete: false, aliases: ["cured meats", "charcuterie"] }),

    // ── Chicken family (containment + general) ─────────────────────────
    node({ base: "chicken", aliases: ["chicken meat"] }),
    node({ base: "chicken", detail: "whole", aliases: ["whole chicken", "fryer chicken", "roaster"] }),
    node({ base: "chicken", detail: "thighs", aliases: ["chicken thighs", "chx thighs", "bone-in thighs"] }),
    node({ base: "chicken", detail: "breast", aliases: ["chicken breast", "chicken breasts", "boneless skinless chicken breast"] }),
    node({ base: "chicken", detail: "wings", aliases: ["chicken wings", "party wings"] }),

    // ── Fresh soft cheese (membership + general) ───────────────────────
    node({ base: "fresh-soft-cheese", concrete: false, aliases: ["a fresh soft cheese", "soft cheese"] }),
    node({ base: "mozzarella", aliases: ["mozz", "mozzarella cheese"] }),
    node({ base: "mozzarella", detail: "fresh", aliases: ["fresh mozzarella", "buffalo mozzarella", "mozzarella di bufala"] }),
    node({ base: "mozzarella", detail: "low-moisture", aliases: ["low-moisture mozzarella", "part-skim mozzarella", "pizza mozzarella"] }),
    node({ base: "ricotta", aliases: ["ricotta cheese", "whole-milk ricotta"] }),
    node({ base: "goat cheese", aliases: ["chèvre", "goats cheese"] }),
    node({ base: "burrata", aliases: ["burrata cheese"] }),

    // ── Ground beef + salt (general) ───────────────────────────────────
    node({ base: "ground beef", aliases: ["ground chuck", "hamburger meat"] }),
    node({ base: "ground beef", detail: "fat-80-20", aliases: ["80/20 ground beef", "80/20"] }),
    node({ base: "ground beef", detail: "fat-90-10", aliases: ["90/10 ground beef", "lean ground beef"] }),
    node({ base: "kosher salt", aliases: ["kosher salt"] }),
    node({ base: "kosher salt", detail: "diamond-crystal", aliases: ["diamond crystal kosher salt", "diamond crystal"] }),
    node({ base: "kosher salt", detail: "morton", aliases: ["morton kosher salt"] }),

    // ── Merged pair (representative) ───────────────────────────────────
    node({ base: "coriander", aliases: ["cilantro", "cilantro leaves", "fresh coriander", "coriander"] }),
    node({ base: "cilantro", rep: "coriander", aliases: ["cilantro"], note: "Merged into coriander via a shared Kroger SKU — requests re-key to the representative." }),

    // ── Isolated below-floor mints (orphans, legitimately unlinked) ────
    node({ base: "xanthan gum", aliases: ["xanthan"], seenAt: "below-floor mint · 4 weeks ago" }),
    node({ base: "ras el hanout", aliases: ["ras al hanout"], seenAt: "below-floor mint · 3 weeks ago" }),
    node({ base: "green onion", aliases: ["scallions", "scallion", "spring onions", "green onions"] }),
  ];

  const byId = {};
  N.forEach((n) => { byId[n.id] = n; });

  // ── Directed edge list, "from satisfies to". Single source of truth; each
  //    node's incoming/outgoing are derived so the graph stays consistent.
  const E = [
    // general — specific type → base
    ["sausage::cajun", "sausage", "general"],
    ["sausage::italian", "sausage", "general"],
    ["chorizo", "sausage", "general"],
    ["andouille", "sausage", "general"],
    // (kielbasa → sausage intentionally MISSING — the orphan gap)
    ["chicken::whole", "chicken", "general"],
    ["chicken::thighs", "chicken", "general"],
    ["chicken::breast", "chicken", "general"],
    ["chicken::wings", "chicken", "general"],
    ["mozzarella::fresh", "mozzarella", "general"],
    ["mozzarella::low-moisture", "mozzarella", "general"],
    ["ground beef::fat-80-20", "ground beef", "general"],
    ["ground beef::fat-90-10", "ground beef", "general"],
    ["kosher salt::diamond-crystal", "kosher salt", "general"],
    ["kosher salt::morton", "kosher salt", "general"],
    // containment — whole → part
    ["chicken::whole", "chicken::thighs", "containment"],
    ["chicken::whole", "chicken::breast", "containment"],
    ["chicken::whole", "chicken::wings", "containment"],
    // membership — member → concept class
    ["mozzarella::fresh", "fresh-soft-cheese", "membership"],
    ["ricotta", "fresh-soft-cheese", "membership"],
    ["goat cheese", "fresh-soft-cheese", "membership"],
    ["burrata", "fresh-soft-cheese", "membership"],
    ["sausage", "cured-meat", "membership"],
    ["chorizo", "cured-meat", "membership"],
    ["andouille", "cured-meat", "membership"],
  ].map(([from, to, kind]) => ({ from, to, kind }));

  // Derive per-node adjacency.
  const outMap = {}, inMap = {};
  N.forEach((n) => { outMap[n.id] = []; inMap[n.id] = []; });
  E.forEach((e) => {
    if (outMap[e.from]) outMap[e.from].push({ id: e.to, kind: e.kind });
    if (inMap[e.to]) inMap[e.to].push({ id: e.from, kind: e.kind });
  });

  function outgoing(id) { return outMap[id] || []; }   // what THIS satisfies
  function incoming(id) { return inMap[id] || []; }    // what satisfies THIS
  function degree(id) { return outgoing(id).length + incoming(id).length; }

  // Orphan = a CONCRETE, non-merged node with zero edges. The audit signal.
  function isOrphan(n) { return n.concrete && !n.rep && degree(n.id) === 0; }

  const orphans = N.filter(isOrphan);

  window.GA.nodes = {
    kinds: KINDS,
    list: N,
    edges: E,
    byId,
    outgoing,
    incoming,
    degree,
    isOrphan,
    orphans,
    stats: {
      total: N.length,
      concrete: N.filter((n) => n.concrete).length,
      concepts: N.filter((n) => n.concept).length,
      orphans: orphans.length,
    },
  };
})();
