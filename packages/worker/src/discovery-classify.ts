// Recipe CLASSIFIER for the background discovery sweep (background-discovery-sweep).
//
// Turns raw recipe content (a fetched page's parsed ingredients+instructions, or an email
// body) into the controlled-vocab FACETS create_recipe requires — unattended, on a small
// Workers AI model, with the contract validator as the hard backstop and a corrective
// retry for the rare loud failure. This is the capture leg that used to be Claude-in-chat.
//
// The prompt + model are the conclusion of the Phase-0 spike (scripts/spike-discovery-
// classify/, recorded in the change's design.md, Decision 7): mistral-small-3.1-24b, the
// vocab injected from src/vocab.js (single source of truth — can't drift from the gate),
// few-shot exemplars that anchor the silent-failure calls (shrimp->shellfish, a hard `[]`
// season floor + a year-round exemplar, vegan vs vegetarian), and the guardrails against
// inventing facets on sparse input. `description` is NOT classified here — it stays the
// existing tuned generateDescription; the sweep generates it from these facets.
//
// Same `env.AI` binding + structured-error discipline as src/description.ts and
// src/embedding.ts (any AI failure → a structured ToolError, never a raw throw).

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { runAi, type AiTrigger } from "./ai.js";
import { validateRecipeContract } from "./recipe-contract.js";
import { PROTEIN_VOCAB, CUISINE_VOCAB, SEASON_VOCAB, EQUIPMENT_VOCAB } from "./vocab.js";

/** Classifier model — the spike's pick; swappable config, like DESC_MODEL. */
export const CLASSIFY_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

/** Max corrective retries on a contract-invalid classification before parking. */
export const CLASSIFY_MAX_RETRIES = 2;

/** The judgment fields the model produces (source/pairs_with are pipeline-set). `title` is the
 *  CLEANED dish name — accepted only through the deterministic word-subset guard
 *  (`cleanedTitleOrFallback`), falling back to the raw pipeline title on any rejected/missing
 *  output, so cleaning can never invent an identity or park an import. */
export const CLASSIFIED_FIELDS = [
  "title",
  "protein",
  "cuisine",
  "course",
  "time_total",
  "ingredients_key",
  "ingredients_full",
  "dietary",
  "season",
  "tags",
  "perishable_ingredients",
  "requires_equipment",
  "side_search_terms",
  "meal_preppable",
] as const;

/** The facets the whole-corpus classify pass DERIVES into D1 (recipe-facet-derivation).
 *  A subset of CLASSIFIED_FIELDS: the Tier A (derived-only) + Tier B (override-default)
 *  facets. `time_total`, `dietary`, and `requires_equipment` stay authored (Tier C) and
 *  are NOT derived here even though the model still emits them for the discovery path.
 *  `title` is deliberately absent too: the cleaned title is consumed only by the discovery
 *  import leg and the title re-audit pass — the facet-derivation consumers never read it,
 *  so an authored title is never overridden through the facet path. */
export const DERIVED_FACET_FIELDS = [
  // Tier B — classified default, an authored frontmatter value overrides at merge.
  "protein",
  "cuisine",
  "course",
  "season",
  "tags",
  // Tier A — derived only, no authored override.
  "ingredients_key",
  "ingredients_full",
  "perishable_ingredients",
  "side_search_terms",
  "meal_preppable",
] as const;

