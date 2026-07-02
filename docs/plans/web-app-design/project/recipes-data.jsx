/* Recipe corpus for the grocery-agent admin Data › Recipes view. Mirrors the real
   cross-tier model: each recipe is an authored R2 markdown source (frontmatter +
   body) projected into the D1 `recipes` index, with an AI-derived description +
   embedding (recipe_derived) and cross-tenant attributed notes (recipe_notes).

   Facets use the controlled vocab (src/vocab.js): protein, cuisine, season,
   requires_equipment. `status` is the reconcile placement (indexed | skipped |
   pending | orphaned). Bodies / frontmatter / projection / raw markdown are
   derived on demand by the helpers at the bottom — the data stays lean. */
(function () {
  window.GA = window.GA || {};
  const DAY = 86_400_000;
  const now = Date.now();
  const ago = (d) => now - d * DAY;

  // note: { author, body, tags, private, at }
  const N = (author, body, tags, priv, d) => ({ author, body, tags: tags || [], private: !!priv, at: ago(d) });

  const recipes = [
    {
      slug: "miso-butter-salmon", title: "Miso Butter Salmon", protein: "fish", cuisine: "japanese", time: 25,
      course: ["main"], season: ["winter"], dietary: ["gluten-free"], tags: ["weeknight", "sheet-pan"],
      ingredients: ["salmon fillet", "white miso", "unsalted butter", "scallion", "steamed rice"],
      pairs_with: ["smashed-cucumber-salad"], equipment: [], servings: 4, difficulty: "easy",
      source: "https://www.nytimes.com/cooking/miso-butter-salmon", status: "indexed", described: true, embedding: true,
      description: "Sheet-pan salmon lacquered in sweet-salty miso butter — 25 minutes, mostly hands-off, broiler does the work.",
      notes: [N("casey", "Broiled the last 2 minutes for a real crust. Easily a 4-star weeknight.", ["tip"], false, 5)],
    },
    {
      slug: "weeknight-red-lentil-dal", title: "Weeknight Red Lentil Dal", protein: "vegan", cuisine: "indian", time: 35,
      course: ["main"], season: ["fall", "winter"], dietary: ["vegetarian", "vegan", "gluten-free"], tags: ["cozy", "batch"],
      ingredients: ["red lentils", "coconut milk", "fresh ginger", "garlic", "cumin"],
      pairs_with: [], equipment: [], servings: 6, difficulty: "easy",
      source: "https://smittenkitchen.com/red-lentil-dal", status: "indexed", described: true, embedding: true,
      description: "A cozy, freezer-friendly red lentil dal that simmers itself silky in one pot — the default cold-night dinner.",
      notes: [N("sage", "Freezes beautifully in single portions. I always double it.", ["meal-prep"], false, 12)],
    },
    {
      slug: "smashed-cucumber-salad", title: "Smashed Cucumber Salad", protein: "vegan", cuisine: "chinese", time: 15,
      course: ["side", "salad"], season: ["summer"], dietary: ["vegetarian", "vegan", "gluten-free"], tags: ["no-cook", "quick"],
      ingredients: ["persian cucumber", "garlic", "soy sauce", "chili crisp", "toasted sesame"],
      pairs_with: ["miso-butter-salmon"], equipment: [], servings: 4, difficulty: "easy",
      source: null, status: "indexed", described: true, embedding: true,
      description: "Bruised cucumbers that drink up a garlicky, chili-crisp dressing — the 15-minute side that wakes up any rich main.",
      notes: [],
    },
    {
      slug: "red-wine-braised-short-ribs", title: "Red Wine Braised Short Ribs", protein: "beef", cuisine: "french", time: 210,
      course: ["main"], season: ["winter"], dietary: [], tags: ["special", "make-ahead"],
      ingredients: ["bone-in short ribs", "dry red wine", "carrot", "yellow onion", "thyme"],
      pairs_with: [], equipment: [], servings: 6, difficulty: "involved",
      source: "https://www.seriouseats.com/braised-short-ribs", status: "indexed", described: true, embedding: true,
      description: "Fork-tender short ribs braised low in red wine until the sauce turns glossy — make it a day ahead, it only improves.",
      notes: [
        N("dlo", "Made this for the dinner party — doubled the wine reduction, no regrets.", ["dinner-party"], false, 9),
        N("marcus", "Skipped the anchovy and it was still incredible.", [], false, 7),
      ],
    },
    {
      slug: "crispy-sheet-pan-chicken-thighs", title: "Crispy Sheet-Pan Chicken Thighs", protein: "chicken", cuisine: "american", time: 45,
      course: ["main"], season: [], dietary: ["gluten-free", "dairy-free"], tags: ["weeknight", "sheet-pan"],
      ingredients: ["bone-in chicken thighs", "baby potato", "lemon", "garlic", "rosemary"],
      pairs_with: [], equipment: [], servings: 4, difficulty: "easy",
      source: "https://www.bonappetit.com/sheet-pan-chicken", status: "indexed", described: true, embedding: true,
      description: "Crackly-skinned thighs and craggy potatoes off one hot sheet pan — the no-thinking-required weeknight standby.",
      notes: [],
    },
    {
      slug: "kimchi-fried-rice", title: "Kimchi Fried Rice", protein: "egg", cuisine: "korean", time: 20,
      course: ["main"], season: [], dietary: ["vegetarian"], tags: ["leftovers", "quick"],
      ingredients: ["day-old rice", "ripe kimchi", "egg", "scallion", "gochujang"],
      pairs_with: [], equipment: [], servings: 2, difficulty: "easy",
      source: null, status: "indexed", described: true, embedding: true,
      description: "The fridge-clearing dinner — sour kimchi fried into day-old rice and crowned with a runny egg.",
      notes: [N("casey", "Use the really sour kimchi from H-Mart. Game changer.", ["tip"], true, 3)],
    },
    {
      slug: "summer-tomato-galette", title: "Summer Tomato Galette", protein: "vegetarian", cuisine: "french", time: 75,
      course: ["main", "side"], season: ["summer"], dietary: ["vegetarian"], tags: ["seasonal", "weekend"],
      ingredients: ["heirloom tomato", "all-butter pastry", "gruyère", "basil", "dijon"],
      pairs_with: [], equipment: [], servings: 6, difficulty: "medium",
      source: "https://food52.com/tomato-galette", status: "indexed", described: true, embedding: true,
      description: "A free-form butter-crust galette that's really just an excuse for peak-season tomatoes and melty gruyère.",
      notes: [],
    },
    {
      slug: "coconut-shrimp-curry", title: "Coconut Shrimp Curry", protein: "shellfish", cuisine: "thai", time: 30,
      course: ["main"], season: [], dietary: ["gluten-free", "dairy-free"], tags: ["weeknight"],
      ingredients: ["large shrimp", "coconut milk", "red curry paste", "lime", "thai basil"],
      pairs_with: [], equipment: ["blender"], servings: 4, difficulty: "easy",
      source: "https://www.seriouseats.com/coconut-shrimp-curry", status: "indexed", described: true, embedding: true,
      description: "Shrimp poached in a fragrant coconut-curry base that comes together faster than rice cooks.",
      notes: [],
    },
    {
      slug: "classic-margherita-pizza", title: "Classic Margherita Pizza", protein: "vegetarian", cuisine: "italian", time: 90,
      course: ["main"], season: [], dietary: ["vegetarian"], tags: ["weekend", "project"],
      ingredients: ["pizza dough", "san marzano tomato", "fresh mozzarella", "basil", "olive oil"],
      pairs_with: [], equipment: [], servings: 2, difficulty: "medium",
      source: "https://www.kingarthurbaking.com/margherita", status: "indexed", described: true, embedding: true,
      description: "Blistered, bare-bones Naples-style pizza — good dough, great tomatoes, and a very hot oven.",
      notes: [],
    },
    {
      slug: "brown-butter-chocolate-chip-cookies", title: "Brown Butter Chocolate Chip Cookies", protein: "vegetarian", cuisine: "american", time: 40,
      course: ["dessert"], season: [], dietary: ["vegetarian"], tags: ["bake", "crowd-pleaser"],
      ingredients: ["brown butter", "all-purpose flour", "dark chocolate", "brown sugar", "egg"],
      pairs_with: [], equipment: [], servings: 24, difficulty: "easy",
      source: "https://www.bonappetit.com/brown-butter-cookies", status: "indexed", described: true, embedding: true,
      description: "Nutty brown-butter cookies with puddles of dark chocolate and a salt-flecked, chewy-crisp edge.",
      notes: [N("priya", "Chilled the dough overnight — worth it for the deeper flavor.", ["tip"], false, 14)],
    },
    {
      slug: "green-shakshuka", title: "Green Shakshuka", protein: "egg", cuisine: "mediterranean", time: 35,
      course: ["breakfast", "main"], season: ["spring"], dietary: ["vegetarian", "gluten-free"], tags: ["brunch"],
      ingredients: ["egg", "spinach", "leek", "feta", "cumin"],
      pairs_with: [], equipment: [], servings: 4, difficulty: "easy",
      source: "https://www.nytimes.com/cooking/green-shakshuka", status: "indexed", described: true, embedding: true,
      description: "Eggs poached in a bright, herby pool of greens and leeks — brunch that eats like spring.",
      notes: [],
    },
    {
      slug: "lemongrass-pork-banh-mi", title: "Lemongrass Pork Banh Mi", protein: "pork", cuisine: "vietnamese", time: 50,
      course: ["main"], season: [], dietary: ["dairy-free"], tags: ["sandwich"],
      ingredients: ["pork shoulder", "lemongrass", "pickled daikon", "cilantro", "baguette"],
      pairs_with: [], equipment: [], servings: 4, difficulty: "medium",
      source: "https://www.seriouseats.com/banh-mi", status: "indexed", described: true, embedding: true,
      description: "Caramelized lemongrass pork piled into a crackly baguette with quick pickles and a swipe of mayo.",
      notes: [],
    },
    {
      slug: "tuscan-white-bean-soup", title: "Tuscan White Bean Soup", protein: "vegan", cuisine: "italian", time: 40,
      course: ["soup", "main"], season: ["fall", "winter"], dietary: ["vegetarian", "vegan"], tags: ["cozy", "batch"],
      ingredients: ["cannellini bean", "lacinato kale", "garlic", "rosemary", "parmesan rind"],
      pairs_with: [], equipment: [], servings: 6, difficulty: "easy",
      source: null, status: "indexed", described: true, embedding: true,
      description: "A pantry soup that tastes slow-cooked — creamy beans, melted kale, and a parmesan rind doing the heavy lifting.",
      notes: [],
    },
    {
      slug: "mapo-tofu", title: "Mapo Tofu", protein: "tofu", cuisine: "chinese", time: 30,
      course: ["main"], season: [], dietary: ["vegetarian"], tags: ["weeknight", "spicy"],
      ingredients: ["silken tofu", "doubanjiang", "sichuan peppercorn", "scallion", "garlic"],
      pairs_with: [], equipment: [], servings: 4, difficulty: "medium",
      source: "https://thewoksoflife.com/mapo-tofu", status: "indexed", described: true, embedding: true,
      description: "Silky tofu in a numbing, brick-red sauce — the 30-minute version that still tastes like Chengdu.",
      notes: [],
    },
    {
      slug: "miso-glazed-eggplant-donburi", title: "Miso-Glazed Eggplant Donburi", protein: "vegan", cuisine: "japanese", time: 35,
      course: ["main"], season: ["summer", "fall"], dietary: ["vegetarian", "vegan"], tags: ["rice-bowl"],
      ingredients: ["japanese eggplant", "white miso", "mirin", "steamed rice", "scallion"],
      pairs_with: [], equipment: [], servings: 2, difficulty: "easy",
      source: "https://www.justonecookbook.com/nasu-dengaku-donburi", status: "indexed", described: false, embedding: false,
      description: null,
      notes: [],
    },
    {
      slug: "herby-spring-grain-bowl", title: "Herby Spring Grain Bowl", protein: "vegan", cuisine: "mediterranean", time: 30,
      course: ["main", "salad"], season: ["spring"], dietary: ["vegetarian", "vegan"], tags: ["meal-prep", "lunch"],
      ingredients: ["farro", "asparagus", "english pea", "mint", "lemon"],
      pairs_with: [], equipment: [], servings: 4, difficulty: "easy",
      source: "https://cookieandkate.com/spring-grain-bowl", status: "indexed", described: true, embedding: true,
      description: "Chewy farro tossed with blanched spring vegetables and a fistful of herbs — a lunch that keeps for days.",
      notes: [],
    },
    {
      slug: "spiced-lamb-meatballs", title: "Spiced Lamb Meatballs", protein: "lamb", cuisine: "mediterranean", time: 45,
      course: ["main"], season: [], dietary: [], tags: ["dinner-party"],
      ingredients: ["ground lamb", "cumin", "mint", "garlic yogurt", "pine nut"],
      pairs_with: [], equipment: [], servings: 4, difficulty: "medium",
      source: "https://www.bonappetit.com/lamb-meatballs", status: "skipped", described: false, embedding: false,
      description: null,
      reconcile_message: "`time_total` must be a number or `null` (got \"45 min\")",
      notes: [],
    },
    {
      slug: "chicken-tortilla-soup", title: "Chicken Tortilla Soup", protein: "chicken", cuisine: "mexican", time: 50,
      course: ["soup", "main"], season: ["fall", "winter"], dietary: ["gluten-free", "dairy-free"], tags: ["cozy", "batch"],
      ingredients: ["chicken thigh", "fire-roasted tomato", "corn tortilla", "lime", "avocado"],
      pairs_with: [], equipment: [], servings: 6, difficulty: "easy",
      source: "https://www.gimmesomeoven.com/tortilla-soup", status: "skipped", described: false, embedding: false,
      description: null,
      reconcile_message: "`requires_equipment` \"instant-pot\" is not in the controlled vocabulary (one of pressure-cooker | sous-vide-circulator | blender | ice-cream-maker)",
      notes: [],
    },
    {
      slug: "grandmas-apple-cake", title: "Grandma's Apple Cake", protein: "vegetarian", cuisine: "american", time: 80,
      course: ["dessert"], season: ["fall"], dietary: ["vegetarian"], tags: ["heritage"],
      ingredients: ["honeycrisp apple", "cinnamon", "all-purpose flour", "egg", "butter"],
      pairs_with: [], equipment: [], servings: 12, difficulty: "easy",
      source: null, status: "pending", described: false, embedding: false,
      description: null,
      notes: [],
    },
    {
      slug: "leftover-veggie-frittata", title: "Leftover Veggie Frittata", protein: "egg", cuisine: "american", time: 25,
      course: ["breakfast", "main"], season: [], dietary: ["vegetarian", "gluten-free"], tags: ["leftovers"],
      ingredients: ["egg", "roasted vegetable", "cheddar", "herb", "olive oil"],
      pairs_with: [], equipment: [], servings: 4, difficulty: "easy",
      source: null, status: "orphaned", described: true, embedding: true,
      description: "The catch-all brunch that turns last night's roasted vegetables into a golden, sliceable frittata.",
      notes: [],
    },
  ];

  // ---- derived helpers --------------------------------------------------------

  function relAge(ms) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    const d = Math.floor(s / 86400);
    if (d < 14) return `${d}d ago`;
    if (d < 60) return `${Math.floor(d / 7)}w ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }

  function perishableOf(r) {
    // Fresh items the agent flags for the grocery list — the produce/protein/dairy subset.
    const fresh = ["salmon", "cucumber", "carrot", "onion", "potato", "lemon", "lime", "scallion", "tomato", "basil",
      "spinach", "leek", "feta", "kale", "egg", "shrimp", "pork", "chicken", "lamb", "eggplant", "asparagus", "pea",
      "mozzarella", "gruyère", "apple", "kimchi", "ginger", "cilantro", "mint", "tofu", "avocado", "vegetable", "herb"];
    return r.ingredients.filter((i) => fresh.some((f) => i.includes(f)));
  }

  // The authored R2 frontmatter object (what lives at the top of recipes/<slug>.md).
  function frontmatterOf(r) {
    return {
      title: r.title,
      source: r.source,
      time_total: r.time,
      servings: r.servings,
      dietary: r.dietary,
      requires_equipment: r.equipment,
      pairs_with: r.pairs_with,
      protein: r.protein,
      cuisine: r.cuisine,
      course: r.course,
      season: r.season,
      tags: r.tags,
      ingredients_key: r.ingredients,
    };
  }

  // The D1 `recipes` projection row (the queryable index columns).
  function projectionOf(r) {
    if (r.status === "pending" || r.status === "skipped") return null;
    return {
      slug: r.slug,
      title: r.title,
      protein: r.protein,
      cuisine: r.cuisine,
      time_total: r.time,
      ingredients_key: r.ingredients,
      source_url: r.source,
      tags: r.tags,
      course: r.course,
      season: r.season,
      dietary: r.dietary,
      pairs_with: r.pairs_with,
      perishable_ingredients: perishableOf(r),
      requires_equipment: r.equipment,
      extra: { servings: r.servings, difficulty: r.difficulty },
    };
  }

  // The recipe body (markdown, no frontmatter) — generated from the facets.
  function bodyOf(r) {
    const ing = r.ingredients.map((i) => `- ${i}`).join("\n");
    const lead = r.description || `${r.title} — a ${r.cuisine} ${r.course[0]} that comes together in about ${r.time} minutes.`;
    return [
      lead,
      "",
      "## Ingredients",
      ing,
      "- kosher salt and freshly ground black pepper",
      "",
      "## Method",
      `1. Prep the ${r.ingredients[0]} and aromatics; season well.`,
      `2. Build the base — cook the ${r.ingredients[1] || "aromatics"} until fragrant and deeply colored.`,
      `3. Add the remaining ingredients and cook through, tasting as you go.`,
      `4. Finish with ${r.ingredients[r.ingredients.length - 1]} and serve. (About ${r.time} minutes start to finish, serves ${r.servings}.)`,
    ].join("\n");
  }

  // The raw R2 object: YAML frontmatter fence + body (what the collapsible panel shows).
  function rawMarkdownOf(r) {
    if (r.status === "orphaned") return null; // source object is gone
    const fm = frontmatterOf(r);
    const yamlVal = (v) => {
      if (v === null) return "null";
      if (Array.isArray(v)) return v.length ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : "[]";
      if (typeof v === "string") return /[:#]/.test(v) ? JSON.stringify(v) : v;
      return String(v);
    };
    const lines = Object.entries(fm).map(([k, v]) => `${k}: ${yamlVal(v)}`);
    return `---\n${lines.join("\n")}\n---\n\n${bodyOf(r)}\n`;
  }

  // ---- search -----------------------------------------------------------------

  function tokenize(q) {
    return q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }
  function keywordHaystack(r) {
    return [r.title, r.slug, r.protein, r.cuisine, ...r.course, ...r.tags, ...r.ingredients].join(" ").toLowerCase();
  }
  function vibeHaystack(r) {
    return [r.description || "", r.cuisine, ...r.season, ...r.tags, ...r.course, r.difficulty].join(" ").toLowerCase();
  }

  // Keyword: every token must substring-match the indexed metadata (AND).
  // Hybrid: keyword score blended with a "vibe" overlap over the description/season/
  // mood, so semantically-related recipes surface even without a literal keyword hit.
  function searchRecipes(query, mode) {
    const q = query.trim();
    if (!q) return recipes.map((r) => ({ r, score: null, semantic: false }));
    const tokens = tokenize(q);
    const out = [];
    for (const r of recipes) {
      const hay = keywordHaystack(r);
      const matched = tokens.filter((t) => hay.includes(t)).length;
      const kwAll = matched === tokens.length;
      const kwFrac = matched / tokens.length;
      if (mode === "keyword") {
        if (kwAll) out.push({ r, score: null, semantic: false });
      } else {
        const vibe = vibeHaystack(r);
        const vibeMatched = tokens.filter((t) => vibe.includes(t)).length / tokens.length;
        const score = Math.min(1, kwFrac * 0.7 + vibeMatched * 0.45);
        if (score >= 0.18) out.push({ r, score, semantic: !kwAll && vibeMatched > 0 });
      }
    }
    if (mode === "hybrid") out.sort((a, b) => b.score - a.score);
    return out;
  }

  window.GA.recipes = recipes;
  window.GA.recipesApi = { relAge, frontmatterOf, projectionOf, bodyOf, rawMarkdownOf, searchRecipes, perishableOf };
})();
