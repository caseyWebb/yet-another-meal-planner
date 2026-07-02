/* Flyer dataset for the Data › Flyer explorer — the current weekly Kroger
   flyer, per store, as pulled + embedded by the flyer-warm job (see
   Status/Logs). Grounded in the real pipeline: the warm re-pulls each Kroger
   location's weekly circular (KROGER_KV flyer cache), filters items below the
   min-discount knob, embeds them in batches, and taste-matches each deal
   against the member roster + recipe corpus so surfaced deals are actionable.
   Only Kroger-chain locations have a flyer (others don't expose a circular
   API). Prices/deals are illustrative. */
(function () {
  window.GA = window.GA || {};
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  const now = Date.now();

  const CATEGORIES = ["Meat & Seafood", "Produce", "Dairy & Eggs", "Pantry", "Frozen", "Bakery", "Beverages"];

  let seq = 0;
  // it(name, brand, category, unit, reg, sale, opts?)
  //   opts.term    — the flyer search term that surfaced it (Config › Flyer terms)
  //   opts.sku     — Kroger SKU (cached)
  //   opts.members — taste attribution [{tenant, score}]
  //   opts.recipes — matched recipe slugs (deep-link to Data › Recipes)
  //   opts.tag     — "mega deal" | "digital" | "limit" style circular callout
  function it(name, brand, category, unit, reg, sale, opts) {
    seq += 1;
    const o = opts || {};
    return {
      id: "fl_" + String(seq).padStart(3, "0"),
      name, brand, category, unit,
      reg, sale,
      discount: (reg - sale) / reg,
      sku: o.sku || null,
      term: o.term || null,
      tag: o.tag || null,
      members: o.members || [],
      recipes: o.recipes || [],
    };
  }

  // ── Kroger – Hyde Park (the big store, location 01400412) ──────────────────
  const hydePark = [
    it("Boneless Skinless Chicken Thighs", "Simple Truth", "Meat & Seafood", "per lb", 4.99, 2.99, { term: "boneless chicken thighs", sku: "0001111001234", tag: "mega deal", members: [{ tenant: "casey", score: 0.74 }, { tenant: "marcus", score: 0.66 }], recipes: ["crispy-sheet-pan-chicken-thighs", "chicken-tortilla-soup"] }),
    it("Ground Beef 80/20", "Kroger", "Meat & Seafood", "per lb", 5.49, 3.99, { term: "ground beef 80/20", sku: "0001111060900", members: [{ tenant: "marcus", score: 0.61 }] }),
    it("Atlantic Salmon Fillet", "Private Selection", "Meat & Seafood", "per lb", 12.99, 8.99, { sku: "0001111041700", tag: "digital", members: [{ tenant: "dlo", score: 0.69 }, { tenant: "casey", score: 0.63 }], recipes: ["miso-butter-salmon"] }),
    it("Bone-In Short Ribs", "Private Selection", "Meat & Seafood", "per lb", 9.99, 7.49, { members: [{ tenant: "casey", score: 0.58 }], recipes: ["red-wine-braised-short-ribs"] }),
    it("Large Raw Shrimp 26/30", "Kroger", "Meat & Seafood", "12 oz bag", 8.99, 6.49, { tag: "digital", members: [{ tenant: "priya", score: 0.6 }], recipes: ["coconut-shrimp-curry"] }),
    it("Pork Shoulder Roast", "Kroger", "Meat & Seafood", "per lb", 3.49, 1.99, { tag: "mega deal", recipes: ["lemongrass-pork-banh-mi"] }),
    it("Russet Potatoes", "Simple Truth", "Produce", "5 lb bag", 4.49, 2.99, { term: "russet potatoes", members: [{ tenant: "marcus", score: 0.55 }], recipes: ["crispy-sheet-pan-chicken-thighs"] }),
    it("Yellow Onions", "Kroger", "Produce", "3 lb bag", 3.29, 1.99, { term: "yellow onions", recipes: ["red-wine-braised-short-ribs"] }),
    it("Roma Tomatoes", "Kroger", "Produce", "per lb", 1.99, 0.99, { term: "roma tomatoes", tag: "limit 4", recipes: ["summer-tomato-galette"] }),
    it("Persian Cucumbers", "Simple Truth", "Produce", "16 oz", 3.99, 2.49, { members: [{ tenant: "sage", score: 0.57 }], recipes: ["smashed-cucumber-salad"] }),
    it("Honeycrisp Apples", "Simple Truth Organic", "Produce", "per lb", 2.99, 1.49, { tag: "mega deal", recipes: ["grandmas-apple-cake"] }),
    it("Lacinato Kale", "Simple Truth Organic", "Produce", "bunch", 2.49, 1.49, { recipes: ["tuscan-white-bean-soup"] }),
    it("Fresh Ginger", "Kroger", "Produce", "per lb", 4.99, 2.99, { recipes: ["weeknight-red-lentil-dal"] }),
    it("Lemons", "Kroger", "Produce", "2 lb bag", 4.49, 2.99, { recipes: ["crispy-sheet-pan-chicken-thighs", "herby-spring-grain-bowl"] }),
    it("Baby Spinach", "Simple Truth Organic", "Produce", "16 oz", 4.99, 3.49, { recipes: ["green-shakshuka"] }),
    it("Block Sharp Cheddar", "Kroger", "Dairy & Eggs", "8 oz", 3.99, 2.49, { term: "block cheddar", members: [{ tenant: "tomk", score: 0.52 }], recipes: ["leftover-veggie-frittata"] }),
    it("Large Grade A Eggs", "Simple Truth", "Dairy & Eggs", "dozen", 4.29, 2.99, { tag: "digital", recipes: ["kimchi-fried-rice", "green-shakshuka", "leftover-veggie-frittata"] }),
    it("Unsalted Butter", "Kroger", "Dairy & Eggs", "1 lb", 5.49, 3.99, { sku: "0001111060842", members: [{ tenant: "casey", score: 0.5 }], recipes: ["miso-butter-salmon", "brown-butter-chocolate-chip-cookies"] }),
    it("Whole Milk", "Simple Truth", "Dairy & Eggs", "gallon", 4.19, 2.99, {}),
    it("Fresh Mozzarella", "Private Selection", "Dairy & Eggs", "8 oz", 5.99, 3.99, { recipes: ["classic-margherita-pizza"] }),
    it("Plain Whole-Milk Yogurt", "Simple Truth", "Dairy & Eggs", "32 oz", 4.99, 3.49, { recipes: ["spiced-lamb-meatballs"] }),
    it("Extra Virgin Olive Oil", "Private Selection", "Pantry", "16.9 oz", 9.99, 6.99, { term: "olive oil", tag: "digital", members: [{ tenant: "ortega", score: 0.54 }], recipes: ["classic-margherita-pizza", "herby-spring-grain-bowl"] }),
    it("Canned Chickpeas", "Kroger", "Pantry", "15.5 oz", 1.29, 0.79, { term: "canned chickpeas", tag: "limit 6", recipes: ["herby-spring-grain-bowl"] }),
    it("Coconut Milk", "Thai Kitchen", "Pantry", "13.66 oz", 2.99, 1.99, { sku: "0004118200030", members: [{ tenant: "priya", score: 0.59 }], recipes: ["weeknight-red-lentil-dal", "coconut-shrimp-curry"] }),
    it("Dried Pasta", "De Cecco", "Pantry", "1 lb", 2.49, 1.49, { term: "pasta", tag: "mega deal", members: [{ tenant: "sage", score: 0.51 }] }),
    it("White Miso Paste", "Hikari Organic", "Pantry", "17.6 oz", 7.99, 5.99, { sku: "0007373100123", recipes: ["miso-butter-salmon", "miso-glazed-eggplant-donburi"] }),
    it("Cannellini Beans", "Kroger", "Pantry", "15.5 oz", 1.49, 0.89, { recipes: ["tuscan-white-bean-soup"] }),
    it("Red Lentils", "Simple Truth Organic", "Pantry", "16 oz", 3.49, 2.29, { recipes: ["weeknight-red-lentil-dal"] }),
    it("Jasmine Rice", "Mahatma", "Pantry", "5 lb", 8.99, 5.99, { sku: "0001600018621", recipes: ["miso-butter-salmon", "kimchi-fried-rice"] }),
    it("All-Purpose Flour", "Kroger", "Pantry", "5 lb", 3.49, 2.49, { recipes: ["brown-butter-chocolate-chip-cookies", "grandmas-apple-cake"] }),
    it("Frozen Peas", "Simple Truth", "Frozen", "16 oz", 2.49, 1.49, { term: "frozen peas", recipes: ["herby-spring-grain-bowl"] }),
    it("Frozen Pizza Dough Balls", "Private Selection", "Frozen", "2 ct", 4.99, 3.49, { recipes: ["classic-margherita-pizza"] }),
    it("Artisan Sourdough Boule", "Private Selection", "Bakery", "24 oz", 5.49, 3.99, { tag: "digital", members: [{ tenant: "bex", score: 0.5 }] }),
    it("French Baguette", "Kroger Bakery", "Bakery", "each", 2.49, 1.49, { recipes: ["lemongrass-pork-banh-mi"] }),
    it("Dry Red Wine (Cotes du Rhone)", "Private Selection", "Beverages", "750 ml", 13.99, 9.99, { tag: "digital", recipes: ["red-wine-braised-short-ribs"] }),
    it("Sparkling Water 12pk", "Kroger", "Beverages", "12 x 12 oz", 5.49, 3.99, {}),
  ];

  // ── Kroger – Clifton (the small store, location 01400388) ──────────────────
  const clifton = [
    it("Boneless Skinless Chicken Thighs", "Simple Truth", "Meat & Seafood", "per lb", 4.99, 3.49, { term: "boneless chicken thighs", tag: "digital", members: [{ tenant: "priya", score: 0.62 }], recipes: ["crispy-sheet-pan-chicken-thighs"] }),
    it("Ground Beef 80/20", "Kroger", "Meat & Seafood", "per lb", 5.49, 4.29, { term: "ground beef 80/20", members: [{ tenant: "marcus", score: 0.57 }] }),
    it("Chicken Drumsticks", "Kroger", "Meat & Seafood", "per lb", 2.49, 1.29, { tag: "mega deal", recipes: ["chicken-tortilla-soup"] }),
    it("Roma Tomatoes", "Kroger", "Produce", "per lb", 1.99, 1.19, { term: "roma tomatoes", recipes: ["summer-tomato-galette"] }),
    it("Yellow Onions", "Kroger", "Produce", "3 lb bag", 3.29, 2.29, { term: "yellow onions" }),
    it("Russet Potatoes", "Simple Truth", "Produce", "5 lb bag", 4.49, 3.29, { term: "russet potatoes" }),
    it("Bananas", "Kroger", "Produce", "per lb", 0.69, 0.49, { tag: "limit 5" }),
    it("Baby Spinach", "Simple Truth", "Produce", "10 oz", 3.99, 2.99, { recipes: ["green-shakshuka"] }),
    it("Garlic", "Kroger", "Produce", "3 ct", 1.99, 1.29, { recipes: ["smashed-cucumber-salad", "mapo-tofu"] }),
    it("Large Grade A Eggs", "Kroger", "Dairy & Eggs", "dozen", 4.29, 3.29, { tag: "digital", recipes: ["kimchi-fried-rice", "leftover-veggie-frittata"] }),
    it("Block Sharp Cheddar", "Kroger", "Dairy & Eggs", "8 oz", 3.99, 2.99, { term: "block cheddar", recipes: ["leftover-veggie-frittata"] }),
    it("Salted Butter", "Kroger", "Dairy & Eggs", "1 lb", 5.49, 4.29, {}),
    it("Canned Tomatoes", "Kroger", "Pantry", "28 oz", 2.29, 1.29, { sku: "0001111090421", tag: "mega deal", members: [{ tenant: "sage", score: 0.53 }], recipes: ["chicken-tortilla-soup"] }),
    it("Canned Chickpeas", "Goya", "Pantry", "15.5 oz", 1.29, 0.89, { term: "canned chickpeas", sku: "0007089033111", recipes: ["herby-spring-grain-bowl"] }),
    it("Dried Pasta", "De Cecco", "Pantry", "1 lb", 2.49, 1.79, { term: "pasta", sku: "0007680850201" }),
    it("Extra Virgin Olive Oil", "California Olive Ranch", "Pantry", "16.9 oz", 9.99, 7.49, { term: "olive oil", sku: "0007349100110" }),
    it("Silken Tofu", "House Foods", "Pantry", "14 oz", 2.49, 1.79, { recipes: ["mapo-tofu"] }),
    it("Frozen Peas", "Kroger", "Frozen", "16 oz", 2.49, 1.79, { term: "frozen peas" }),
    it("Sandwich Bread", "Kroger Bakery", "Bakery", "20 oz", 2.99, 1.99, {}),
    it("Orange Juice", "Simple Truth", "Beverages", "52 oz", 4.49, 3.29, {}),
  ];

  // A store's flyer window + warm metadata. Only Kroger locations have one.
  function flyerFor(items, ageMin) {
    const total = items.length;
    const matched = items.filter((i) => i.members.length || i.recipes.length).length;
    const termHits = items.filter((i) => i.term).length;
    const best = items.reduce((m, i) => Math.max(m, i.discount), 0);
    return {
      validFrom: now - 2 * DAY,
      validTo: now + 5 * DAY,
      warmedAt: now - ageMin * MIN,
      items,
      stats: { total, matched, termHits, bestDiscount: best },
    };
  }

  const stores = [
    { slug: "kroger-hyde-park", name: "Kroger \u2013 Hyde Park", label: "the big Kroger", location_id: "01400412", ...flyerFor(hydePark, 74) },
    { slug: "kroger-clifton", name: "Kroger \u2013 Clifton", label: "the small Kroger", location_id: "01400388", ...flyerFor(clifton, 138) },
  ];

  function relAge(ms) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function fmtDate(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function money(n) {
    return "$" + n.toFixed(2);
  }

  window.GA.flyer = {
    stores,
    categories: CATEGORIES,
    relAge, fmtDate, money,
  };
})();