export const SYSTEM_PROMPT = [
  "You classify a recipe into a fixed set of metadata facets for a home-cooking app's recipe index. You are given the title, ingredients, and instructions; you output ONLY a JSON object with these keys and nothing else (no prose, no markdown fence):",
  "",
  '- title: the CLEAN dish name. Strip SEO suffixes (a trailing or embedded "Recipe"), marketing qualifiers ("the best", "easy", "homemade", "classic", superlatives like "super soft and tender"), and editorial framing ("A Better X", "Our Go-To X", "Summer Dinner Recipe: X", "(Inspired By ...)"). Only REMOVE words — never add or substitute one. KEEP identity-bearing words that change what the dish IS: dietary qualifiers ("Vegan", "Vegetarian"), method qualifiers ("Slow Cooker", "Grilled"), and named variants. KEEP a foreign dish name over its English gloss, and KEEP an informative parenthetical gloss ("Jatjuk (Pine Nut Porridge)" stays as-is). When unsure, return the title unchanged — an already-clean title comes back identical.',
  "- protein: the COARSE protein bucket, or null. Map specifics to the bucket: shrimp/crab/clam/scallop -> shellfish; salmon/cod/tuna/any finfish -> fish; bacon/ham/sausage -> pork. One of: " +
    PROTEIN_VOCAB.join(" | ") +
    '. Use "mixed" only when two or more distinct animal/meat-substitute proteins are co-equal (e.g. shrimp AND egg AND tofu). For a plant protein-FORWARD dish (beans, lentils, tofu): if it has NO animal products at all (no meat, dairy, egg, honey) use "vegan"; if it has dairy or egg use "vegetarian". Use null when the dish has NO protein focus — a vegetable side, a plain grain/noodle dish, a sauce, a drink, OR a dessert (a custard dessert is null even though it has eggs/cream; they are not the focus). NEVER output "none" or any value off this list.',
  "- cuisine: the single best bucket, or null. One of: " +
    CUISINE_VOCAB.join(" | ") +
    ". If a dish's tradition is not on this list, pick the CLOSEST bucket (e.g. a Middle-Eastern/Levantine dish -> mediterranean; a Tex-Mex dish -> southwestern or mexican). Use null only when the dish is genuinely cuisine-agnostic (a smoothie, plain roasted vegetables, buttered toast). NEVER invent a cuisine not on this list.",
  '- course: a NON-EMPTY array describing the dish type. Open vocabulary — use the natural word: main | side | dessert | breakfast | snack | sauce | drink | baked_good | component, etc. Use "component" for a SUB-RECIPE / building block — a fresh pasta dough, a stock, a spice blend, a base sauce made to be used inside other dishes — something not plated as its own course (a component is not a main, so its side_search_terms is []). Use multiple ONLY when it genuinely plates both ways (a hearty grain salad -> [main, side]). Most dishes are a single course.',
  "- time_total: total minutes as a number, or null if not stated and not obviously inferable.",
  "- ingredients_key: an array of the 5-7 DEFINING ingredients (plain names, no quantities), the ones that make the dish what it is — skip salt, pepper, water, oil unless central.",
  '- ingredients_full: a NON-EMPTY array of EVERY ingredient the body lists — plain names only: no quantities, no prep clauses ("cut into strips", "chopped"), no optional-markers. A disjunctive line ("soy sauce or tamari") records its PRIMARY only. Include the staples ingredients_key skips (salt, oil) when the body lists them; never invent an ingredient the body does not list.',
  "- dietary: an array of dietary labels the dish ALREADY satisfies as written — e.g. vegetarian, vegan, gluten-free, dairy-free. [] if none apply. (Vegan implies vegetarian — include both when vegan.)",
  "- season: an array drawn ONLY from " +
    SEASON_VOCAB.join(" | ") +
    '. DEFAULT TO [] — most dishes are year-round and MUST be []. Tag a season ONLY when the dish is dominantly tied to it by its defining ingredient or temperature: a cold dish built on peak produce (gazpacho, tomato salad -> [summer]), or a long cold-weather braise/roast eaten for warmth. A dish you would happily eat any month — including most curries, stir-fries, pastas, tacos, soups, roasts, and braises — is []. "Hearty" or "warm" alone is NOT enough; when uncertain, output []. "year-round" is NOT a valid value — express it as []. Lowercase only; use "fall", never "autumn".',
  "- tags: a few free-form lowercase tags (e.g. quick, one-pot, weeknight, spicy). [] if none obvious.",
  '- perishable_ingredients: the ingredients that would SPOIL before a typical cook uses them up — the "would the leftover rot" test. Include fast-spoilers even in small amounts (fresh herbs, leafy greens, fresh berries, soft cheese, fresh seafood/meat bought for one dish). EXCLUDE shelf-stable staples (oil, canned/dried/jarred goods, spices, vinegar, soy sauce). Skip fuzzy hardy items (potatoes, onions, hard squash). [] if nothing qualifies.',
  "- requires_equipment: an array drawn ONLY from " +
    EQUIPMENT_VOCAB.join(" | ") +
    ". Tag a slug ONLY when the dish is genuinely IMPOSSIBLE without it — no recipe-preserving workaround. A purée/smoothie that must be smooth -> blender; a churned ice cream -> ice-cream-maker. Default to [] — a stand mixer, food processor (when a blender substitutes), oven, pan, or pressure-cooker-with-a-stovetop-version do NOT count. When unsure, output []. Over-tagging silently HIDES a recipe a cook could make.",
  '- side_search_terms: for a course that includes "main", a NON-EMPTY array of 2-3 short phrases describing the KIND of side that completes the plate (e.g. ["a bright acidic salad", "crusty bread for the sauce"]). For anything that is not a main, output [].',
  "- meal_preppable: a boolean — true when the dish is a good make-ahead / batch / freezer candidate (holds and reheats well, e.g. stews, braises, grain bowls, casseroles, baked goods), false for dishes best eaten fresh (crisp salads, fried foods, delicate seafood, anything that wilts or sogs). When unsure, false.",
  "",
  "Rules: output STRICT JSON with exactly those keys. Stay strictly inside the controlled vocabularies for protein, cuisine, season, and requires_equipment — an off-list value is a hard error. Do not invent ingredients or attributes the recipe does not contain; if the input is sparse, prefer null/[] over guessing.",
].join("\n");

