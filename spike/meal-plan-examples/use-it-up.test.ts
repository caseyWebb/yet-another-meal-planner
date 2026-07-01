// Validation harness for HOLISTIC use-it-up (holistic-use-it-up). A CONTROLLED scenario measuring
// how propose_meal_plan spreads at-risk perishables across a week — emergently, not via one explicit
// query — under three mechanisms, as a before/after:
//   RUN 1 baseline           — no use-it-up at all.
//   RUN 2 legacy uniform boost — the OLD per-slot pantry-overlap nudge (rankCandidates boost).
//   RUN 3 holistic coverage    — the NEW stateful, decrementing set-cover term (ctx.atRiskDemand).
//
// Everything is SYNTHETIC and controlled so we know exactly which recipe uses which perishable and
// exactly how vibe-attractive each recipe is. We do NOT use the real corpus here — its perishables
// are uncontrolled. The embeddings are hand-built 2-D unit vectors placed at chosen ANGLES around
// each vibe anchor, so every query↔recipe cosine is exactly `cos(Δangle)` and we can size the vibe
// gap against each mechanism's lever.
//
// Legacy boost budget (src/semantic-search.ts DEFAULT_RANK_PARAMS): the pantry-overlap term is
//   pantryWeight · min(Σ, overlapCap)/overlapCap  = 0.12 · min(Σ,2)/2
// (a perishable hit = perishWeight 1.0), so ONE at-risk item = +0.06, TWO+ saturate at +0.12 — a
// uniform per-slot nudge with NO cross-slot coordination and NO quantity awareness. The FAR covers
// (vibe gap ≈ 0.219 ≫ 0.12) are unwinnable and ground beef never splits → it tops out at 2/4, split 1.
//
// The NEW coverage term (src/diversify.ts selectOne + ctx.atRiskDemand) competes against NORMALIZED
// pool scores with a saturating, decrementing set-cover credit (coverageWeight 0.35), so it overcomes
// those gaps AND splits the multi-serving item — reaching the IDEAL 4/4, D-split 2 here. This harness
// is the §5.2 tuning surface: adjust coverageWeight / quantity→count and re-run against the real corpus.
//
// NOTE: uses production DEFAULT params — a regression that weakens coverage will fail the final assert.

import { describe, it } from "vitest";

// --- REAL production modules under test (mirror the fixed tool assembly) ---
import { assembleProposal, type ProposalCtx } from "../../src/meal-plan-proposal.js";
import { sampleWeek, type NightVibeSpec } from "../../src/night-vibe-schedule.js";
import { rankCandidates, resolveRankParams, type SearchCandidate } from "../../src/semantic-search.js";
import { filterRecipes, type RecipeIndex } from "../../src/recipes.js";
import type { DiversifyCandidate } from "../../src/diversify.js";

const NOW = new Date("2026-07-01T12:00:00Z");
const rankParams = resolveRankParams(null, undefined);

// ---------------------------------------------------------------------------------------------
// The 4 at-risk perishables. D (ground beef) is MULTI-SERVING — ideally used by TWO mains.
// ---------------------------------------------------------------------------------------------
const A = "cilantro";
const B = "bok choy";
const C = "salmon";
const D = "ground beef"; // ~2 recipes' worth on hand
const AT_RISK = [A, B, C, D];

// ---------------------------------------------------------------------------------------------
// Geometry. Each vibe lives on its own 2-D plane inside a 10-D space (a disjoint pair of axes per
// vibe), so a recipe placed at angle θ on that vibe's plane has cosine `cos(θ)` to that vibe's
// query and ~0 to every other vibe. This lets us set each recipe's vibe-relevance EXACTLY.
//   query for a vibe = angle 0 on its plane.
//   a distractor sits at a SMALL angle (very relevant); a cover recipe sits at a LARGER angle, so
//   the vibe gap = cos(θ_distractor) − cos(θ_cover) is a number we choose vs the 0.06/0.12 boost.
// ---------------------------------------------------------------------------------------------
const DIM = 10;
const rad = (deg: number) => (deg * Math.PI) / 180;
/** Unit vector at angle θ (degrees) on the plane spanned by axes (2k, 2k+1). */
function onPlane(planeIndex: number, deg: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[2 * planeIndex] = Math.cos(rad(deg));
  v[2 * planeIndex + 1] = Math.sin(rad(deg));
  return v;
}
// One plane per vibe.
const PLANE = { fresh: 0, stirfry: 1, fish: 2, hearty: 3, taco: 4 } as const;

