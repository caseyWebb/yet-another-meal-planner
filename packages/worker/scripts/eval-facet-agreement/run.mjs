// Agreement eval (derive-recipe-facets, task 1) — runs the recipe classifier over the
// CURRENT authored corpus and measures, per facet, how often its output AGREES with the
// existing authored frontmatter. This is the gate for the Tier B "trust the classifier as
// default" decision AND the engine for the strip-on-agreement migration: where the
// classifier agrees, the authored frontmatter can be stripped (the facet becomes derived);
// where it disagrees, the authored value is kept as an override.
//
// It CANNOT run in CI / a bare repo — there is no corpus here (the authored corpus lives in
// R2). Point it at a local copy of the corpus (rclone the R2 `recipes/` down, or any dir of
// `recipes/*.md`) and supply a Cloudflare token:
//
//   CLOUDFLARE_API_TOKEN=... CORPUS_DIR=./corpus/recipes \
//     node scripts/eval-facet-agreement/run.mjs            # prints the report
//   ... --plan strip-plan.json                             # also writes the strip plan
//
// env: CF_ACCOUNT_ID (default account), MODEL (default the production classifier),
//      CONCURRENCY (default 5), LIMIT (cap recipes, for a quick look).
//
// The prompt MUST mirror src/discovery-classify.ts (vocab is imported from the single
// source so it can't drift; the prose is kept in sync by hand, like
// scripts/spike-discovery-classify/prompt.mjs).

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import { PROTEIN_VOCAB, CUISINE_VOCAB, SEASON_VOCAB, EQUIPMENT_VOCAB } from "../../src/vocab.js";

const ACCOUNT = process.env.CF_ACCOUNT_ID || "552766ebb0cb54261720167eb830466c";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CORPUS_DIR = process.env.CORPUS_DIR;
const MODEL = process.env.MODEL || "@cf/mistralai/mistral-small-3.1-24b-instruct";
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const PLAN_PATH = (() => {
  const i = process.argv.indexOf("--plan");
  return i !== -1 ? process.argv[i + 1] : null;
})();

if (!TOKEN) die("CLOUDFLARE_API_TOKEN is required");
if (!CORPUS_DIR) die("CORPUS_DIR is required (a dir of recipes/*.md — rclone the R2 corpus down)");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// The Tier A (derived-only) + Tier B (override-default) facets — must mirror
// DERIVED_FACET_FIELDS in src/discovery-classify.ts.
const TIER_B = ["protein", "cuisine", "course", "season", "tags"];
const TIER_A = ["ingredients_key", "perishable_ingredients", "side_search_terms", "meal_preppable"];

// --- the classifier prompt (mirror of src/discovery-classify.ts SYSTEM_PROMPT) ----------
const SYSTEM_PROMPT = [
  "You classify a recipe into a fixed set of metadata facets for a home-cooking app's recipe index. You are given the title, ingredients, and instructions; you output ONLY a JSON object with these keys and nothing else:",
  "- protein: the COARSE bucket, or null (shrimp/crab->shellfish; salmon/cod/tuna->fish; bacon/ham->pork). One of: " +
    PROTEIN_VOCAB.join(" | ") +
    '. "mixed" only for 2+ co-equal proteins. Plant-forward: vegan if no animal products, else vegetarian. null for no protein focus (a side, plain grain/noodle, sauce, drink, or dessert).',
  "- cuisine: the single best bucket, or null. One of: " +
    CUISINE_VOCAB.join(" | ") +
    ". Pick the closest bucket if not listed; null only when genuinely cuisine-agnostic.",
  "- course: a NON-EMPTY array (main | side | dessert | breakfast | snack | sauce | drink | baked_good, ...). Multiple only when it genuinely plates both ways.",
  "- time_total: total minutes as a number, or null.",
  "- ingredients_key: an array of the 5-7 DEFINING ingredients (plain names, no quantities); skip salt/pepper/water/oil unless central.",
  "- dietary: an array of labels the dish ALREADY satisfies (vegetarian, vegan, gluten-free, dairy-free). [] if none. (Vegan implies vegetarian.)",
  "- season: an array from " +
    SEASON_VOCAB.join(" | ") +
    '. DEFAULT []; tag only when dominantly tied to a season. "year-round" is not valid — use []. Lowercase; "fall" not "autumn".',
  "- tags: a few free-form lowercase tags (quick, one-pot, weeknight, spicy). [] if none.",
  '- perishable_ingredients: ingredients that would SPOIL before use (fresh herbs, greens, berries, soft cheese, fresh seafood/meat). EXCLUDE shelf-stable staples. Skip hardy items (potatoes, onions). [] if none.',
  "- requires_equipment: an array from " +
    EQUIPMENT_VOCAB.join(" | ") +
    ". Tag ONLY when genuinely impossible without it. Default []. Over-tagging HIDES a makeable recipe.",
  '- side_search_terms: for a "main", a NON-EMPTY array of 2-3 phrases for the kind of side that completes the plate. [] for non-mains.',
  "- meal_preppable: a boolean — true for good make-ahead/batch/freezer dishes (stews, braises, grain bowls), false for eat-fresh dishes (crisp salads, fried, delicate seafood). When unsure, false.",
  "",
  "Output STRICT JSON with exactly those keys. Stay inside the controlled vocabularies for protein/cuisine/season/requires_equipment. Do not invent attributes; prefer null/[] when unsure.",
].join("\n");

