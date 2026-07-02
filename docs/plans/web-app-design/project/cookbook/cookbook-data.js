/* Cookbook corpus for the redesign prototype.
   Mirrors the SHARED recipe index the Worker serves at /cookbook: each row is the
   metadata the cookbook actually exposes — slug, title, protein, cuisine, an AI
   description (may be null), a time, ingredients, and an optional source URL.
   Bodies are generated client-side here only to stand in for the R2 markdown the
   real recipe page renders. Pure data + helpers; no framework. */
(function () {
  const RECIPES = [
    { slug: "miso-butter-salmon", title: "Miso Butter Salmon", protein: "fish", cuisine: "japanese", time: 25, servings: 4,
      ingredients: ["salmon fillet", "white miso", "unsalted butter", "scallion", "steamed rice"],
      source: "https://www.nytimes.com/cooking/miso-butter-salmon",
      description: "Sheet-pan salmon lacquered in sweet-salty miso butter — 25 minutes, mostly hands-off, the broiler does the work.",
      notes: [
        { author: "casey", body: "Broiled the last 2 minutes for a real crust. Easily a weeknight 4-star.", tag: "tip", days: 5 },
      ] },
    { slug: "weeknight-red-lentil-dal", title: "Weeknight Red Lentil Dal", protein: "vegan", cuisine: "indian", time: 35, servings: 6,
      ingredients: ["red lentils", "coconut milk", "fresh ginger", "garlic", "cumin"],
      source: "https://smittenkitchen.com/red-lentil-dal",
      description: "A cozy, freezer-friendly red lentil dal that simmers itself silky in one pot — the default cold-night dinner.",
      notes: [
        { author: "sage", body: "Freezes beautifully in single portions — I always double it.", tag: "meal-prep", days: 12 },
      ] },
    { slug: "smashed-cucumber-salad", title: "Smashed Cucumber Salad", protein: "vegan", cuisine: "chinese", time: 15, servings: 4,
      ingredients: ["persian cucumber", "garlic", "soy sauce", "chili crisp", "toasted sesame"],
      source: null,
      description: "Bruised cucumbers that drink up a garlicky, chili-crisp dressing — the 15-minute side that wakes up any rich main." },
    { slug: "red-wine-braised-short-ribs", title: "Red Wine Braised Short Ribs", protein: "beef", cuisine: "french", time: 210, servings: 6,
      ingredients: ["bone-in short ribs", "dry red wine", "carrot", "yellow onion", "thyme"],
      source: "https://www.seriouseats.com/braised-short-ribs",
      description: "Fork-tender short ribs braised low in red wine until the sauce turns glossy — make it a day ahead, it only improves.",
      notes: [
        { author: "dlo", body: "Made this for a dinner party; doubled the wine reduction, no regrets.", tag: "dinner-party", days: 9 },
        { author: "marcus", body: "Skipped the anchovy and it was still incredible.", days: 7 },
      ] },
    { slug: "crispy-sheet-pan-chicken-thighs", title: "Crispy Sheet-Pan Chicken Thighs", protein: "chicken", cuisine: "american", time: 45, servings: 4,
      ingredients: ["bone-in chicken thighs", "baby potato", "lemon", "garlic", "rosemary"],
      source: "https://www.bonappetit.com/sheet-pan-chicken",
      description: "Crackly-skinned thighs and craggy potatoes off one hot sheet pan — the no-thinking-required weeknight standby." },
    { slug: "kimchi-fried-rice", title: "Kimchi Fried Rice", protein: "egg", cuisine: "korean", time: 20, servings: 2,
      ingredients: ["day-old rice", "ripe kimchi", "egg", "scallion", "gochujang"],
      source: null,
      description: "The fridge-clearing dinner — sour kimchi fried into day-old rice and crowned with a runny egg." },
    { slug: "summer-tomato-galette", title: "Summer Tomato Galette", protein: "vegetarian", cuisine: "french", time: 75, servings: 6,
      ingredients: ["heirloom tomato", "all-butter pastry", "gruyère", "basil", "dijon"],
      source: "https://food52.com/tomato-galette",
      description: "A free-form butter-crust galette that's really just an excuse for peak-season tomatoes and melty gruyère." },
    { slug: "coconut-shrimp-curry", title: "Coconut Shrimp Curry", protein: "shellfish", cuisine: "thai", time: 30, servings: 4,
      ingredients: ["large shrimp", "coconut milk", "red curry paste", "lime", "thai basil"],
      source: "https://www.seriouseats.com/coconut-shrimp-curry",
      description: "Shrimp poached in a fragrant coconut-curry base that comes together faster than rice cooks." },
    { slug: "classic-margherita-pizza", title: "Classic Margherita Pizza", protein: "vegetarian", cuisine: "italian", time: 90, servings: 2,
      ingredients: ["pizza dough", "san marzano tomato", "fresh mozzarella", "basil", "olive oil"],
      source: "https://www.kingarthurbaking.com/margherita",
      description: "Blistered, bare-bones Naples-style pizza — good dough, great tomatoes, and a very hot oven." },
    { slug: "brown-butter-chocolate-chip-cookies", title: "Brown Butter Chocolate Chip Cookies", protein: "vegetarian", cuisine: "american", time: 40, servings: 24,
      ingredients: ["brown butter", "all-purpose flour", "dark chocolate", "brown sugar", "egg"],
      source: "https://www.bonappetit.com/brown-butter-cookies",
      description: "Nutty brown-butter cookies with puddles of dark chocolate and a salt-flecked, chewy-crisp edge.",
      notes: [
        { author: "priya", body: "Chilled the dough overnight — worth it for the deeper flavor.", tag: "tip", days: 14 },
        { author: "marcus", body: "Pulled them 2 minutes early so the centers stay gooey. Trust the carryover.", days: 6 },
      ] },
    { slug: "green-shakshuka", title: "Green Shakshuka", protein: "egg", cuisine: "mediterranean", time: 35, servings: 4,
      ingredients: ["egg", "spinach", "leek", "feta", "cumin"],
      source: "https://www.nytimes.com/cooking/green-shakshuka",
      description: "Eggs poached in a bright, herby pool of greens and leeks — brunch that eats like spring." },
    { slug: "lemongrass-pork-banh-mi", title: "Lemongrass Pork Banh Mi", protein: "pork", cuisine: "vietnamese", time: 50, servings: 4,
      ingredients: ["pork shoulder", "lemongrass", "pickled daikon", "cilantro", "baguette"],
      source: "https://www.seriouseats.com/banh-mi",
      description: "Caramelized lemongrass pork piled into a crackly baguette with quick pickles and a swipe of mayo." },
    { slug: "tuscan-white-bean-soup", title: "Tuscan White Bean Soup", protein: "vegan", cuisine: "italian", time: 40, servings: 6,
      ingredients: ["cannellini bean", "lacinato kale", "garlic", "rosemary", "parmesan rind"],
      source: null,
      description: "A pantry soup that tastes slow-cooked — creamy beans, melted kale, and a parmesan rind doing the heavy lifting." },
    { slug: "mapo-tofu", title: "Mapo Tofu", protein: "tofu", cuisine: "chinese", time: 30, servings: 4,
      ingredients: ["silken tofu", "doubanjiang", "sichuan peppercorn", "scallion", "garlic"],
      source: "https://thewoksoflife.com/mapo-tofu",
      description: "Silky tofu in a numbing, brick-red sauce — the 30-minute version that still tastes like Chengdu." },
    { slug: "miso-glazed-eggplant-donburi", title: "Miso-Glazed Eggplant Donburi", protein: "vegan", cuisine: "japanese", time: 35, servings: 2,
      ingredients: ["japanese eggplant", "white miso", "mirin", "steamed rice", "scallion"],
      source: "https://www.justonecookbook.com/nasu-dengaku-donburi",
      description: null },
    { slug: "herby-spring-grain-bowl", title: "Herby Spring Grain Bowl", protein: "vegan", cuisine: "mediterranean", time: 30, servings: 4,
      ingredients: ["farro", "asparagus", "english pea", "mint", "lemon"],
      source: "https://cookieandkate.com/spring-grain-bowl",
      description: "Chewy farro tossed with blanched spring vegetables and a fistful of herbs — a lunch that keeps for days." },
  ];

  const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  // Keyword ranking that mirrors the Worker's cookbook-search intent: title/slug
  // hits weigh most, then protein/cuisine, then description, then ingredients.
  function rank(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/);
    const scored = [];
    for (const r of RECIPES) {
      const hay = {
        title: r.title.toLowerCase(),
        slug: r.slug.toLowerCase(),
        facet: (r.protein + " " + r.cuisine).toLowerCase(),
        desc: (r.description || "").toLowerCase(),
        ing: r.ingredients.join(" ").toLowerCase(),
      };
      let score = 0;
      for (const t of terms) {
        if (hay.title.includes(t)) score += 10;
        if (hay.slug.includes(t)) score += 6;
        if (hay.facet.includes(t)) score += 5;
        if (hay.desc.includes(t)) score += 3;
        if (hay.ing.includes(t)) score += 2;
      }
      if (score > 0) scored.push({ r, score });
    }
    scored.sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title));
    return scored.map((s) => s.r);
  }

  // Recipe→recipe "Similar recipes": stands in for the cosine-over-embeddings the
  // Worker runs. Scores shared cuisine / protein / time band, top 4.
  function similar(slug) {
    const me = RECIPES.find((r) => r.slug === slug);
    if (!me) return [];
    const scored = RECIPES.filter((r) => r.slug !== slug).map((r) => {
      let s = 0;
      if (r.cuisine === me.cuisine) s += 3;
      if (r.protein === me.protein) s += 3;
      if (Math.abs(r.time - me.time) <= 15) s += 1;
      return { r, s };
    });
    scored.sort((a, b) => b.s - a.s || a.r.title.localeCompare(b.r.title));
    return scored.filter((x) => x.s > 0).slice(0, 4).map((x) => x.r);
  }

  function sortedIndex() {
    return [...RECIPES].sort((a, b) => a.title.localeCompare(b.title));
  }

  // Stand-in body for the recipe page (the real one is R2 markdown rendered server-side).
  function body(r) {
    const lead = r.description ||
      `${r.title} — pulled into the cookbook from its source. An AI summary hasn't been generated for this one yet.`;
    const ing = r.ingredients.map((i) => `<li>${cap(i)}</li>`).join("");
    const a = r.ingredients;
    const steps = [
      `Prep your mise en place: ${a[0]}, ${a[1]}, and ${a[2]} ready to go before the pan is hot.`,
      `Build the base — cook ${a[1]} until fragrant, then add ${a[0]} and let it take on color and flavor.`,
      `Bring it together with ${a[3]}${a[4] ? `, finish with ${a[4]},` : ""} taste for salt, and serve.`,
    ].map((s) => `<li>${s}</li>`).join("");
    return `
      <p>${lead}</p>
      <h2>Ingredients</h2>
      <ul>${ing}</ul>
      <h2>Method</h2>
      <ol>${steps}</ol>
      <p class="cb-note">Serves ${r.servings} · about ${r.time} minutes. Adjust seasoning to taste; lightly edited for the cookbook.</p>`;
  }

  // Relative time for member notes ("5d ago", "2w ago", "3mo ago").
  function relTime(days) {
    if (days < 1) return "today";
    if (days < 14) return `${days}d ago`;
    if (days < 60) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  window.CB = { RECIPES, rank, similar, sortedIndex, body, cap, relTime, bySlug: (s) => RECIPES.find((r) => r.slug === s) };
})();