interface Exemplar {
  title: string;
  body: string;
  output: Record<string, unknown>;
}

// Few-shot exemplars (Run-2 spike set) — each anchors a silent-failure call. DIVERGED from
// scripts/spike-discovery-classify/prompt.mjs (the eval that validated the base set): production
// additions since the spike are `ingredients_full`, the component-course exemplar, and the
// cleaned `title` output (the asparagus exemplar carries a flowery input title with the clean
// output; the others echo their already-clean title so the model learns not to rewrite one).
const FEW_SHOT: Exemplar[] = [
  {
    title: "Linguine alle Vongole",
    body: "Ingredients: linguine, fresh littleneck clams, garlic, white wine, red pepper flakes, parsley, olive oil.\nInstructions: Steam the clams open in garlic, wine, and pepper flakes; toss with al dente linguine and parsley.",
    output: {
      title: "Linguine alle Vongole",
      protein: "shellfish",
      cuisine: "italian",
      course: ["main"],
      time_total: 30,
      ingredients_key: ["clams", "linguine", "garlic", "white wine", "parsley"],
      ingredients_full: ["linguine", "clams", "garlic", "white wine", "red pepper flakes", "parsley", "olive oil"],
      dietary: ["dairy-free"],
      season: [],
      tags: ["quick", "seafood"],
      perishable_ingredients: ["clams", "parsley"],
      requires_equipment: [],
      side_search_terms: ["a crisp green salad", "crusty bread for the broth"],
      meal_preppable: false,
    },
  },
  {
    // Anchors the title-clean: a flowery page title resolves to the clean dish name (the
    // method word "Grilled" is identity and stays; "The Best"/"Recipe" framing goes).
    title: "The Best Grilled Asparagus with Lemon Recipe",
    body: "Ingredients: asparagus, olive oil, lemon, flaky salt.\nInstructions: Toss asparagus in oil, grill until charred and tender, finish with lemon and salt.",
    output: {
      title: "Grilled Asparagus with Lemon",
      protein: null,
      cuisine: null,
      course: ["side"],
      time_total: 15,
      ingredients_key: ["asparagus", "lemon", "olive oil"],
      ingredients_full: ["asparagus", "olive oil", "lemon", "flaky salt"],
      dietary: ["vegan", "vegetarian", "gluten-free"],
      season: ["spring"],
      tags: ["quick", "grilled"],
      perishable_ingredients: ["asparagus"],
      requires_equipment: [],
      side_search_terms: [],
      meal_preppable: false,
    },
  },
  {
    // Anchors: a sub-recipe/building block -> component (not main/side/baked_good), with
    // side_search_terms [] — the silent-failure class where doughs/stocks scatter across
    // meal courses and then surface as dinner suggestions.
    title: "Fresh Pasta Dough",
    body: "Ingredients: 00 flour, eggs, salt, olive oil.\nInstructions: Mound the flour, work in the eggs and salt, knead until smooth, rest 30 minutes, then roll into sheets.",
    output: {
      title: "Fresh Pasta Dough",
      protein: null,
      cuisine: "italian",
      course: ["component"],
      time_total: 45,
      ingredients_key: ["flour", "eggs"],
      ingredients_full: ["00 flour", "eggs", "salt", "olive oil"],
      dietary: ["vegetarian"],
      season: [],
      tags: ["from-scratch", "pasta"],
      perishable_ingredients: [],
      requires_equipment: [],
      side_search_terms: [],
      meal_preppable: true,
    },
  },
  {
    // Anchors: plant-only -> vegan (not vegetarian); a hearty curry is still year-round [].
    title: "Chickpea Coconut Curry",
    body: "Ingredients: chickpeas, coconut milk, onion, garlic, ginger, curry powder, tomatoes, spinach.\nInstructions: Simmer aromatics and spices, add chickpeas, coconut milk, and tomatoes, wilt in spinach.",
    output: {
      title: "Chickpea Coconut Curry",
      protein: "vegan",
      cuisine: "indian",
      course: ["main"],
      time_total: 35,
      ingredients_key: ["chickpeas", "coconut milk", "spinach", "curry powder", "tomatoes"],
      ingredients_full: ["chickpeas", "coconut milk", "onion", "garlic", "ginger", "curry powder", "tomatoes", "spinach"],
      dietary: ["vegan", "vegetarian", "gluten-free"],
      season: [],
      tags: ["one-pot", "weeknight"],
      perishable_ingredients: ["spinach"],
      requires_equipment: [],
      side_search_terms: ["warm naan or flatbread", "a cooling cucumber raita"],
      meal_preppable: true,
    },
  },
];