// Angles chosen against the boost budget:
//   • A distractor at 10° has cosine 0.985 to its query.
//   • A cover recipe at 40° has cosine 0.766 — gap ≈ 0.219, FAR more than the max 0.12 boost.
//   • A cover recipe at 22° has cosine 0.927 — gap ≈ 0.058, which a TWO-perishable boost (0.12)
//     CAN overcome but a ONE-perishable boost (0.06) only barely ties.
const A_DISTRACT = 10; // cos ≈ 0.985
const A_COVER_NEAR = 22; // cos ≈ 0.927  (gap to distractor ≈ 0.058)
const A_COVER_FAR = 40; // cos ≈ 0.766  (gap to distractor ≈ 0.219)

// ---------------------------------------------------------------------------------------------
// The controlled corpus. Each entry is a FLAT objective recipe (frontmatter fields directly on
// it), exactly as src/recipe-index.ts reconstructs — so we pass the entry AS the frontmatter map
// value (the flat-frontmatter contract the fixed tool relies on).
//
// Cover layout (a valid holistic cover with D used TWICE EXISTS):
//   fish  slot: R1 {salmon, bok choy, cilantro}   — a 3-item cover, but sits FAR (40°) from fish
//               vs the on-vibe cod distractor (10°): gap 0.219 ≫ 0.12 boost → R1 loses the slot.
//   stir  slot: R2 {bok choy, ground beef}         — NEAR (22°); with 2 at-risk items boost 0.12
//               vs tofu distractor (10°): 0.927+0.12=1.047 > 0.985 → R2 CAN win → D used once.
//   taco  slot: R3 {ground beef, cilantro}         — FAR (40°) vs chicken-taco distractor (10°):
//               gap 0.219 ≫ 0.12 → R3 loses → the SECOND ground-beef use never happens (no split).
//   fresh slot: R5 {cilantro}                       — FAR (40°) and ONE at-risk item → boost 0.06;
//               0.766+0.06=0.826 vs herby-pasta distractor 0.985 → R5 robustly loses. Nothing else
//               covers cilantro alone in a winnable slot, so cilantro is MISSED (seed-independent).
//   hearty slot: no at-risk cover exists → a distractor lands (as it should).
// ---------------------------------------------------------------------------------------------
interface Rec {
  slug: string;
  title: string;
  protein: string | null;
  cuisine: string | null;
  course: string[];
  time_total: number;
  perishable_ingredients: string[];
  ingredients_key: string[];
  meal_preppable?: boolean;
  emb: number[];
  note: string;
}