function buildMessages(title, body) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Title: ${title}\n${body}` },
  ];
}

async function callModel(title, body) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: buildMessages(title, body), max_tokens: 700, temperature: 0.1 }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`API: ${JSON.stringify(data.errors)}`);
  const r = data.result?.response;
  if (r && typeof r === "object") return r;
  const t = String(r ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{"),
    e = t.lastIndexOf("}");
  return s === -1 || e === -1 ? null : JSON.parse(t.slice(s, e + 1));
}

// --- agreement scoring -------------------------------------------------------
const norm = (s) => String(s).toLowerCase().trim();
const toSet = (a) => new Set((Array.isArray(a) ? a : a == null ? [] : [a]).map(norm));
const scalarEq = (a, b) => norm(a ?? "null") === norm(b ?? "null");
function setEq(a, b) {
  const p = toSet(a),
    g = toSet(b);
  if (p.size !== g.size) return false;
  for (const x of g) if (!p.has(x)) return false;
  return true;
}
/** Per-field agreement between the classifier output and the authored frontmatter. */
function agree(field, out, authored) {
  if (field === "protein" || field === "cuisine") return scalarEq(out, authored);
  if (field === "meal_preppable") return Boolean(out) === Boolean(authored);
  return setEq(out, authored); // course, season, tags, ingredients_key, perishable_ingredients, side_search_terms
}

function parseRecipe(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fm = loadYaml(m[1]);
  return fm && typeof fm === "object" ? { fm, body: m[2] } : null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const pct = (n, d) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}%`);

async function main() {
  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith(".md")).slice(0, LIMIT);
  if (!files.length) die(`no recipes/*.md in ${CORPUS_DIR}`);
  console.log(`Classifying ${files.length} recipe(s) with ${MODEL}…\n`);

  const rows = await mapLimit(files, CONCURRENCY, async (file) => {
    const slug = file.replace(/\.md$/, "");
    try {
      const parsed = parseRecipe(await readFile(join(CORPUS_DIR, file), "utf8"));
      if (!parsed) return { slug, error: "unparseable" };
      const out = await callModel(typeof parsed.fm.title === "string" ? parsed.fm.title : slug, parsed.body);
      if (!out) return { slug, error: "no-json" };
      const fields = {};
      for (const f of [...TIER_B, ...TIER_A]) {
        // Only score a field the recipe actually authored (an absent authored facet has no
        // "gold" to agree with — it is already effectively derived).
        if (parsed.fm[f] !== undefined) fields[f] = agree(f, out[f], parsed.fm[f]);
      }
      return { slug, fields };
    } catch (e) {
      return { slug, error: e.message };
    }
  });

  // Aggregate per-field agreement.
  const ok = rows.filter((r) => !r.error);
  console.log(`Per-field agreement (classifier vs authored), over recipes that authored the field:\n`);
  for (const f of [...TIER_B, ...TIER_A]) {
    const scored = ok.filter((r) => r.fields[f] !== undefined);
    const agreed = scored.filter((r) => r.fields[f]).length;
    const tier = TIER_B.includes(f) ? "B" : "A";
    console.log(`  [${tier}] ${f.padEnd(22)} ${pct(agreed, scored.length).padStart(4)}  (${agreed}/${scored.length})`);
  }

  const errs = rows.filter((r) => r.error);
  if (errs.length) console.log(`\n${errs.length} recipe(s) errored: ${errs.slice(0, 8).map((r) => `${r.slug} (${r.error})`).join(", ")}`);

  // The strip plan: Tier A → strip unconditionally; Tier B → strip where the classifier
  // agrees with the authored value, keep (as an override) where it disagrees.
  const plan = ok.map((r) => ({
    slug: r.slug,
    stripA: TIER_A.filter((f) => r.fields[f] !== undefined),
    stripB: TIER_B.filter((f) => r.fields[f] === true),
    keepB: TIER_B.filter((f) => r.fields[f] === false),
  }));
  if (PLAN_PATH) {
    await writeFile(PLAN_PATH, JSON.stringify(plan, null, 2));
    console.log(`\nStrip plan written to ${PLAN_PATH} (${plan.length} recipes).`);
  } else {
    const keptB = plan.reduce((n, p) => n + p.keepB.length, 0);
    console.log(`\nStrip plan: ${plan.length} recipes; ${keptB} Tier-B override(s) would be preserved (disagreements). Pass --plan <file> to write it.`);
  }
}

main().catch((e) => die(e.stack || String(e)));