export interface ClassifyInput {
  /** The recipe title. */
  title: string;
  /** The recipe content the model classifies from (ingredients + instructions, or an email body). */
  content: string;
}

/** Chat-message shape (loose — matches what env.AI.run accepts). */
type Msg = { role: "system" | "user" | "assistant"; content: string };

/** Authored facets the classifier should treat as authoritative (override-aware conditioning,
 *  recipe-facet-derivation D6). Currently `course`, so a Tier-B `course` override drives the
 *  dependent `side_search_terms` (non-empty iff the effective course includes `main`). */
export interface ClassifyConditioning {
  course?: string[];
}

function baseMessages(input: ClassifyInput, conditioning?: ClassifyConditioning): Msg[] {
  const msgs: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const ex of FEW_SHOT) {
    msgs.push({ role: "user", content: `Title: ${ex.title}\n${ex.body}` });
    msgs.push({ role: "assistant", content: JSON.stringify(ex.output) });
  }
  const hint =
    conditioning?.course && conditioning.course.length
      ? `\n\nThe recipe's author has specified course = ${JSON.stringify(
          conditioning.course,
        )}. Treat that as authoritative: set "course" to exactly that, and make "side_search_terms" consistent with it (non-empty iff it includes "main").`
      : "";
  msgs.push({ role: "user", content: `Title: ${input.title}\n${input.content}${hint}` });
  return msgs;
}