const CORPUS: Rec[] = [
  // --- COVER recipes ---
  { slug: "r1-salmon-bok-choy-cilantro", title: "R1 Salmon w/ Bok Choy & Cilantro", protein: "fish", cuisine: "asian", course: ["main"], time_total: 30, perishable_ingredients: [C, B, A], ingredients_key: [C, B, A, "soy sauce"], emb: onPlane(PLANE.fish, A_COVER_FAR), note: "3-item cover, FAR from fish vibe (loses to cod)" },
  { slug: "r2-beef-bok-choy-stirfry", title: "R2 Beef & Bok Choy Stir-fry", protein: "beef", cuisine: "chinese", course: ["main"], time_total: 25, perishable_ingredients: [B, D], ingredients_key: [D, B, "garlic"], meal_preppable: true, emb: onPlane(PLANE.stirfry, A_COVER_NEAR), note: "2-item cover incl. beef, NEAR stir-fry (boost 0.12 can win)" },
  { slug: "r3-beef-cilantro-tacos", title: "R3 Ground Beef & Cilantro Tacos", protein: "beef", cuisine: "mexican", course: ["main"], time_total: 20, perishable_ingredients: [D, A], ingredients_key: [D, A, "tortillas"], meal_preppable: true, emb: onPlane(PLANE.taco, A_COVER_FAR), note: "2nd beef use, FAR from taco vibe (loses to chicken tacos)" },
  { slug: "r4-simple-salmon", title: "R4 Simple Roast Salmon", protein: "fish", cuisine: "american", course: ["main"], time_total: 15, perishable_ingredients: [C], ingredients_key: [C, "lemon"], emb: onPlane(PLANE.fish, A_COVER_FAR + 8), note: "salmon-only backup, even farther from fish" },
  { slug: "r5-cilantro-lime-rice-bowl", title: "R5 Cilantro-Lime Grain Bowl", protein: "vegetarian", cuisine: "mexican", course: ["main"], time_total: 20, perishable_ingredients: [A], ingredients_key: [A, "rice", "black beans"], meal_preppable: true, emb: onPlane(PLANE.fresh, A_COVER_FAR), note: "1-item cilantro cover, FAR from fresh — boost 0.06 ≪ 0.219 gap, robustly loses to herby pasta" },

  // --- DISTRACTORS: use NONE of the at-risk items, but sit RIGHT on the vibe (10°) so they are the
  //     top vibe match — the pantry boost must overcome the vibe gap to beat them. ---
  { slug: "d1-herby-pasta", title: "D1 Herby Green Pasta (no at-risk)", protein: "vegetarian", cuisine: "italian", course: ["main"], time_total: 20, perishable_ingredients: ["basil", "parmesan"], ingredients_key: ["basil", "pasta"], emb: onPlane(PLANE.fresh, A_DISTRACT), note: "on-vibe fresh distractor" },
  { slug: "d2-tofu-stirfry", title: "D2 Tofu Stir-fry (no at-risk)", protein: "tofu", cuisine: "chinese", course: ["main"], time_total: 20, perishable_ingredients: ["snap peas", "scallions"], ingredients_key: ["tofu", "snap peas"], emb: onPlane(PLANE.stirfry, A_DISTRACT), note: "on-vibe stir-fry distractor" },
  { slug: "d3-cod-piccata", title: "D3 Cod Piccata (no at-risk)", protein: "fish", cuisine: "italian", course: ["main"], time_total: 25, perishable_ingredients: ["cod", "capers"], ingredients_key: ["cod", "lemon"], emb: onPlane(PLANE.fish, A_DISTRACT), note: "on-vibe fish distractor — outranks R1/R4" },
  { slug: "d4-pork-ragu", title: "D4 Pork Ragu (no at-risk)", protein: "pork", cuisine: "italian", course: ["main"], time_total: 90, perishable_ingredients: ["pork shoulder", "carrots"], ingredients_key: ["pork", "tomato"], meal_preppable: true, emb: onPlane(PLANE.hearty, A_DISTRACT), note: "on-vibe hearty distractor (no at-risk cover for this vibe)" },
  { slug: "d5-chicken-tacos", title: "D5 Chicken Tacos (no at-risk)", protein: "chicken", cuisine: "mexican", course: ["main"], time_total: 25, perishable_ingredients: ["chicken thighs", "lime"], ingredients_key: ["chicken", "tortillas"], emb: onPlane(PLANE.taco, A_DISTRACT), note: "on-vibe taco distractor — outranks R3" },
  { slug: "d6-lentil-stew", title: "D6 Lentil Stew (no at-risk)", protein: "vegetarian", cuisine: "mediterranean", course: ["main"], time_total: 45, perishable_ingredients: ["spinach", "celery"], ingredients_key: ["lentils", "tomato"], meal_preppable: true, emb: onPlane(PLANE.hearty, A_DISTRACT + 6), note: "second hearty distractor" },
];

