// Spike runner (tasks 0.2/0.4): classify every eval recipe with each candidate Workers AI
// model, validate the output against the REAL contract (src/recipe-contract.js), and score
// facets vs gold. Prints per-model aggregates + the silent-failure misses (season,
// requires_equipment) and every validity failure, for eyeballing.
//
// Usage: CLOUDFLARE_API_TOKEN must be set. node scripts/spike-discovery-classify/run.mjs
//   env: CF_ACCOUNT_ID (default discovered account), MODELS (comma list), REPEAT (default 1)

import { EVAL } from "./eval-set.mjs";
import { buildMessages, MODEL_FIELDS } from "./prompt.mjs";
import { validateRecipeContract } from "../../src/recipe-contract.js";

const ACCOUNT = process.env.CF_ACCOUNT_ID || "552766ebb0cb54261720167eb830466c";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) {
  console.error("CLOUDFLARE_API_TOKEN is required");
  process.exit(1);
}

const MODELS = (
  process.env.MODELS ||
  "@cf/mistralai/mistral-small-3.1-24b-instruct,@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/meta/llama-3.1-8b-instruct-fast"
).split(",");

const CONCURRENCY = 5;

async function callModel(model, recipe) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: buildMessages(recipe), max_tokens: 700, temperature: 0.1 }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`API: ${JSON.stringify(data.errors)}`);
  // Workers AI auto-parses a JSON response into an object; a prose response stays a
  // string. Return whatever it is and let the caller normalize.
  return data.result?.response;
}

/** Pull the first JSON object out of a model response (tolerate code fences / prose). */
function extractJson(text) {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

// --- scoring helpers ---------------------------------------------------------
const norm = (s) =>
  String(s).toLowerCase().trim().replace(/\s+/g, " ").replace(/es$/, "").replace(/s$/, "");
const toSet = (a) => new Set((Array.isArray(a) ? a : a == null ? [] : [a]).map(norm));

function setEq(pred, gold) {
  const p = toSet(pred),
    g = toSet(gold);
  if (p.size !== g.size) return false;
  for (const x of g) if (!p.has(x)) return false;
  return true;
}

function setOverlap(pred, gold) {
  // looser than setEq: true if the sets share any member OR both empty
  const p = toSet(pred),
    g = toSet(gold);
  if (g.size === 0) return p.size === 0;
  for (const x of g) if (p.has(x)) return true;
  return false;
}

function f1(pred, gold) {
  const p = toSet(pred),
    g = toSet(gold);
  if (g.size === 0 && p.size === 0) return 1;
  if (p.size === 0 || g.size === 0) return 0;
  let tp = 0;
  for (const x of p) if (g.has(x)) tp++;
  const prec = tp / p.size,
    rec = tp / g.size;
  return prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
}

function scoreRecipe(out, recipe) {
  const g = recipe.gold;
  const proteinOk = norm(out.protein ?? "null") === norm(g.protein ?? "null");
  const cuisineAccept = g.cuisineAccept ? g.cuisineAccept.map(norm) : [norm(g.cuisine ?? "null")];
  const cuisineOk = cuisineAccept.includes(norm(out.cuisine ?? "null"));
  const courseOk = g.courseLoose ? setOverlap(out.course, g.course) : setEq(out.course, g.course);
  const seasonOk = g.seasonLoose
    ? setEq(out.season, g.season) || toSet(out.season).size === 0
    : setEq(out.season, g.season);
  const equipOk = setEq(out.requires_equipment, g.requires_equipment);
  const sstHas = Array.isArray(out.side_search_terms) && out.side_search_terms.length > 0;
  const sstOk = g.isMain ? sstHas : true; // presence rule (non-mains may be [] or not scored)
  return {
    proteinOk,
    cuisineOk,
    courseOk,
    seasonOk,
    equipOk,
    sstOk,
    perishF1: f1(out.perishable_ingredients, g.perishable_ingredients),
    ingF1: f1(out.ingredients_key, g.ingredients_key),
    dietF1: f1(out.dietary, g.dietary),
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function runModel(model) {
  const rows = await mapLimit(EVAL, CONCURRENCY, async (recipe) => {
    let raw, parsed, err;
    try {
      raw = await callModel(model, recipe);
      parsed = raw && typeof raw === "object" ? raw : extractJson(String(raw ?? ""));
    } catch (e) {
      err = e.message;
    }
    if (!parsed) return { recipe, parseFail: true, err, raw };
    // Merge pipeline-set fields so the REAL validator runs over a complete frontmatter.
    const fm = { title: recipe.title, source: null, pairs_with: [], ...parsed };
    for (const k of MODEL_FIELDS) if (!(k in fm)) fm[k] = undefined;
    const errors = validateRecipeContract(fm);
    return { recipe, parsed, valid: errors.length === 0, errors, score: scoreRecipe(parsed, recipe) };
  });
  return rows;
}

function pct(n, d) {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}%`;
}
function avg(xs) {
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "—";
}

async function main() {
  for (const model of MODELS) {
    console.log(`\n${"=".repeat(78)}\nMODEL: ${model}\n${"=".repeat(78)}`);
    const rows = await runModel(model);
    const ok = rows.filter((r) => !r.parseFail);
    const valid = ok.filter((r) => r.valid);
    const sc = ok.filter((r) => r.score).map((r) => r.score);
    const cnt = (k) => sc.filter((s) => s[k]).length;

    console.log(
      `parse-ok: ${ok.length}/${rows.length}   VALID (passes contract): ${valid.length}/${rows.length}  (${pct(valid.length, rows.length)})`,
    );
    console.log(
      `facet exact-accuracy:  protein ${pct(cnt("proteinOk"), sc.length)}  cuisine ${pct(cnt("cuisineOk"), sc.length)}  course ${pct(cnt("courseOk"), sc.length)}  season ${pct(cnt("seasonOk"), sc.length)}  equipment ${pct(cnt("equipOk"), sc.length)}  side_terms ${pct(cnt("sstOk"), sc.length)}`,
    );
    console.log(
      `fuzzy F1:  perishable ${avg(sc.map((s) => s.perishF1))}  ingredients_key ${avg(sc.map((s) => s.ingF1))}  dietary ${avg(sc.map((s) => s.dietF1))}`,
    );

    // Loud failures (rejected on write) — the retry/park cases.
    const fails = rows.filter((r) => r.parseFail || !r.valid);
    if (fails.length) {
      console.log(`\n  LOUD failures (${fails.length}):`);
      for (const r of fails)
        console.log(
          `   - ${r.recipe.id}: ${r.parseFail ? `parse/JSON fail (${r.err ?? "no json"})` : r.errors.join("; ")}`,
        );
    }
    // Silent-failure fields — the ones that wrongly hide/bury a recipe.
    const seasonMiss = ok.filter((r) => r.score && !r.score.seasonOk);
    const equipMiss = ok.filter((r) => r.score && !r.score.equipOk);
    const protMiss = ok.filter((r) => r.score && !r.score.proteinOk);
    const cuisMiss = ok.filter((r) => r.score && !r.score.cuisineOk);
    const show = (label, list, field) => {
      if (!list.length) return;
      console.log(`\n  ${label} misses:`);
      for (const r of list)
        console.log(
          `   - ${r.recipe.id}: got ${JSON.stringify(r.parsed[field])} want ${JSON.stringify(r.recipe.gold[field])}`,
        );
    };
    show("protein", protMiss, "protein");
    show("cuisine", cuisMiss, "cuisine");
    show("season (SILENT)", seasonMiss, "season");
    show("requires_equipment (SILENT)", equipMiss, "requires_equipment");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