/** Workers AI auto-parses a JSON response into an object; a prose response stays a string. */
function parseFacets(response: unknown): Record<string, unknown> | null {
  if (response && typeof response === "object") return response as Record<string, unknown>;
  if (typeof response !== "string") return null;
  const t = response.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function runModel(env: Env, messages: Msg[], trigger: AiTrigger): Promise<Record<string, unknown> | null> {
  let res: { response?: unknown };
  try {
    res = await runAi<{ response?: unknown }>(
      env,
      { activity: "classify", trigger, calls: 1 },
      CLASSIFY_MODEL,
      { messages, max_tokens: 700, temperature: 0.1 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("storage_error", `Workers AI classification failed: ${message}`, {
      model: CLASSIFY_MODEL,
    });
  }
  return parseFacets(res?.response);
}

/** Lowercased alphanumeric word tokens (case- and punctuation-insensitive comparison basis). */
function titleWords(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * The deterministic word-subset guard on the model's cleaned title: accept it only when it is a
 * non-empty string whose word MULTISET is a subset of the raw title's (compared lowercased on
 * alphanumeric word boundaries — re-casing is free, removal is allowed, insertion of ANY word
 * not in the raw title is rejected). On rejection (or a missing/empty/non-string value) the raw
 * title is returned unchanged — cleaning FAILS OPEN and can never invent a dish identity or
 * park an import. Shared by the discovery import leg (via `toFrontmatter`) and the title
 * re-audit pass, so both are safe-by-construction against model drift.
 */
export function cleanedTitleOrFallback(raw: string, cleaned: unknown): string {
  if (typeof cleaned !== "string") return raw;
  const trimmed = cleaned.trim();
  if (!trimmed) return raw;
  const available = new Map<string, number>();
  for (const w of titleWords(raw)) available.set(w, (available.get(w) ?? 0) + 1);
  for (const w of titleWords(trimmed)) {
    const n = available.get(w) ?? 0;
    if (n === 0) return raw; // a word not in the raw title (or used more times) → reject
    available.set(w, n - 1);
  }
  return trimmed;
}

/** A candidate frontmatter for contract validation: model facets + pipeline-set fields. The
 *  model's cleaned `title` is taken only through the word-subset guard (falling back to the raw
 *  pipeline title), so the sweep and the corrective-retry loop both see the guarded value; the
 *  contract validator carries NO title-quality clause (fail-open by design). */
function toFrontmatter(facets: Record<string, unknown>, title: string, source: string | null): Record<string, unknown> {
  const fm: Record<string, unknown> = { title: cleanedTitleOrFallback(title, facets.title), source, pairs_with: [] };
  for (const k of CLASSIFIED_FIELDS) {
    if (k === "title") continue; // guarded above, never the model's raw value
    fm[k] = facets[k];
  }
  return fm;
}

export interface ClassifyResult {
  /** The full, contract-valid frontmatter (model facets + title + source + pairs_with). */
  frontmatter: Record<string, unknown>;
  /** Corrective retries it took (0 = valid first try) — for the sweep's log/health summary. */
  retries: number;
}

/**
 * Classify a recipe into contract-valid frontmatter, retrying with a corrective reprompt on
 * a contract violation (the loud, gateable failures: off-vocab protein/cuisine/season/
 * equipment, missing required field, empty side_search_terms on a main). Returns the valid
 * frontmatter, or throws a structured `validation_failed` ToolError when the model can't
 * produce a compliant classification within the retry budget — the sweep catches that and
 * parks the candidate (no human is present to fix it). `source` is the candidate URL (or
 * null); the sweep assembles the body and runs the full file validation downstream.
 */
export async function classifyRecipe(
  env: Env,
  input: ClassifyInput,
  source: string | null,
  maxRetries: number = CLASSIFY_MAX_RETRIES,
  conditioning?: ClassifyConditioning,
  trigger: AiTrigger = "cron",
): Promise<ClassifyResult> {
  const messages = baseMessages(input, conditioning);
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const facets = await runModel(env, messages, trigger);
    if (facets) {
      const fm = toFrontmatter(facets, input.title, source);
      const errors = validateRecipeContract(fm);
      if (errors.length === 0) return { frontmatter: fm, retries: attempt };
      lastErrors = errors;
      // Corrective reprompt: echo the model's own output + the validator's complaints.
      messages.push({ role: "assistant", content: JSON.stringify(facets) });
      messages.push({
        role: "user",
        content: `That output failed validation:\n- ${errors.join("\n- ")}\nReturn the corrected JSON object only, fixing exactly those problems and keeping every required key.`,
      });
    } else {
      lastErrors = ["model did not return a JSON object"];
      messages.push({
        role: "user",
        content: "Return ONLY a single JSON object with the required keys, no prose.",
      });
    }
  }

  throw new ToolError(
    "validation_failed",
    `Classification did not pass the recipe contract after ${maxRetries + 1} attempts: ${lastErrors.join("; ")}`,
    { errors: lastErrors },
  );
}