// Build the RecipeIndex-shaped map of FLAT entries + the embeddings map.
const rawIndex: RecipeIndex = {};
const embeddings = new Map<string, number[]>();
for (const r of CORPUS) {
  rawIndex[r.slug] = {
    slug: r.slug,
    title: r.title,
    protein: r.protein ?? undefined,
    cuisine: r.cuisine ?? undefined,
    course: r.course,
    time_total: r.time_total,
    perishable_ingredients: r.perishable_ingredients,
    ingredients_key: r.ingredients_key,
    ...(r.meal_preppable ? { meal_preppable: true } : {}),
  } as RecipeIndex[string];
  embeddings.set(r.slug, r.emb);
}

// ---------------------------------------------------------------------------------------------
// Palette — 5 vibes, one per plane, query at angle 0. No cadence/weather → a clean deterministic
// 5-slot week over all five vibes, so the run-to-run difference is ONLY boost_ingredients.
// ---------------------------------------------------------------------------------------------
interface PVibe {
  id: string;
  vibe: string;
  vec: number[];
  facets?: Record<string, unknown>;
}
const PALETTE: PVibe[] = [
  { id: "fresh-night", vibe: "something fresh and herby", vec: onPlane(PLANE.fresh, 0), facets: { course: "main" } },
  { id: "stir-fry-night", vibe: "a quick stir-fry", vec: onPlane(PLANE.stirfry, 0), facets: { course: "main" } },
  { id: "fish-night", vibe: "a fish dinner", vec: onPlane(PLANE.fish, 0), facets: { course: "main" } },
  { id: "hearty-night", vibe: "something hearty", vec: onPlane(PLANE.hearty, 0), facets: { course: "main" } },
  { id: "taco-night", vibe: "taco night", vec: onPlane(PLANE.taco, 0), facets: { course: "main" } },
];
const vibeVectors = new Map(PALETTE.map((v) => [v.id, v.vec]));

const favoriteVecs: number[][] = []; // no favorites → isolate the pantry boost
const lastCooked = new Map<string, string>(); // nothing cooked → uniform freshness

const POOL_K = 24;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function toDiversify(slug: string, fm: Record<string, unknown>, embedding: number[], score: number, perishable: string[], ingredientsKey: string[], title?: string, protein?: string | null, cuisine?: string | null, timeTotal?: number | null): DiversifyCandidate {
  const course = Array.isArray(fm.course) ? fm.course.filter((x): x is string => typeof x === "string") : [];
  return { slug, title: title ?? str(fm.title) ?? slug, protein: protein ?? str(fm.protein), cuisine: cuisine ?? str(fm.cuisine), course, time_total: timeTotal ?? num(fm.time_total), score, embedding, perishable_ingredients: perishable, ingredients_key: ingredientsKey };
}

/** Rank one vibe's facet-gated survivors into a pool, threading boostItems into rankCandidates
 *  (mirrors src/meal-plan-proposal-tool.ts buildPool). */
function buildPool(vibe: PVibe, vibeVec: number[], boostItems: string[]): DiversifyCandidate[] {
  const survivors = filterRecipes(rawIndex, { ...(vibe.facets ?? {}) }, NOW, []);
  const cands: SearchCandidate[] = [];
  for (const s of survivors) {
    const vec = embeddings.get(s.slug);
    if (!vec) continue;
    const fm = s.frontmatter as Record<string, unknown>;
    cands.push({
      slug: s.slug,
      title: str(fm.title) ?? s.slug,
      description: null,
      protein: str(fm.protein),
      cuisine: str(fm.cuisine),
      time_total: num(fm.time_total),
      embedding: vec,
      last_cooked: lastCooked.get(s.slug) ?? null,
      ingredients_key: strArray(fm.ingredients_key),
      perishable_ingredients: strArray(fm.perishable_ingredients),
    });
  }
  const ranked = rankCandidates(cands, vibeVec, favoriteVecs, boostItems, NOW, rankParams, POOL_K);
  const ingredientsBySlug = new Map(cands.map((cnd) => [cnd.slug, { perishable: cnd.perishable_ingredients, key: cnd.ingredients_key }]));
  const pool: DiversifyCandidate[] = [];
  for (const r of ranked) {
    const vec = embeddings.get(r.slug);
    if (!vec) continue;
    const ing = ingredientsBySlug.get(r.slug);
    pool.push(toDiversify(r.slug, (rawIndex[r.slug] as Record<string, unknown>) ?? {}, vec, r.score, ing?.perishable ?? [], ing?.key ?? [], r.title, r.protein, r.cuisine, r.time_total));
  }
  return pool;
}

