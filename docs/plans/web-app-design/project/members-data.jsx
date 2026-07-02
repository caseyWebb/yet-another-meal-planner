/* Shared member roster for the grocery-agent admin — a friend-group of people
   who each connected their Claude.ai to this grocery agent, some with a linked
   Kroger account. Read by the Members screen (the roster + per-member actions)
   and by the Status screen's "Members" count tile (kept in sync via length).
   The system is username-only (a tenant id) — no real name or email is stored:
   invite status, the optional Kroger link, and tenant-clean activity counts. */
(function () {
  window.GA = window.GA || {};

  const DAY = 86_400_000;
  const now = Date.now();
  const ago = (d) => now - d * DAY;

  // status: active | pending   ·   kroger: linked | unlinked | pending
  const members = [
    { user: "casey", owner: true, status: "active", kroger: "linked", joined: ago(214), lastActive: ago(0), cooked: 86, favorites: 41 },
    { user: "dlo", status: "active", kroger: "linked", joined: ago(168), lastActive: ago(1), cooked: 52, favorites: 33 },
    { user: "marcus", status: "active", kroger: "linked", joined: ago(151), lastActive: ago(0), cooked: 47, favorites: 19 },
    { user: "priya", status: "active", kroger: "unlinked", joined: ago(132), lastActive: ago(3), cooked: 38, favorites: 22 },
    { user: "tomk", status: "active", kroger: "linked", joined: ago(120), lastActive: ago(2), cooked: 31, favorites: 12 },
    { user: "sage", status: "active", kroger: "linked", joined: ago(98), lastActive: ago(0), cooked: 44, favorites: 28 },
    { user: "bex", status: "active", kroger: "unlinked", joined: ago(73), lastActive: ago(6), cooked: 17, favorites: 9 },
    { user: "ortega", status: "active", kroger: "linked", joined: ago(55), lastActive: ago(1), cooked: 23, favorites: 15 },
    { user: "ravi", status: "active", kroger: "linked", joined: ago(40), lastActive: ago(4), cooked: 12, favorites: 6 },
    { user: "noor", status: "pending", kroger: "pending", joined: null, invited: ago(2), cooked: 0, favorites: 0 },
    { user: "jules", status: "pending", kroger: "pending", joined: null, invited: ago(5), cooked: 0, favorites: 0 },
    { user: "wyn", status: "pending", kroger: "pending", joined: null, invited: ago(11), cooked: 0, favorites: 0 },
  ];

  function relAge(ms) {
    if (ms == null) return "—";
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    const d = Math.floor(s / 86400);
    if (d < 14) return `${d}d ago`;
    if (d < 60) return `${Math.floor(d / 7)}w ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }

  // ---- per-member detail (profile · pantry · meal plan · grocery · cooking log · notes) ----

  function rngOf(str) {
    let s = 0;
    for (let i = 0; i < str.length; i++) s = (s * 131 + str.charCodeAt(i)) >>> 0;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  const PANTRY_POOL = [
    ["olive oil", "oil", "1 bottle"], ["kosher salt", "seasoning", "full"], ["garlic", "produce", "1 head"],
    ["yellow onion", "produce", "3"], ["eggs", "dairy", "8"], ["parmesan", "dairy", "wedge"],
    ["canned tomatoes", "canned", "4 cans"], ["jasmine rice", "grain", "2 lb"], ["dried pasta", "grain", "3 boxes"],
    ["soy sauce", "condiment", "1 bottle"], ["coconut milk", "canned", "2 cans"], ["chickpeas", "canned", "3 cans"],
    ["all-purpose flour", "baking", "5 lb"], ["unsalted butter", "dairy", "1 lb"], ["lemon", "produce", "2"],
    ["scallions", "produce", "1 bunch"], ["fresh ginger", "produce", "knob"], ["frozen peas", "frozen", "1 bag"],
    ["gochujang", "condiment", "1 tub"], ["white miso", "condiment", "1 tub"], ["dijon mustard", "condiment", "1 jar"],
    ["chicken stock", "canned", "4 boxes"], ["greek yogurt", "dairy", "1 tub"], ["maple syrup", "condiment", "half"],
  ];
  const STORES = ["Kroger", "Trader Joe's", "H Mart", "Whole Foods"];
  const LOCATIONS = ["Kroger – Hyde Park No. 412", "Kroger – Clifton No. 388", "Kroger – Oakley No. 455", "Kroger – Norwood No. 501"];
  const ZIPS = ["45209", "45219", "45208", "45227"];
  const AVOID = ["shellfish", "pork", "cilantro", "mushrooms", "blue cheese"];
  const LIMIT = ["red meat", "added sugar", "dairy", "fried food"];
  const OUTINGS = [
    { name: "Thai takeout", type: "takeout", protein: null, cuisine: "thai" },
    { name: "Leftover night", type: "leftovers", protein: null, cuisine: null },
    { name: "Pizza out", type: "takeout", protein: null, cuisine: "italian" },
    { name: "Big salad", type: "home", protein: "vegan", cuisine: null },
  ];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDay = (ms) => { const d = new Date(ms); return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`; };
  const isoDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const SIDE_NAMES = ["garlic bread", "house salad", "steamed jasmine rice", "roasted broccoli", "crusty bread", "simple green salad", "warm naan", "quick-pickled onions"];

  function sample(arr, n, rnd) {
    const a = arr.slice();
    const out = [];
    while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
    return out;
  }
  const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

  function buildMemberDetail(m) {
    if (m.status === "pending") return { connected: false };
    const rnd = rngOf(m.user);
    const recipes = (window.GA.recipes || []).filter((r) => r.status === "indexed");

    // Profile / preferences
    const profile = {
      default_cooking_nights: 3 + Math.floor(rnd() * 3),
      lunch_strategy: pick(["leftovers", "buy", "mixed"], rnd),
      ready_to_eat_default_action: pick(["opt-in", "auto-add"], rnd),
      dietary: { avoid: sample(AVOID, Math.floor(rnd() * 2), rnd), limit: sample(LIMIT, Math.floor(rnd() * 2), rnd) },
      stores: {
        primary: m.kroger === "linked" ? "kroger" : null,
        preferred_location: m.kroger === "linked" ? pick(LOCATIONS, rnd) : null,
        location_zip: pick(ZIPS, rnd),
      },
      rotation: { resurface_after_days: pick([21, 30, 45], rnd), novelty_boost: pick([0.2, 0.3, 0.35], rnd) },
      brands: pick([{ pasta: ["De Cecco"], "olive oil": [] }, { coffee: ["Counter Culture"], pasta: ["Barilla"] }, { "olive oil": ["Graza"] }], rnd),
    };

    // Pantry — grounded in the `pantry` table (name, quantity, category, prepared_from,
    // added_at, last_verified_at; keyed by normalized name).
    const pantry = sample(PANTRY_POOL, 8 + Math.floor(rnd() * 6), rnd).map(([name, category, quantity], i) => ({
      name, category, quantity,
      prepared_from: i === 1 ? "batch-cooked chicken" : (i === 4 ? "roasted vegetables" : null),
      added_at: isoDate(now - (20 + Math.floor(rnd() * 70)) * DAY),
      last_verified_at: isoDate(now - Math.floor(rnd() * 14) * DAY),
    }));

    // Meal plan — keyed by recipe slug; planned_for is a date OR null (unscheduled);
    // sides are open-world side NAMES (free text, not recipe slugs).
    const planRecipes = sample(recipes, 3 + Math.floor(rnd() * 3), rnd);
    const mealPlan = planRecipes.map((r, i) => {
      const scheduled = !(i === planRecipes.length - 1 && rnd() < 0.6);
      return {
        recipe: r.slug, title: r.title,
        planned_for: scheduled ? isoDate(now + (i + 1) * DAY) : null,
        sides: rnd() < 0.55 ? sample(SIDE_NAMES, 1, rnd) : [],
      };
    });

    // Grocery list — grounded in the `grocery_list` schema. Items carry quantity, kind
    // (grocery|household|other), domain (store-type), source (menu|ad_hoc|pantry_low|
    // stockup), status (active|in_cart; `ordered` items are removed on purchase, never
    // shown), for_recipes (the slugs that put it on the list), and a note. NOT segmented
    // by physical store.
    const grocery = [];
    const gseen = new Set();
    planRecipes.slice(0, 3).forEach((r) => {
      const per = (window.GA.recipesApi ? window.GA.recipesApi.perishableOf(r) : r.ingredients.slice(0, 2)).slice(0, 2);
      per.forEach((ing) => {
        if (gseen.has(ing)) { const ex = grocery.find((g) => g.name === ing); if (ex && !ex.for_recipes.includes(r.slug)) ex.for_recipes.push(r.slug); return; }
        gseen.add(ing);
        grocery.push({ name: ing, quantity: pick(["1", "2", "1 lb", "1 bunch"], rnd), kind: "grocery", domain: "grocery", source: "menu", status: rnd() < 0.25 ? "in_cart" : "active", for_recipes: [r.slug], note: null });
      });
    });
    [
      { name: "olive oil", quantity: "1 bottle", kind: "grocery", domain: "grocery", source: "pantry_low", status: "active", for_recipes: [], note: "almost out" },
      { name: "paper towels", quantity: "1 pack", kind: "household", domain: "home-improvement", source: "ad_hoc", status: "active", for_recipes: [], note: null },
      { name: "canned chickpeas", quantity: "4 cans", kind: "grocery", domain: "grocery", source: "stockup", status: "active", for_recipes: [], note: null },
    ].forEach((x) => { if (rnd() < 0.7 && !gseen.has(x.name)) { gseen.add(x.name); grocery.push(x); } });

    // Cooking log — recent history
    const logN = Math.min(12, 5 + Math.floor((m.cooked || 0) / 10));
    const cookingLog = [];
    for (let i = 0; i < logN; i++) {
      const useRecipe = rnd() < 0.72;
      const at = now - (i * 2 + Math.floor(rnd() * 2)) * DAY;
      if (useRecipe) {
        const r = pick(recipes, rnd);
        cookingLog.push({ at, date: fmtDay(at), title: r.title, recipe: r.slug, protein: r.protein, cuisine: r.cuisine, type: "cooked" });
      } else {
        const o = pick(OUTINGS, rnd);
        cookingLog.push({ at, date: fmtDay(at), title: o.name, recipe: null, protein: o.protein, cuisine: o.cuisine, type: o.type });
      }
    }
    cookingLog.sort((a, b) => b.at - a.at);

    // Recipe notes authored by this member (cross-referenced from the corpus)
    const notes = [];
    (window.GA.recipes || []).forEach((r) =>
      r.notes.forEach((n) => { if (n.author === m.user) notes.push({ recipe: r.slug, title: r.title, body: n.body, tags: n.tags, private: n.private, at: n.at }); }));

    return { connected: true, profile, pantry, mealPlan, grocery, cookingLog, notes };
  }

  window.GA.members = members;
  window.GA.membersApi = { relAge, buildMemberDetail };
  window.GA.membersMeta = {
    relAge,
    total: members.length,
    active: members.filter((m) => m.status === "active").length,
    pending: members.filter((m) => m.status === "pending").length,
    krogerLinked: members.filter((m) => m.kroger === "linked").length,
  };
})();
