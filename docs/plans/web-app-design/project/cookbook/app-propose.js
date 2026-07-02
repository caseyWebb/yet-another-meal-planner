/* app-propose.js — the propose_meal_plan engine, ported to the web app.
   A faithful, Claude-less port of the branch's two-level planner:

     Level 1 — SHAPE the week: sample N night-vibe slots from the palette,
               weighted by weather-affinity × cadence-debt, seeded & diverse
               (force-placing due/pinned vibes first).
     Level 2 — FILL the slots: per slot, retrieve gate-valid candidates for the
               vibe's saved spec, then diversify-SELECT with Maximal Marginal
               Relevance (tunable λ) + facet-spread (protein cap). Compose sides
               deterministically, flag waste / meal-prep / side-unfilled, and
               attach a why[] to each pick. Returns a structured proposal +
               week-level variety diagnostics.

   Stateless & deterministic: identical inputs + seed ⇒ identical week. Since the
   web app has no Workers-AI embeddings, recipe/vibe "embeddings" are built here as
   deterministic feature vectors over cuisine / protein / time-band / keyword
   dimensions — enough for meaningful cosine + MMR. Pure functions; reads window.CB
   (corpus) and window.APP.perishableOf. Exposes window.PROPOSE. */
(function () {
  const CB = window.CB;

  // ── feature-vector space (stand-in for the cron-captured embeddings) ──────
  const CUISINES = ["japanese", "indian", "chinese", "french", "american", "korean", "thai", "italian", "vietnamese", "mediterranean"];
  const PROTEINS = ["fish", "vegan", "beef", "chicken", "egg", "vegetarian", "shellfish", "pork", "tofu"];
  // Keyword axes matched against title + description + ingredients.
  const KEYWORDS = {
    soup: /soup|stew|broth|dal|chowder/, braise: /brais|short rib|slow|shoulder/, grill: /grill|char|broil|sear/,
    roast: /roast|sheet.?pan|crispy/, noodle: /noodle|pasta|ramen|banh/, rice: /rice|donburi|fried rice|risotto/,
    bowl: /bowl|grain|farro/, curry: /curry|coconut|dal/, salad: /salad|slaw|cucumber/, bright: /lemon|lime|herb|bright|fresh|spring/,
    spicy: /chili|gochujang|sichuan|curry paste|kimchi|doubanjiang/, cozy: /braise|stew|soup|cozy|winter|bean/,
    seafood: /salmon|shrimp|fish|seafood/, bean: /bean|lentil|chickpea|tofu/, baked: /cookie|galette|pizza|pastry|bake/,
    quick: /15|20|25|weeknight|quick|one.?pan/,
  };
  const KEYS = Object.keys(KEYWORDS);
  const W_CUISINE = 1.0, W_PROTEIN = 1.1, W_TIME = 0.5, W_KEY = 0.8;

  function timeBand(t) { return t <= 30 ? 0 : t <= 60 ? 0.5 : 1; }

  function recipeText(r) {
    return (r.title + " " + (r.description || "") + " " + r.ingredients.join(" ") + " " + r.slug).toLowerCase();
  }

  function recipeVector(r) {
    const v = [];
    CUISINES.forEach((c) => v.push(r.cuisine === c ? W_CUISINE : 0));
    PROTEINS.forEach((p) => v.push(r.protein === p ? W_PROTEIN : 0));
    v.push(timeBand(r.time) * W_TIME);
    const txt = recipeText(r);
    KEYS.forEach((k) => v.push(KEYWORDS[k].test(txt) ? W_KEY : 0));
    return normalize(v);
  }

  // Build a vibe's query vector from its saved spec (vibe phrase + facets) +
  // weather-affinity keywords — the same axes as a recipe, so cosine is defined.
  function vibeVector(vibe) {
    const v = [];
    const facets = vibe.facets || {};
    CUISINES.forEach((c) => v.push(facets.cuisine === c ? W_CUISINE : 0));
    PROTEINS.forEach((p) => v.push(facets.protein === p ? W_PROTEIN : 0));
    // Time band from a max_time facet (fast spec pulls toward the quick band).
    v.push(facets.max_time ? timeBand(facets.max_time) * W_TIME : 0.25 * W_TIME);
    const txt = (vibe.vibe + " " + (vibe.weather_affinity || []).join(" ")).toLowerCase();
    KEYS.forEach((k) => v.push(KEYWORDS[k].test(txt) ? W_KEY : 0));
    return normalize(v);
  }

  // Build a query vector from arbitrary freeform text (the one optional embed).
  function textVector(text) {
    const v = [];
    const t = String(text || "").toLowerCase();
    CUISINES.forEach((c) => v.push(new RegExp(c).test(t) ? W_CUISINE : 0));
    PROTEINS.forEach((p) => v.push(new RegExp(p).test(t) ? W_PROTEIN : 0));
    v.push(0.25 * W_TIME);
    KEYS.forEach((k) => v.push(KEYWORDS[k].test(t) ? W_KEY : 0));
    return normalize(v);
  }

  function normalize(v) {
    let n = 0; for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  }
  function cosine(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

  // Memoized recipe vectors.
  const _rv = {};
  function rv(slug) { return _rv[slug] || (_rv[slug] = recipeVector(CB.bySlug(slug))); }

  // ── deterministic RNG (seeded) ────────────────────────────────────────────
  function hashStr(str) { let s = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { s ^= str.charCodeAt(i); s = Math.imul(s, 16777619); } return s >>> 0; }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function jitter(seed, key) { return mulberry(hashStr(key) ^ (seed * 2654435761))(); }

  // ── cadence-as-debt ───────────────────────────────────────────────────────
  const DAY = 86400000;
  function debtOf(vibe) {
    if (!vibe.last_satisfied) return 1.6; // never satisfied ⇒ overdue-ish
    const days = Math.max(0, (Date.now() - vibe.last_satisfied) / DAY);
    return days / Math.max(1, vibe.cadence_days);
  }
  // Sampling weight rises monotonically with debt, bounded.
  function debtWeight(debt) { return 0.15 + Math.min(debt, 2.2); }

  // ── weather ─────────────────────────────────────────────────────────────
  // Average affinity overlap of a vibe against the week's per-day meal_vibes.
  function weatherWeight(vibe, forecast) {
    const aff = vibe.weather_affinity || [];
    if (!forecast || !forecast.length || !aff.length || aff.indexOf("any") >= 0) return 1;
    let best = 0, sum = 0;
    forecast.forEach((d) => {
      const overlap = d.vibes.filter((x) => aff.indexOf(x) >= 0).length;
      const frac = overlap / aff.length;
      sum += frac; if (frac > best) best = frac;
    });
    return 1 + 0.6 * (sum / forecast.length) + 0.3 * best; // soft reweight, never zeros a vibe out
  }
  // Best-fitting forecast day for a vibe (for the "fits Wed's cold evening" line).
  function bestDay(vibe, forecast) {
    if (!forecast || !forecast.length) return null;
    const aff = vibe.weather_affinity || [];
    let best = null, bestN = -1;
    forecast.forEach((d) => { const n = d.vibes.filter((x) => aff.indexOf(x) >= 0).length; if (n > bestN) { bestN = n; best = d; } });
    return bestN > 0 ? best : null;
  }

  // ── Level 1: shape the week ───────────────────────────────────────────────
  // Returns an ordered list of vibe slots (deduped, near-duplicate vibes avoided).
  function shapeWeek(palette, forecast, nights, seed, lockedVibeIds) {
    const embedded = palette.filter((v) => v.embedded !== false); // "not yet indexed" vibes sit out
    const scored = embedded.map((v) => {
      const debt = debtOf(v);
      const w = debtWeight(debt) * weatherWeight(v, forecast) * (0.8 + 0.4 * jitter(seed, v.id));
      return { vibe: v, debt, weight: w };
    });
    const picked = [];
    const usedVecs = [];
    const takeVibe = (entry) => {
      picked.push(entry.vibe);
      usedVecs.push(vibeVector(entry.vibe));
    };
    // 1) force-place locked vibes, then "due" vibes (debt ≥ 1) by debt-rank.
    const locked = scored.filter((e) => lockedVibeIds && lockedVibeIds.indexOf(e.vibe.id) >= 0);
    locked.forEach((e) => { if (picked.length < nights && picked.indexOf(e.vibe) < 0) takeVibe(e); });
    const due = scored.filter((e) => e.debt >= 1 && picked.indexOf(e.vibe) < 0).sort((a, b) => b.debt - a.debt);
    for (const e of due) {
      if (picked.length >= nights) break;
      // avoid near-duplicate vibe already placed
      if (usedVecs.some((u) => cosine(u, vibeVector(e.vibe)) > 0.9)) continue;
      takeVibe(e);
    }
    // 2) seeded weighted sampling for the rest (still avoiding near-dupes).
    let pool = scored.filter((e) => picked.indexOf(e.vibe) < 0);
    while (picked.length < nights && pool.length) {
      const total = pool.reduce((s, e) => s + e.weight, 0);
      let r = jitter(seed, "pick" + picked.length) * total, chosen = pool[0];
      for (const e of pool) { r -= e.weight; if (r <= 0) { chosen = e; break; } }
      if (!usedVecs.some((u) => cosine(u, vibeVector(chosen.vibe)) > 0.9)) takeVibe(chosen);
      pool = pool.filter((e) => e.vibe !== chosen.vibe);
    }
    return picked;
  }

  // ── Level 2: fill a slot with a diversified pick (MMR + facet caps) ───────
  const MEAL_PREP = new Set(["weeknight-red-lentil-dal", "tuscan-white-bean-soup", "mapo-tofu", "kimchi-fried-rice", "herby-spring-grain-bowl", "coconut-shrimp-curry"]);
  // Curated corpus pairings (pairs_with) then a cuisine-keyed side fallback.
  const PAIRS = {
    "miso-butter-salmon": ["steamed jasmine rice", "smashed cucumber salad"],
    "red-wine-braised-short-ribs": ["buttered egg noodles", "roasted broccoli"],
    "crispy-sheet-pan-chicken-thighs": ["simple green salad", "crusty bread"],
    "summer-tomato-galette": ["big green salad"],
    "classic-margherita-pizza": ["arugula salad"],
    "lemongrass-pork-banh-mi": ["quick-pickled carrots"],
    "green-shakshuka": ["warm pita", "crusty bread"],
    "mapo-tofu": ["steamed jasmine rice"],
    "miso-glazed-eggplant-donburi": ["quick-pickled cucumber"],
  };
  const SIDE_BY_CUISINE = { italian: "garlic bread", french: "simple green salad", american: "house salad", thai: "steamed jasmine rice", chinese: "steamed jasmine rice", korean: "steamed jasmine rice", japanese: "miso soup", mediterranean: "warm pita" };
  // One-dish meals: a side is optional, so an unfilled side is expected, not a defect.
  const ONE_DISH = new Set(["weeknight-red-lentil-dal", "tuscan-white-bean-soup", "kimchi-fried-rice", "herby-spring-grain-bowl", "coconut-shrimp-curry", "smashed-cucumber-salad"]);

  function composeSides(r) {
    if (PAIRS[r.slug]) return { sides: PAIRS[r.slug].slice(0, 2), unfilled: false, oneDish: false };
    if (ONE_DISH.has(r.slug)) return { sides: [], unfilled: true, oneDish: true };
    const s = SIDE_BY_CUISINE[r.cuisine];
    return s ? { sides: [s], unfilled: false, oneDish: false } : { sides: [], unfilled: true, oneDish: false };
  }

  function dietBlock(r, avoid) {
    if (avoid.indexOf(r.protein) >= 0) return true;
    return r.ingredients.some((ing) => avoid.some((a) => ing.toLowerCase().includes(a.toLowerCase())));
  }

  function relScore(r, vibeVec, ctx, seed) {
    const cos = cosine(vibeVec, rv(r.slug));
    let nf = 0; ctx.favVecs.forEach((fv) => { const c = cosine(fv, rv(r.slug)); if (c > nf) nf = c; });
    const fresh = ctx.recent.has(r.slug) ? 0.2 : 1;
    const per = window.APP.perishableOf(r);
    const overlap = per.length ? per.filter((p) => ctx.pantry.has(normName(p)) || ctx.atRisk.has(normName(p))).length / per.length : 0;
    let s = 0.55 * cos + 0.20 * nf + 0.10 * fresh + 0.15 * overlap;
    if (ctx.freeformVec) s += 0.14 * cosine(ctx.freeformVec, rv(r.slug));
    if (ctx.proteinWants && ctx.proteinWants.length && ctx.proteinWants.indexOf(r.protein) >= 0) s += 0.15;
    s += (jitter(seed, r.slug) - 0.5) * 0.03; // seeded tie-break jitter
    return { s, cos, nf, overlap };
  }
  function normName(s) { return String(s).toLowerCase().trim(); }

  // The time cap for a slot: a per-slot override the member set, else the vibe's
  // own max_time facet (so time maps to each night, not one global cap).
  function effectiveMax(vibe, opts) {
    const sm = opts.slotMaxTime || {};
    if (Object.prototype.hasOwnProperty.call(sm, vibe.id)) return sm[vibe.id]; // null ⇒ Any
    return (vibe.facets && vibe.facets.max_time) || null;
  }

  // Select one recipe for `vibe`, diversified against `selected` (MMR).
  function fillSlot(vibe, ctx, selectedSlugs, opts) {
    const vibeVec = vibeVector(vibe);
    const lambda = opts.lambda;
    const maxT = effectiveMax(vibe, opts);
    const pinP = (opts.slotProtein || {})[vibe.id] || null;
    const pinC = (opts.slotCuisine || {})[vibe.id] || null;
    const proteinCount = {};
    selectedSlugs.forEach((sl) => { const p = CB.bySlug(sl).protein; proteinCount[p] = (proteinCount[p] || 0) + 1; });
    const cands = CB.RECIPES.filter((r) =>
      !selectedSlugs.includes(r.slug) &&
      (!opts.excluded || opts.excluded.indexOf(r.slug) < 0) &&
      !dietBlock(r, ctx.avoid) &&
      (!maxT || r.time <= maxT) &&
      (!pinP || r.protein === pinP) &&
      (!pinC || r.cuisine === pinC)
    );
    const gateCount = cands.length;
    const ranked = cands.map((r) => {
      const rel = relScore(r, vibeVec, ctx, opts.seed);
      let maxSim = 0; selectedSlugs.forEach((sl) => { const c = cosine(rv(sl), rv(r.slug)); if (c > maxSim) maxSim = c; });
      const mmr = lambda * rel.s - (1 - lambda) * maxSim;
      return { r, rel, maxSim, mmr };
    }).sort((a, b) => b.mmr - a.mmr);
    // facet-spread: skip a pick whose protein already hit the per-week cap (2),
    // unless nothing else survives.
    const CAP = 2;
    let chosen = ranked.find((x) => (proteinCount[x.r.protein] || 0) < CAP) || ranked[0];
    if (!chosen) return { empty: true, reason: "No makeable recipe fits this vibe under your current filters." };
    return { pick: chosen, gateCount, ranked };
  }

  function whyFor(pick, vibe, ctx, dayFit) {
    const why = [];
    if (pick.rel.nf > 0.82) {
      let best = null, bc = 0; ctx.favList.forEach((fr) => { const c = cosine(rv(fr.slug), rv(pick.r.slug)); if (c > bc) { bc = c; best = fr; } });
      if (best && best.slug === pick.r.slug) why.push("One of your favorites");
      else if (best) why.push("Close to " + best.title);
    }
    if (pick.rel.overlap > 0) {
      const per = window.APP.perishableOf(pick.r).find((p) => ctx.atRisk.has(normName(p))) || window.APP.perishableOf(pick.r).find((p) => ctx.pantry.has(normName(p)));
      if (per) why.push((ctx.atRisk.has(normName(per)) ? "Uses up " : "Uses ") + per + " you have");
    }
    if (dayFit) why.push("Fits " + dayFit.label + "’s " + dayFit.cond + " weather");
    if (ctx.proteinWants && ctx.proteinWants.indexOf(pick.r.protein) >= 0 && why.length < 3) why.push("The " + pick.r.protein + " you asked for");
    if (!ctx.recent.has(pick.r.slug) && !ctx.favSet.has(pick.r.slug) && why.length < 2) why.push("Something new for you");
    if (!why.length) why.push("Matches “" + vibe.vibe + "”");
    return why.slice(0, 3);
  }

  // ── the tool: build a structured proposal ─────────────────────────────────
  function build(state, opts) {
    opts = Object.assign({ seed: 1, nights: 3, lambda: 0.6, slotMaxTime: {}, slotVibe: {}, slotProtein: {}, slotCuisine: {}, proteinWants: [], freeform: "", locked: {}, overrides: {}, excluded: [] }, opts || {});
    const prof = state.profile || {};
    const avoid = ((prof.dietary && prof.dietary.avoid) || []).map((a) => a.toLowerCase());
    const forecast = state.weather || [];
    const favList = state.favorites.map((s) => CB.bySlug(s)).filter(Boolean);
    const pantrySet = new Set((state.pantry || []).map((p) => normName(p.name)));
    const atRisk = new Set((state.pantry || []).filter(pantryAtRisk).map((p) => normName(p.name)));
    const recent = new Set((state.cookingLog || []).slice(0, 6).map((c) => c.recipe).filter(Boolean));
    const ctx = {
      avoid, favVecs: favList.map((r) => rv(r.slug)), favList, favSet: new Set(favList.map((r) => r.slug)),
      pantry: pantrySet, atRisk, recent, proteinWants: opts.proteinWants || [],
      freeformVec: (opts.freeform && opts.freeform.trim()) ? textVector(opts.freeform) : null,
    };

    const lockedIds = Object.keys(opts.locked || {});
    const vibes = shapeWeek(state.nightVibes || [], forecast, opts.nights, opts.seed, lockedIds);

    const slots = [];
    const selected = [];
    vibes.forEach((vibe) => {
      // The member can type over the planner's assigned vibe for this night; the
      // edited phrase re-queries the fill (its keywords reshape the vibe vector).
      const editText = ((opts.slotVibe && opts.slotVibe[vibe.id]) || "").trim();
      const effVibe = editText ? Object.assign({}, vibe, { vibe: editText }) : vibe;
      const dayFit = bestDay(vibe, forecast);
      const pinnedSlug = opts.locked[vibe.id] || opts.overrides[vibe.id];
      const res = fillSlot(effVibe, ctx, selected, opts);
      if (res.empty && !(pinnedSlug && CB.bySlug(pinnedSlug))) {
        slots.push({ slotId: vibe.id, vibeId: vibe.id, vibeLabel: effVibe.vibe, vibeEdited: !!editText, empty: true, reason: res.reason, locked: false });
        return;
      }
      let pickEntry;
      if (pinnedSlug && CB.bySlug(pinnedSlug)) {
        const r = CB.bySlug(pinnedSlug);
        pickEntry = { r, rel: relScore(r, vibeVector(effVibe), ctx, opts.seed) };
      } else pickEntry = res.pick;
      selected.push(pickEntry.r.slug);
      const sd = composeSides(pickEntry.r);
      // full ranked pool (minus the chosen pick) powers the swap intents
      const ranked = (res.ranked || []).filter((x) => x.r.slug !== pickEntry.r.slug);
      const alternates = ranked.slice(0, 6).map((x) => x.r);
      let sim = null, simC = -1;
      ranked.forEach((x) => { const c = cosine(rv(pickEntry.r.slug), rv(x.r.slug)); if (c > simC) { simC = c; sim = x.r; } });
      const diff = (ranked.find((x) => x.r.cuisine !== pickEntry.r.cuisine) || {}).r || null;
      const so = slotObj(effVibe, pickEntry, sd, ctx, dayFit, !!opts.locked[vibe.id], alternates, { similar: sim, different: diff }, effectiveMax(effVibe, opts));
      so.vibeEdited = !!editText;
      slots.push(so);
    });

    // cross-slot perishable-waste flag: a perishable used by exactly one slot,
    // below a shared purchase (nobody else needs it).
    const perUse = {};
    slots.forEach((s) => { if (s.empty) return; window.APP.perishableOf(CB.bySlug(s.main.slug)).forEach((p) => { const k = normName(p); (perUse[k] = perUse[k] || []).push(s.slotId); }); });
    slots.forEach((s) => {
      if (s.empty) return;
      const solo = window.APP.perishableOf(CB.bySlug(s.main.slug)).find((p) => perUse[normName(p)].length === 1 && !pantrySet.has(normName(p)));
      if (solo) s.flags.push({ type: "waste", label: "Single-use: " + solo });
    });

    return { slots, variety: varietyOf(slots), nights: opts.nights, seed: opts.seed, lambda: opts.lambda, forecast };
  }

  function slotObj(vibe, pick, sd, ctx, dayFit, locked, alternates, altTargets, maxTime) {
    const r = pick.r;
    const flags = [];
    if (MEAL_PREP.has(r.slug)) flags.push({ type: "meal-prep", label: "Meal-preps well" });
    if (sd.unfilled) flags.push({ type: "side", label: sd.oneDish ? "One-dish — sides optional" : "No corpus side — add your own" });
    const lite = (x) => x ? { slug: x.slug, title: x.title, protein: x.protein, cuisine: x.cuisine } : null;
    return {
      slotId: vibe.id, vibeId: vibe.id, vibeLabel: vibe.vibe, weatherFit: dayFit, maxTime: maxTime,
      main: { slug: r.slug, title: r.title, description: r.description, protein: r.protein, cuisine: r.cuisine, time: r.time, score: Math.round(pick.rel.s * 100) / 100 },
      sides: sd.sides, sideUnfilled: sd.unfilled,
      why: whyFor(pick, vibe, ctx, dayFit), flags, locked,
      alternates: (alternates || []).map(lite),
      altSimilar: altTargets ? lite(altTargets.similar) : null,
      altDifferent: altTargets ? lite(altTargets.different) : null,
    };
  }

  function varietyOf(slots) {
    const filled = slots.filter((s) => !s.empty);
    const cuisines = {}, proteins = {};
    filled.forEach((s) => { cuisines[s.main.cuisine] = (cuisines[s.main.cuisine] || 0) + 1; proteins[s.main.protein] = (proteins[s.main.protein] || 0) + 1; });
    const maxP = Math.max(0, ...Object.values(proteins));
    return {
      nights: filled.length,
      cuisines: Object.keys(cuisines).length, proteins: Object.keys(proteins).length,
      proteinHist: Object.entries(proteins).sort((a, b) => b[1] - a[1]),
      cuisineList: Object.keys(cuisines),
      repeated: maxP > 1,
    };
  }

  // pantry "at-risk" = a perishable category not verified in a while (mirrors pantry page).
  const PERISHABLE = new Set(["produce", "dairy", "seafood", "meat"]);
  function pantryAtRisk(p) {
    if (!PERISHABLE.has(p.category)) return false;
    const d = Math.floor((Date.now() - Date.parse(p.last_verified_at + "T00:00:00")) / DAY);
    return d >= 7;
  }

  // ── profile reconciliation: deterministic signal pass ─────────────────────
  // Reconciles STATED palette against REVEALED behavior (cooking log + favorites),
  // producing pending proposals the member confirms. No AI — set math + tallies.
  function reconcile(state) {
    const vibes = state.nightVibes || [];
    const log = state.cookingLog || [];
    const out = [];

    // 1) DRIFT → ADD: the single most-cooked cuisine (≥2 cooks) with no vibe.
    const cuisineTally = {};
    log.forEach((c) => { if (c.cuisine && c.type === "cooked") cuisineTally[c.cuisine] = (cuisineTally[c.cuisine] || 0) + 1; });
    const covered = (cui) => vibes.some((v) => (v.facets && v.facets.cuisine === cui) || new RegExp(cui, "i").test(v.vibe));
    const driftCui = Object.entries(cuisineTally).sort((a, b) => b[1] - a[1]).find(([cui, n]) => n >= 2 && !covered(cui));
    if (driftCui) {
      out.push({
        signature: "add-cuisine-" + driftCui[0], type: "add",
        title: "Add a “" + CB.cap(driftCui[0]) + " night” vibe",
        rationale: "You’ve cooked " + CB.cap(driftCui[0]) + " " + driftCui[1] + " times lately, but no night vibe captures it — your palette is missing a shape you clearly repeat.",
        vibe: { vibe: CB.cap(driftCui[0]) + " night", facets: { cuisine: driftCui[0] }, cadence_days: 14, weather_affinity: ["any"], season: null },
      });
    }

    // 2) PRUNE / STRETCH: the single most-overdue vibe you've never actually
    //    cooked from (no slot provenance) — revealed behavior says it isn't in the
    //    rotation. Prune it, or stretch its cadence so it stops crowding proposals.
    const provCount = (id) => log.filter((c) => c.satisfied_vibe === id).length;
    const stale = vibes
      .filter((v) => provCount(v.id) === 0 && debtOf(v) >= 1.4)
      .sort((a, b) => debtOf(b) - debtOf(a))[0];
    if (stale) {
      out.push({
        signature: "prune-" + stale.id, type: "prune", vibeId: stale.id,
        title: "Retire or stretch “" + stale.vibe + "”",
        rationale: "You’ve never cooked from this vibe and it’s sat idle past its " + stale.cadence_days + "-day cadence. Prune it, or stretch the cadence so it stops crowding your week.",
        suggestCadence: Math.min(60, Math.round(stale.cadence_days * 2)),
      });
    }

    // 3) ADJUST → TIGHTEN: a vibe you satisfy well ahead of its cadence (real
    //    appetite outpaces the stated period).
    const tighten = vibes.find((v) => provCount(v.id) >= 2 && v.last_satisfied && debtOf(v) < 0.5 && v.cadence_days > 7);
    if (tighten) {
      out.push({
        signature: "tighten-" + tighten.id, type: "adjust", vibeId: tighten.id,
        title: "Cook “" + tighten.vibe + "” more often",
        rationale: "You keep satisfying this well before its " + tighten.cadence_days + "-day cadence comes due — the stated period is slower than your real appetite.",
        suggestCadence: Math.max(5, Math.round(tighten.cadence_days * 0.6)),
      });
    }

    return out;
  }

  window.PROPOSE = { build, reconcile, debtOf, weatherWeight, bestDay, vibeVector, cosine, recipeVector, MEAL_PREP, pantryAtRisk };
})();