/** Run the whole 5-night pipeline. `boostItems` feeds the LEGACY uniform pool boost (rankCandidates);
 *  `demand` feeds the NEW stateful coverage term (ctx.atRiskDemand). No cadence/weather → all 5 vibes
 *  land, so run-to-run differences are only the use-it-up mechanism under test. */
function runPlan(boostItems: string[], demand: Record<string, number>) {
  const debtByVibe = new Map<string, number>();
  const specs: NightVibeSpec[] = PALETTE.map((v) => ({ id: v.id }));
  const shape = sampleWeek(specs, [], debtByVibe, PALETTE.length, 1, undefined);
  const paletteById = new Map(PALETTE.map((v) => [v.id, v]));

  const poolByVibe = new Map<string, DiversifyCandidate[]>();
  for (const slot of shape.slots) {
    const vibe = paletteById.get(slot.id)!;
    poolByVibe.set(slot.id, buildPool(vibe, vibeVectors.get(slot.id)!, boostItems));
  }

  const frontmatterBySlug = new Map<string, Record<string, unknown>>();
  for (const [slug, entry] of Object.entries(rawIndex)) frontmatterBySlug.set(slug, entry as Record<string, unknown>);

  const ctx: ProposalCtx = {
    slots: shape.slots,
    poolByVibe,
    frontmatterBySlug,
    embeddingBySlug: embeddings,
    atRiskDemand: new Map(Object.entries(demand)),
    lastCooked,
    seed: 1,
    whyByVibe: new Map(),
  };
  return assembleProposal(ctx);
}

function report(label: string, boostItems: string[], demand: Record<string, number>) {
  const result = runPlan(boostItems, demand);
  const lines: string[] = [];
  lines.push("");
  lines.push("═".repeat(92));
  lines.push(label);
  lines.push(`  boost_ingredients = [${boostItems.join(", ") || "(none)"}]`);
  lines.push("─".repeat(92));

  const coverage = new Set<string>();
  let dCount = 0;
  for (let i = 0; i < result.plan.length; i++) {
    const slot = result.plan[i];
    if (!slot.main) {
      lines.push(`Night ${i + 1}  [${slot.vibe_id}]  (empty) — ${slot.empty_reason ?? ""}`);
      continue;
    }
    const fm = rawIndex[slot.main.slug] as Record<string, unknown>;
    const perish = strArray(fm.perishable_ingredients);
    const atRiskUsed = perish.filter((p) => AT_RISK.includes(p));
    for (const p of atRiskUsed) coverage.add(p);
    if (perish.includes(D)) dCount++;
    lines.push(`Night ${i + 1}  [${slot.vibe_id}]  → ${slot.main.title}  (score=${slot.main.score})`);
    lines.push(`     at-risk perishables in this main: {${atRiskUsed.join(", ") || "—"}}`);
    lines.push(`     uses_perishables (∩ boost): {${slot.uses_perishables.join(", ") || "—"}}   flags.waste: {${(slot.flags.waste ?? []).join(", ") || "—"}}`);
  }
  lines.push("─".repeat(92));
  const missing = AT_RISK.filter((x) => !coverage.has(x));
  lines.push(`  COVERAGE  : used {${[...coverage].join(", ") || "—"}}  (${coverage.size}/4)` + (missing.length ? `   MISSED: {${missing.join(", ")}}` : "   ← all four covered"));
  lines.push(`  D-SPLIT   : ${dCount} chosen main(s) use "${D}"  (ideal = 2)` + (dCount >= 2 ? "  ← split achieved" : "  ← NOT split"));
  console.log(lines.join("\n"));
  return { coverage, dCount, missing };
}

