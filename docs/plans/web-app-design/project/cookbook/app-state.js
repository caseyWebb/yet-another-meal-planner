/* Cookbook web app — state layer.
   A hypothetical member-facing surface over the things the grocery agent does
   today. Data shapes are lifted verbatim from the real codebase
   (src + admin members-data.jsx): profile/preferences, pantry, meal_plan,
   grocery_list, cooking log, and authored recipe notes. Seeded deterministically
   per username, then mutated locally and persisted to localStorage so the
   prototype is fully interactive. Recipe corpus comes from window.CB. */
(function () {
  const DAY = 86400000;
  const now = Date.now();
  const uid = () => Math.random().toString(36).slice(2, 9);

  // ---- friend-group roster (from members-data.jsx) -------------------------
  const MEMBERS = [
    { user: "casey", owner: true, kroger: "linked", joined: 214, cooked: 86, favorites: 41 },
    { user: "dlo", kroger: "linked", joined: 168, cooked: 52, favorites: 33 },
    { user: "marcus", kroger: "linked", joined: 151, cooked: 47, favorites: 19 },
    { user: "priya", kroger: "unlinked", joined: 132, cooked: 38, favorites: 22 },
    { user: "sage", kroger: "linked", joined: 98, cooked: 44, favorites: 28 },
    { user: "tomk", kroger: "linked", joined: 120, cooked: 31, favorites: 12 },
    { user: "bex", kroger: "unlinked", joined: 73, cooked: 17, favorites: 9 },
    { user: "ortega", kroger: "linked", joined: 55, cooked: 23, favorites: 15 },
    { user: "ravi", kroger: "linked", joined: 40, cooked: 12, favorites: 6 },
  ];

  // ---- controlled vocab + pools (from members-data.jsx) --------------------
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
  const LOCATIONS = ["Kroger – Hyde Park No. 412", "Kroger – Clifton No. 388", "Kroger – Oakley No. 455", "Kroger – Norwood No. 501"];
  const ZIPS = ["45209", "45219", "45208", "45227"];
  const AVOID = ["shellfish", "pork", "cilantro", "mushrooms", "blue cheese"];
  const LIMIT = ["red meat", "added sugar", "dairy", "fried food"];
  // Free-form, member-authored profile prose (markdown). This is the natural-language
  // “in your own words” guidance the agent reads alongside the structured knobs.
  const TASTE_NOTES = [
    "I chase **acid and heat** \u2014 Sichuan numbing, Thai bird chili, a sharp salsa verde. If a dish is bland I won't cook it twice.\n\nWeeknights should be **fast and one-pan**. Save the projects for Sundays.",
    "Big on **umami and char**: grilled, miso-glazed, or crusted hard in cast iron. I'd rather cook a vegetable really well than default to meat.\n\nKeep the rotation *interesting* \u2014 don't feed me the same five dinners.",
    "**Bright, herby, Mediterranean** is my comfort zone \u2014 lemon, olive oil, a fistful of parsley.\n\nNot a fan of heavy cream sauces or anything claggy. The lighter the better.",
    "Give me **cozy and slow** \u2014 braises, stews, things that fill the house with smell. Cold-weather cooking is the whole point of winter for me.\n\nI don't mind leftovers; I actually **plan for them**.",
  ];
  const KITCHEN_NOTES = [
    "Cooking for **two**, occasionally four when friends drop by. Gas range, one beloved cast iron, and no microwave dinners.\n\nWeeknights I've got about **40 minutes**; weekends are wide open.",
    "Just **me** most nights, so I batch and stretch things across the week. Small kitchen, sharp knives, not much counter space.\n\nI hate wasting produce \u2014 plan around what's already wilting in the fridge.",
    "**Family of four**, two of them picky eaters. Something has to be on the table by **6:30** or it's chaos.\n\nStand mixer, a stack of sheet pans, and a slow cooker I always forget to use.",
  ];
  const OUTINGS = [
    { name: "Thai takeout", type: "takeout", protein: null, cuisine: "thai" },
    { name: "Leftover night", type: "leftovers", protein: null, cuisine: null },
    { name: "Pizza out", type: "takeout", protein: null, cuisine: "italian" },
    { name: "Big salad", type: "home", protein: "vegan", cuisine: null },
  ];
  const SIDE_NAMES = ["garlic bread", "house salad", "steamed jasmine rice", "roasted broccoli", "crusty bread", "simple green salad", "warm naan", "quick-pickled onions"];
  const BRAND_SETS = [
    { pasta: ["De Cecco"], "olive oil": ["Graza"] },
    { coffee: ["Counter Culture"], pasta: ["Barilla"] },
    { "olive oil": ["Graza"] },
  ];
  const FRESH = ["salmon", "cucumber", "carrot", "onion", "potato", "lemon", "lime", "scallion", "tomato", "basil",
    "spinach", "leek", "feta", "kale", "egg", "shrimp", "pork", "chicken", "lamb", "eggplant", "asparagus", "pea",
    "mozzarella", "gruyère", "apple", "kimchi", "ginger", "cilantro", "mint", "tofu", "avocado"];
  const perishableOf = (r) => r.ingredients.filter((i) => FRESH.some((f) => i.includes(f)));

  // ---- date helpers (match admin formatting) -------------------------------
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function isoDate(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function fmtDay(ms) { const d = new Date(ms); return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`; }
  function fmtPlanned(iso) { const [y, m, da] = iso.split("-").map(Number); const d = new Date(y, m - 1, da); return `${WD[d.getDay()]} · ${MO[m - 1]} ${da}`; }
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

  // ---- night-vibe palette + weather (propose_meal_plan inputs) -------------
  // Weather meal_vibes vocabulary (matches the weather-meal-planning capability).
  const WX = {
    cold: { vibes: ["soup", "comfort", "braise", "cozy"], lo: 24, hi: 38, cond: "cold" },
    rainy: { vibes: ["soup", "comfort", "cozy", "braise"], lo: 40, hi: 52, cond: "rainy" },
    cool: { vibes: ["roast", "braise", "comfort"], lo: 44, hi: 58, cond: "cool" },
    mild: { vibes: ["bright", "bowl", "roast"], lo: 58, hi: 70, cond: "mild" },
    warm: { vibes: ["grill", "bright", "salad", "fresh"], lo: 72, hi: 84, cond: "warm" },
    hot: { vibes: ["grill", "salad", "fresh", "light"], lo: 86, hi: 96, cond: "hot" },
  };
  function seedWeather(rnd) {
    const regimes = ["cold", "rainy", "cool", "mild", "warm", "hot"];
    const base = regimes.indexOf(pick(["cold", "cool", "mild", "warm"], rnd));
    const out = [];
    for (let i = 0; i < 7; i++) {
      const shift = Math.round((rnd() - 0.5) * 2); // drift ±1 regime day to day
      const key = regimes[Math.max(0, Math.min(regimes.length - 1, base + shift))];
      const w = WX[key];
      const t = w.lo + Math.floor(rnd() * (w.hi - w.lo));
      const at = now + (i + 1) * DAY;
      const d = new Date(at);
      out.push({ label: WD[d.getDay()], date: isoDate(at), tempF: t, cond: w.cond, vibes: w.vibes.slice() });
    }
    return out;
  }

  // Derive a starter palette from the member's revealed history (log + favorites).
  function deriveVibes(rnd, recipes, cookingLog, favorites, profile) {
    const tally = {};
    cookingLog.forEach((c) => { if (c.cuisine && c.type === "cooked") tally[c.cuisine] = (tally[c.cuisine] || 0) + 1; });
    const topCuisine = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    // stamp: how many recent matching cooks to attribute (provenance) to this vibe.
    // 0 ⇒ intentionally never-cooked (an overdue vibe, a prune/stretch candidate).
    const specs = [
      { vibe: "Fast weeknight one-pan", facets: { max_time: 30 }, cadence_days: 7, weather_affinity: ["any"], season: null, stamp: 1, match: (r) => r.time <= 30 },
      { vibe: "Cozy braise or soup", facets: {}, cadence_days: 14, weather_affinity: ["soup", "braise", "comfort", "cozy"], season: "winter", stamp: 0, match: (r) => /soup|stew|dal|brais|bean/.test((r.title + " " + r.ingredients.join(" ")).toLowerCase()) },
      { vibe: "Greens-forward, something bright", facets: {}, cadence_days: 7, weather_affinity: ["bright", "fresh", "salad"], season: null, stamp: 1, match: (r) => /salad|greens|spring|herb|lemon|vegetable/.test((r.title + " " + (r.description || "")).toLowerCase()) || r.protein === "vegan" || r.protein === "vegetarian" },
      { vibe: "Weekend project cook", facets: {}, cadence_days: 30, weather_affinity: ["any"], season: null, stamp: 0, match: (r) => r.time >= 75 },
      { vibe: "Noodles or a rice bowl", facets: {}, cadence_days: 12, weather_affinity: ["any"], season: null, stamp: 1, match: (r) => /noodle|pasta|rice|bowl|donburi|banh/.test((r.title + " " + r.ingredients.join(" ")).toLowerCase()) },
    ];
    // A top cuisine the member clearly repeats becomes a fast-cadence vibe with
    // real provenance — the substrate for a "cook this more often" reconcile.
    if (topCuisine && topCuisine[1] >= 2) {
      specs.splice(2, 0, { vibe: CB_cap(topCuisine[0]) + " night", facets: { cuisine: topCuisine[0] }, cadence_days: 14, weather_affinity: ["any"], season: null, stamp: 2, match: (r) => r.cuisine === topCuisine[0] });
    }
    return specs.slice(0, 6).map((s) => {
      const id = "vibe_" + uid();
      let last = null;
      if (s.stamp > 0) {
        const matches = cookingLog.filter((c) => c.recipe && c.type === "cooked" && !c.satisfied_vibe && matchesSlug(s.match, c.recipe, recipes));
        matches.slice(0, s.stamp).forEach((c) => { c.satisfied_vibe = id; });
        if (matches.length) last = matches[0].at; // log is sorted newest-first
      }
      return { id, vibe: s.vibe, facets: s.facets, cadence_days: s.cadence_days, weather_affinity: s.weather_affinity, season: s.season, last_satisfied: last, embedded: true };
    });
  }
  function matchesSlug(fn, slug, recipes) { const r = recipes.find((x) => x.slug === slug); return r ? fn(r) : false; }
  const CB_cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

  // ---- deterministic RNG (from members-data.jsx) ---------------------------
  function rngOf(str) {
    let s = 0;
    for (let i = 0; i < str.length; i++) s = (s * 131 + str.charCodeAt(i)) >>> 0;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  function sample(arr, n, rnd) { const a = arr.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; }
  const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

  // ---- seed one member's full state ----------------------------------------
  function seed(user) {
    const m = MEMBERS.find((x) => x.user === user) || MEMBERS[0];
    const rnd = rngOf(user);
    const recipes = window.CB.RECIPES;

    const profile = {
      default_cooking_nights: 3 + Math.floor(rnd() * 3),
      lunch_strategy: sample(["buy", "cook", "leftovers"], 1 + Math.floor(rnd() * 2), rnd),
      ready_to_eat_default_action: pick(["opt-in", "auto-add"], rnd),
      dietary: { avoid: sample(AVOID, Math.floor(rnd() * 2), rnd), limit: sample(LIMIT, 1 + Math.floor(rnd() * 2), rnd) },
      stores: {
        primary: m.kroger === "linked" ? "kroger" : null,
        preferred_location: m.kroger === "linked" ? pick(LOCATIONS, rnd) : null,
        location_zip: pick(ZIPS, rnd),
      },
      rotation: { resurface_after_days: pick([21, 30, 45], rnd), novelty_boost: pick([0.2, 0.3, 0.35], rnd) },
      brands: pick(BRAND_SETS, rnd),
      taste_note: pick(TASTE_NOTES, rnd),
      kitchen_note: pick(KITCHEN_NOTES, rnd),
    };

    // Favorites — a deterministic slice of the corpus.
    const favorites = sample(recipes, Math.min(7, 4 + Math.floor(rnd() * 4)), rnd).map((r) => r.slug);

    const pantry = sample(PANTRY_POOL, 8 + Math.floor(rnd() * 6), rnd).map(([name, category, quantity], i) => ({
      id: uid(), name, category, quantity,
      prepared_from: i === 1 ? "batch-cooked chicken" : (i === 4 ? "roasted vegetables" : null),
      added_at: isoDate(now - (20 + Math.floor(rnd() * 70)) * DAY),
      last_verified_at: isoDate(now - Math.floor(rnd() * 14) * DAY),
    }));

    const planRecipes = sample(recipes, 3 + Math.floor(rnd() * 3), rnd);
    const mealPlan = planRecipes.map((r, i) => {
      const scheduled = !(i === planRecipes.length - 1 && rnd() < 0.6);
      return {
        id: uid(), recipe: r.slug, title: r.title,
        planned_for: scheduled ? isoDate(now + (i + 1) * DAY) : null,
        sides: rnd() < 0.55 ? sample(SIDE_NAMES, 1, rnd) : [],
      };
    });

    const grocery = [];
    const gseen = new Set();
    planRecipes.slice(0, 3).forEach((r) => {
      perishableOf(r).slice(0, 2).forEach((ing) => {
        if (gseen.has(ing)) { const ex = grocery.find((g) => g.name === ing); if (ex && !ex.for_recipes.includes(r.slug)) ex.for_recipes.push(r.slug); return; }
        gseen.add(ing);
        grocery.push({ id: uid(), name: ing, quantity: pick(["1", "2", "1 lb", "1 bunch"], rnd), kind: "grocery", source: "menu", status: rnd() < 0.25 ? "in_cart" : "active", for_recipes: [r.slug], note: null });
      });
    });
    [
      { name: "olive oil", quantity: "1 bottle", kind: "grocery", source: "pantry_low", status: "active", for_recipes: [], note: "almost out" },
      { name: "paper towels", quantity: "1 pack", kind: "household", source: "ad_hoc", status: "active", for_recipes: [], note: null },
      { name: "canned chickpeas", quantity: "4 cans", kind: "grocery", source: "stockup", status: "active", for_recipes: [], note: null },
    ].forEach((x) => { if (rnd() < 0.8 && !gseen.has(x.name)) { gseen.add(x.name); grocery.push(Object.assign({ id: uid() }, x)); } });

    const logN = Math.min(12, 5 + Math.floor((m.cooked || 0) / 10));
    const cookingLog = [];
    for (let i = 0; i < logN; i++) {
      const at = now - (i * 2 + Math.floor(rnd() * 2)) * DAY;
      if (rnd() < 0.72) {
        const r = pick(recipes, rnd);
        cookingLog.push({ id: uid(), at, title: r.title, recipe: r.slug, protein: r.protein, cuisine: r.cuisine, type: "cooked" });
      } else {
        const o = pick(OUTINGS, rnd);
        cookingLog.push({ id: uid(), at, title: o.name, recipe: null, protein: o.protein, cuisine: o.cuisine, type: o.type });
      }
    }
    cookingLog.sort((a, b) => b.at - a.at);

    // The member's OWN notes (editable). Pulled from the corpus notes they authored,
    // plus they can add more. Each carries days→at for relative time.
    const userNotes = {};
    recipes.forEach((r) => {
      (r.notes || []).forEach((n) => {
        if (n.author === user) {
          (userNotes[r.slug] = userNotes[r.slug] || []).push({ id: uid(), body: n.body, tag: n.tag || null, private: false, at: now - (n.days || 1) * DAY });
        }
      });
    });

    const weather = seedWeather(rnd);
    const nightVibes = deriveVibes(rnd, recipes, cookingLog, favorites, profile);

    return { user, profile, favorites, pantry, mealPlan, grocery, cookingLog, userNotes, nightVibes, weather, pendingProposals: [], store: m.kroger === "linked" ? "kroger" : "category" };
  }

  // ---- persistence ---------------------------------------------------------
  const USER_KEY = "cookbook:app:user";
  function load(user) {
    let st;
    try { st = JSON.parse(localStorage.getItem("cookbook:app:state:" + user) || "null"); } catch (e) {}
    if (!st) { st = seed(user); save(st); return st; }
    // Migrate state persisted before newer fields existed — backfill from a fresh seed.
    const fresh = seed(user);
    if (st.profile) {
      if (st.profile.taste_note == null) st.profile.taste_note = fresh.profile.taste_note;
      if (st.profile.kitchen_note == null) st.profile.kitchen_note = fresh.profile.kitchen_note;
      // lunch_strategy went from a single string ("leftovers"|"buy"|"mixed") to a
      // multi-select array over buy / cook / leftovers ("mixed" = pick more than one).
      if (!Array.isArray(st.profile.lunch_strategy)) {
        const s = st.profile.lunch_strategy;
        st.profile.lunch_strategy = s === "mixed" ? ["buy", "leftovers"] : (s ? [s] : []);
      }
    }
    // Backfill the propose_meal_plan fields for state saved before they existed.
    if (!Array.isArray(st.nightVibes)) st.nightVibes = fresh.nightVibes;
    if (!Array.isArray(st.weather)) st.weather = fresh.weather;
    if (!Array.isArray(st.pendingProposals)) st.pendingProposals = [];
    return st;
  }
  function save(st) { try { localStorage.setItem("cookbook:app:state:" + st.user, JSON.stringify(st)); } catch (e) {} }

  let current = null;
  function setUser(user) { current = load(user); try { localStorage.setItem(USER_KEY, user); } catch (e) {} return current; }
  function getUser() { try { return localStorage.getItem(USER_KEY); } catch (e) { return null; } }
  function logout() { try { localStorage.removeItem(USER_KEY); } catch (e) {} current = null; }
  function state() { return current; }
  function meta(user) { return MEMBERS.find((m) => m.user === (user || (current && current.user))); }
  function persist() { if (current) save(current); }

  // ---- actions (mutate + persist) ------------------------------------------
  const A = {
    toggleFavorite(slug) {
      const f = current.favorites;
      const i = f.indexOf(slug);
      if (i >= 0) f.splice(i, 1); else f.unshift(slug);
      persist();
    },
    isFavorite(slug) { return current.favorites.includes(slug); },

    addToPlan(slug, dateIso) {
      const r = window.CB.bySlug(slug); if (!r) return;
      if (current.mealPlan.some((p) => p.recipe === slug)) return;
      current.mealPlan.push({ id: uid(), recipe: slug, title: r.title, planned_for: dateIso || null, sides: [] });
      persist();
    },
    inPlan(slug) { return current.mealPlan.some((p) => p.recipe === slug); },
    togglePlan(slug) {
      const i = current.mealPlan.findIndex((p) => p.recipe === slug);
      if (i >= 0) { current.mealPlan.splice(i, 1); persist(); return false; }
      const r = window.CB.bySlug(slug); if (!r) return false;
      current.mealPlan.push({ id: uid(), recipe: slug, title: r.title, planned_for: null, sides: [] });
      persist(); return true;
    },
    removeFromPlan(id) { current.mealPlan = current.mealPlan.filter((p) => p.id !== id); persist(); },
    // Agent-style: fill the coming week up to the member's cooking-nights target,
    // honoring dietary avoids, favoring protein variety and not-recently-cooked.
    proposePlan() {
      const prof = current.profile || {};
      const avoid = ((prof.dietary && prof.dietary.avoid) || []).map((a) => a.toLowerCase());
      const blocked = (r) => r.ingredients.some((ing) => avoid.some((a) => ing.toLowerCase().includes(a)));
      const target = Math.min(5, Math.max(2, prof.default_cooking_nights || 3));
      const tomorrow = isoDate(now + DAY);
      const scheduledUpcoming = current.mealPlan.filter((p) => p.planned_for && p.planned_for >= tomorrow).length;
      const need = Math.max(0, target - scheduledUpcoming);
      if (need === 0) return { added: 0, scheduled: 0, full: true };

      const taken = new Set(current.mealPlan.map((p) => p.planned_for).filter(Boolean));
      const openDates = [];
      for (let i = 1; i <= 12 && openDates.length < need; i++) {
        const iso = isoDate(now + i * DAY);
        if (!taken.has(iso)) openDates.push(iso);
      }

      const inPlan = new Set(current.mealPlan.map((p) => p.recipe));
      const recent = new Set(current.cookingLog.slice(0, 5).map((c) => c.recipe).filter(Boolean));
      const cands = window.CB.RECIPES
        .filter((r) => !inPlan.has(r.slug) && !blocked(r))
        .sort((a, b) => (recent.has(a.slug) ? 1 : 0) - (recent.has(b.slug) ? 1 : 0) || a.title.localeCompare(b.title));

      const usedProteins = new Set(current.mealPlan.map((p) => { const r = window.CB.bySlug(p.recipe); return r && r.protein; }).filter(Boolean));
      const picks = [];
      for (const r of cands) { if (picks.length >= need) break; if (r.protein && !usedProteins.has(r.protein)) { picks.push(r); usedProteins.add(r.protein); } }
      for (const r of cands) { if (picks.length >= need) break; if (!picks.includes(r)) picks.push(r); }

      // Pull any already-unscheduled items onto open nights first, then new picks.
      const queue = [...current.mealPlan.filter((p) => !p.planned_for).map((p) => ({ existing: p })), ...picks.map((r) => ({ recipe: r }))];
      let added = 0, scheduled = 0;
      for (const item of queue) {
        if (!openDates.length) break;
        const date = openDates.shift();
        if (item.existing) { item.existing.planned_for = date; scheduled++; }
        else { current.mealPlan.push({ id: uid(), recipe: item.recipe.slug, title: item.recipe.title, planned_for: date, sides: [] }); added++; scheduled++; }
      }
      persist();
      return { added, scheduled, full: false };
    },
    schedulePlan(id, iso) { const p = current.mealPlan.find((x) => x.id === id); if (p) p.planned_for = iso || null; persist(); },
    addSide(id, name) { const p = current.mealPlan.find((x) => x.id === id); if (p && name && !p.sides.includes(name)) p.sides.push(name); persist(); },
    removeSide(id, name) { const p = current.mealPlan.find((x) => x.id === id); if (p) p.sides = p.sides.filter((s) => s !== name); persist(); },

    addGroceryForRecipe(slug) {
      const r = window.CB.bySlug(slug); if (!r) return 0;
      let added = 0;
      perishableOf(r).forEach((ing) => {
        const ex = current.grocery.find((g) => g.name === ing);
        if (ex) { if (!ex.for_recipes.includes(slug)) { ex.for_recipes.push(slug); } return; }
        current.grocery.push({ id: uid(), name: ing, quantity: "1", kind: "grocery", source: "menu", status: "active", for_recipes: [slug], note: null });
        added++;
      });
      persist();
      return added;
    },
    addGroceryItem(name, quantity) {
      if (!name) return;
      current.grocery.push({ id: uid(), name: name.toLowerCase(), quantity: quantity || "1", kind: "grocery", source: "ad_hoc", status: "active", for_recipes: [], note: null });
      persist();
    },
    toggleInCart(id) { const g = current.grocery.find((x) => x.id === id); if (g) g.status = g.status === "in_cart" ? "active" : "in_cart"; persist(); },
    sendAllToCart() { let n = 0; current.grocery.forEach((g) => { if (g.status !== "in_cart") { g.status = "in_cart"; n++; } }); persist(); return n; },
    removeGrocery(id) { current.grocery = current.grocery.filter((g) => g.id !== id); persist(); },
    substituteGrocery(id, name) { const g = current.grocery.find((x) => x.id === id); if (g && name) { g.note = `swapped from ${g.name}`; g.name = name.toLowerCase(); g.source = "ad_hoc"; } persist(); },
    clearInCart() { current.grocery = current.grocery.filter((g) => g.status !== "in_cart"); persist(); },
    setStore(mode) { current.store = mode; persist(); },

    addPantry(name, category, quantity) {
      if (!name) return;
      current.pantry.unshift({ id: uid(), name: name.toLowerCase(), category: category || "other", quantity: quantity || "1", prepared_from: null, added_at: isoDate(now), last_verified_at: isoDate(now) });
      persist();
    },
    editPantry(id, patch) { const p = current.pantry.find((x) => x.id === id); if (p) Object.assign(p, patch); persist(); },
    verifyPantry(id) { const p = current.pantry.find((x) => x.id === id); if (p) p.last_verified_at = isoDate(now); persist(); },
    removePantry(id) { current.pantry = current.pantry.filter((p) => p.id !== id); persist(); },

    logCook(slug, customTitle) {
      const r = slug ? window.CB.bySlug(slug) : null;
      // "shape in → shape out": if this recipe sits in the plan from a vibe slot,
      // copy that provenance onto the log row and advance the vibe's clock — in the
      // same step that clears the cooked recipe from the plan.
      let satisfied = null;
      if (r) {
        const planRow = current.mealPlan.find((p) => p.recipe === r.slug);
        if (planRow && planRow.from_vibe) {
          satisfied = planRow.from_vibe;
          const v = (current.nightVibes || []).find((x) => x.id === satisfied);
          if (v) v.last_satisfied = Date.now();
        }
        if (planRow) current.mealPlan = current.mealPlan.filter((p) => p.id !== planRow.id);
      }
      current.cookingLog.unshift(r
        ? { id: uid(), at: Date.now(), title: r.title, recipe: r.slug, protein: r.protein, cuisine: r.cuisine, type: "cooked", satisfied_vibe: satisfied }
        : { id: uid(), at: Date.now(), title: customTitle || "Cooked something", recipe: null, protein: null, cuisine: null, type: "cooked", satisfied_vibe: null });
      persist();
    },
    removeLog(id) { current.cookingLog = current.cookingLog.filter((c) => c.id !== id); persist(); },

    addNote(slug, body, tag, priv) {
      if (!body) return;
      (current.userNotes[slug] = current.userNotes[slug] || []).unshift({ id: uid(), body, tag: tag || null, private: !!priv, at: Date.now() });
      persist();
    },
    editNote(slug, id, patch) { const arr = current.userNotes[slug] || []; const n = arr.find((x) => x.id === id); if (n) Object.assign(n, patch); persist(); },
    removeNote(slug, id) { if (current.userNotes[slug]) current.userNotes[slug] = current.userNotes[slug].filter((n) => n.id !== id); persist(); },

    updateProfile(patch) { Object.assign(current.profile, patch); persist(); },
    addBrand(category, brand) {
      const c = (category || "").trim().toLowerCase();
      const b = (brand || "").trim();
      if (!c) return;
      const brands = current.profile.brands || (current.profile.brands = {});
      if (b) brands[c] = Array.from(new Set([...(brands[c] || []), b]));
      else if (!brands[c]) brands[c] = [];
      persist();
    },
    removeBrand(category, brand) {
      const brands = current.profile.brands;
      if (!brands || !(category in brands)) return;
      if (brand) {
        brands[category] = (brands[category] || []).filter((x) => x !== brand);
        if (!brands[category].length) delete brands[category];
      } else {
        delete brands[category];
      }
      persist();
    },
    moveBrand(category, brand, dir) {
      const arr = current.profile.brands && current.profile.brands[category];
      if (!arr) return;
      const i = arr.indexOf(brand);
      if (i < 0) return;
      const j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      persist();
    },    resetState() { current = seed(current.user); save(current); },

    // ---- night-vibe palette (per-tenant saved specs + cadence) -------------
    addVibe(spec) {
      const v = Object.assign({ id: "vibe_" + uid(), vibe: "", facets: {}, cadence_days: 14, weather_affinity: ["any"], season: null, last_satisfied: null, embedded: true }, spec || {});
      if (!v.vibe.trim()) return null;
      current.nightVibes.unshift(v); persist(); return v;
    },
    updateVibe(id, patch) {
      const v = current.nightVibes.find((x) => x.id === id);
      if (!v) return;
      // Editing the vibe text "re-embeds on a later tick" — modeled as instant here.
      Object.assign(v, patch); persist();
    },
    removeVibe(id) { current.nightVibes = current.nightVibes.filter((v) => v.id !== id); persist(); },
    toggleWeatherAffinity(id, tag) {
      const v = current.nightVibes.find((x) => x.id === id); if (!v) return;
      const aff = v.weather_affinity || (v.weather_affinity = []);
      if (tag === "any") { v.weather_affinity = ["any"]; }
      else { const bare = aff.filter((a) => a !== "any"); const i = bare.indexOf(tag); if (i >= 0) bare.splice(i, 1); else bare.push(tag); v.weather_affinity = bare.length ? bare : ["any"]; }
      persist();
    },

    // ---- propose_meal_plan session (inputs only; slots are recomputed) ------
    startPropose() {
      const prof = current.profile || {};
      if (!current.proposeSession) {
        current.proposeSession = { seed: 1, nights: Math.min(5, Math.max(2, prof.default_cooking_nights || 3)), lambda: 0.6, slotMaxTime: {}, slotVibe: {}, slotProtein: {}, slotCuisine: {}, proteinWants: [], freeform: "", locked: {}, overrides: {}, excluded: [], committed: false };
      }
      // backfill fields for sessions saved before they existed
      const s = current.proposeSession;
      if (!s.slotMaxTime) s.slotMaxTime = {};
      if (!s.slotVibe) s.slotVibe = {};
      if (!s.slotProtein) s.slotProtein = {};
      if (!s.slotCuisine) s.slotCuisine = {};
      if (!Array.isArray(s.proteinWants)) s.proteinWants = [];
      persist();
      return current.proposeSession;
    },
    proposeOpts() { return current.proposeSession || null; },
    reroll() { const s = this.startPropose(); s.seed += 1; s.committed = false; persist(); },
    setProposeField(key, val) { const s = this.startPropose(); s[key] = val; s.committed = false; persist(); },
    toggleProteinWant(p) { const s = this.startPropose(); const a = s.proteinWants || (s.proteinWants = []); const i = a.indexOf(p); if (i >= 0) a.splice(i, 1); else a.push(p); s.committed = false; persist(); },
    setSlotMaxTime(vibeId, minutes) { const s = this.startPropose(); s.slotMaxTime = s.slotMaxTime || {}; s.slotMaxTime[vibeId] = (minutes === "" || minutes == null) ? null : Number(minutes); delete s.overrides[vibeId]; delete s.locked[vibeId]; s.committed = false; persist(); },
    // Per-night facet filter (protein | cuisine). Adds a hard constraint to this
    // night's query and re-fires it; an empty value clears the filter. Changing a
    // facet drops any pinned specific recipe so the slot re-picks under the new gate.
    setSlotFacet(vibeId, kind, value) {
      const s = this.startPropose();
      const key = kind === "protein" ? "slotProtein" : kind === "cuisine" ? "slotCuisine" : null;
      if (!key) return;
      s[key] = s[key] || {};
      if (value == null || value === "") delete s[key][vibeId]; else s[key][vibeId] = value;
      delete s.overrides[vibeId]; delete s.locked[vibeId];
      s.committed = false; persist();
    },
    // Per-night vibe phrase the member typed over the planner's assignment. An
    // empty value reverts the night to the pipeline-assigned vibe.
    setSlotVibe(vibeId, text) { const s = this.startPropose(); s.slotVibe = s.slotVibe || {}; const t = (text || "").trim(); if (t) s.slotVibe[vibeId] = t; else delete s.slotVibe[vibeId]; s.committed = false; persist(); },
    resetPropose() { current.proposeSession = null; persist(); },
    lockSlot(vibeId, slug) {
      const s = this.startPropose();
      if (s.locked[vibeId]) delete s.locked[vibeId]; else s.locked[vibeId] = slug;
      persist();
    },
    overrideSlot(vibeId, slug) { const s = this.startPropose(); s.overrides[vibeId] = slug; delete s.locked[vibeId]; persist(); },
    excludeSlot(vibeId, slug) {
      const s = this.startPropose();
      if (s.excluded.indexOf(slug) < 0) s.excluded.push(slug);
      delete s.overrides[vibeId]; delete s.locked[vibeId];
      persist();
    },
    // Commit the (UI-computed) week to the meal plan, stamping slot provenance.
    commitWeek(slotsData) {
      const taken = new Set(current.mealPlan.map((p) => p.planned_for).filter(Boolean));
      const openDates = [];
      for (let i = 1; i <= 14 && openDates.length < slotsData.length; i++) { const iso = isoDate(now + i * DAY); if (!taken.has(iso)) openDates.push(iso); }
      let added = 0;
      slotsData.forEach((sl) => {
        if (current.mealPlan.some((p) => p.recipe === sl.slug)) return;
        current.mealPlan.push({ id: uid(), recipe: sl.slug, title: sl.title, planned_for: openDates.shift() || null, sides: (sl.sides || []).slice(), from_vibe: sl.from_vibe || null });
        added++;
      });
      if (current.proposeSession) current.proposeSession.committed = true;
      persist();
      return added;
    },

    // ---- profile reconciliation (stated vs revealed) ------------------------
    refreshPending() {
      const muted = new Set(current.reconcileMuted || []);
      const fresh = window.PROPOSE.reconcile(current);
      const have = new Set((current.pendingProposals || []).map((p) => p.signature));
      fresh.forEach((p) => { if (!have.has(p.signature) && !muted.has(p.signature)) { current.pendingProposals.push(Object.assign({ id: uid() }, p)); have.add(p.signature); } });
      persist();
      return current.pendingProposals;
    },
    _mute(sig) { if (sig) (current.reconcileMuted = current.reconcileMuted || []).push(sig); },
    applyPending(id) {
      const p = (current.pendingProposals || []).find((x) => x.id === id);
      if (!p) return;
      this._mute(p.signature);
      if (p.type === "add" && p.vibe) this.addVibe(p.vibe);
      else if (p.type === "prune" && p.vibeId) this.removeVibe(p.vibeId);
      else if (p.type === "adjust" && p.vibeId && p.suggestCadence) this.updateVibe(p.vibeId, { cadence_days: p.suggestCadence });
      current.pendingProposals = current.pendingProposals.filter((x) => x.id !== id);
      persist();
    },
    // "Stretch" action for a prune proposal — keep the vibe but lengthen cadence.
    stretchPending(id) {
      const p = (current.pendingProposals || []).find((x) => x.id === id);
      if (p && p.vibeId && p.suggestCadence) this.updateVibe(p.vibeId, { cadence_days: p.suggestCadence });
      if (p) this._mute(p.signature);
      current.pendingProposals = current.pendingProposals.filter((x) => x.id !== id);
      persist();
    },
    dismissPending(id) { const p = (current.pendingProposals || []).find((x) => x.id === id); if (p) this._mute(p.signature); current.pendingProposals = (current.pendingProposals || []).filter((x) => x.id !== id); persist(); },
  };

  window.APP = {
    MEMBERS, SIDE_NAMES, AVOID, LIMIT,
    WEATHER_TAGS: ["comfort", "soup", "braise", "cozy", "roast", "grill", "bright", "fresh", "salad", "light", "noodle"],
    CUISINES: ["japanese", "indian", "chinese", "french", "american", "korean", "thai", "italian", "vietnamese", "mediterranean"],
    PROTEINS: ["fish", "chicken", "beef", "pork", "shellfish", "egg", "tofu", "vegetarian", "vegan"],
    isoDate, fmtDay, fmtPlanned, relAge, perishableOf,
    setUser, getUser, logout, state, meta, persist,
    actions: A,
    today: isoDate(now),
  };
})();