describe("controlled use-it-up scenario — holistic perishable coverage across a week", () => {
  it("measures baseline vs use-it-up coverage and D-split", () => {
    console.log("");
    console.log("#".repeat(92));
    console.log(`# CONTROLLED USE-IT-UP SCENARIO — synthetic ${CORPUS.length}-recipe corpus, 5 vibes, 5 nights`);
    console.log(`# at-risk perishables: A=${A}  B=${B}  C=${C}  D=${D} (multi-serving, want ×2)`);
    console.log("# pantry boost budget: +0.06 (one at-risk item) / +0.12 (two+, saturated)");
    console.log("#".repeat(92));

    // Hand-computed IDEAL cover (what a coverage-aware, quantity-aware planner WOULD choose):
    console.log("");
    console.log("HAND-COMPUTED IDEAL COVER (coverage- & quantity-aware planner):");
    console.log("   fish → R1 (salmon+bok choy+cilantro)   stir-fry → R2 (bok choy+beef)");
    console.log("   taco → R3 (beef+cilantro)              fresh → R5 (cilantro)   hearty → any distractor");
    console.log("   ⇒ covers {cilantro, bok choy, salmon, ground beef} = 4/4, and ground beef used by 2 mains (R2 & R3)");

    // Quantity-aware demand for the NEW coverage term: A/B/C once, D twice (multi-serving).
    const DEMAND = { [A]: 1, [B]: 1, [C]: 1, [D]: 2 };

    const base = report("RUN 1 — BASELINE (no use-it-up signal at all)", [], {});
    const legacy = report("RUN 2 — LEGACY uniform pool boost (the OLD mechanism)", [A, B, C, D], {});
    const holistic = report("RUN 3 — HOLISTIC coverage (the NEW stateful set-cover term)", [], DEMAND);

    console.log("");
    console.log("═".repeat(92));
    console.log("SUMMARY");
    console.log("─".repeat(92));
    console.log(`  IDEAL              : coverage 4/4, D-split 2`);
    console.log(`  RUN 1 baseline     : coverage ${base.coverage.size}/4 (missed {${base.missing.join(", ") || "—"}}), D-split ${base.dCount}`);
    console.log(`  RUN 2 legacy boost : coverage ${legacy.coverage.size}/4 (missed {${legacy.missing.join(", ") || "—"}}), D-split ${legacy.dCount}`);
    console.log(`  RUN 3 holistic     : coverage ${holistic.coverage.size}/4 (missed {${holistic.missing.join(", ") || "—"}}), D-split ${holistic.dCount}`);
    console.log("─".repeat(92));
    const holisticWorks = holistic.coverage.size === 4 && holistic.dCount >= 2;
    if (holisticWorks) {
      console.log(`  VERDICT: the NEW holistic coverage term reaches the IDEAL — 4/4 coverage and ground beef`);
      console.log(`  SPLIT across two mains — where the legacy uniform boost got only ${legacy.coverage.size}/4 with D-split ${legacy.dCount}.`);
      console.log(`  The stateful, decrementing set-cover coordinates across slots and is quantity-aware.`);
    } else {
      console.log(`  VERDICT: holistic coverage did NOT reach IDEAL (coverage ${holistic.coverage.size}/4, D-split ${holistic.dCount}) —`);
      console.log(`  inspect coverageWeight vs the synthetic vibe gaps (this scenario expects 4/4 + split 2).`);
    }
    console.log("═".repeat(92));
    console.log("");

    // Assert the NEW mechanism achieves what the legacy one could not.
    if (!holisticWorks) throw new Error(`expected holistic coverage 4/4 + D-split ≥2, got ${holistic.coverage.size}/4 split ${holistic.dCount}`);
  });
});
