// Spike: the discovery-sweep recipe CLASSIFIER prompt (task 0.1).
//
// The background sweep must turn raw recipe content (a fetched page's JSON-LD, or an
// email body) into the controlled-vocab facets `create_recipe` requires — unattended, on
// a small Workers AI model, with no human to fix a bad call. This module is the candidate
// production prompt; run.mjs scores its output against gold + the REAL contract validator.
//
// The `description` is deliberately NOT classified here: it is already a solved, shipped
// derived field (generateDescription, ai-derived-recipe-metadata). The sweep generates it
// from these facets with the existing tuned prompt. So the spike's load-bearing question
// is narrower and honest: can a small model produce valid, accurate FACETS?
//
// Vocab is injected from src/vocab.js (single source of truth) so the prompt can never
// drift from the gate.

import { PROTEIN_VOCAB, CUISINE_VOCAB, SEASON_VOCAB, EQUIPMENT_VOCAB } from "../../src/vocab.js";

// Fields the MODEL produces. title/source/pairs_with are pipeline-set (title from the
// page, source = the candidate URL, pairs_with = [] at import), so they are merged in by
// the harness, not guessed by the model.
export const MODEL_FIELDS = [
  "protein",
  "cuisine",
  "course",
  "time_total",
  "ingredients_key",
  "dietary",
  "season",
  "tags",
  "perishable_ingredients",
  "requires_equipment",
  "side_search_terms",
];

export const SYSTEM_PROMPT = [
  "You classify a recipe into a fixed set of metadata facets for a home-cooking app's recipe index. You are given the title, ingredients, and instructions; you output ONLY a JSON object with these keys and nothing else (no prose, no markdown fence):",
  "",
  "- protein: the COARSE protein bucket, or null. Map specifics to the bucket: shrimp/crab/clam/scallop -> shellfish; salmon/cod/tuna/any finfish -> fish; bacon/ham/sausage -> pork. One of: " +
    PROTEIN_VOCAB.join(" | ") +
    ". Use \"mixed\" only when two or more distinct animal/meat-substitute proteins are co-equal (e.g. shrimp AND egg AND tofu). For a plant protein-FORWARD dish (beans, lentils, tofu): if it has NO animal products at all (no meat, dairy, egg, honey) use \"vegan\"; if it has dairy or egg use \"vegetarian\". Use null when the dish has NO protein focus — a vegetable side, a plain grain/noodle dish, a sauce, a drink, OR a dessert (a custard dessert is null even though it has eggs/cream; they are not the focus). NEVER output \"none\" or any value off this list.",
  "- cuisine: the single best bucket, or null. One of: " +
    CUISINE_VOCAB.join(" | ") +
    ". If a dish's tradition is not on this list, pick the CLOSEST bucket (e.g. a Middle-Eastern/Levantine dish -> mediterranean; a Tex-Mex dish -> southwestern or mexican). Use null only when the dish is genuinely cuisine-agnostic (a smoothie, plain roasted vegetables, buttered toast). NEVER invent a cuisine not on this list.",
  "- course: a NON-EMPTY array describing the dish type. Open vocabulary — use the natural word: main | side | dessert | breakfast | snack | sauce | drink | baked_good, etc. Use multiple ONLY when it genuinely plates both ways (a hearty grain salad -> [main, side]). Most dishes are a single course.",
  "- time_total: total minutes as a number, or null if not stated and not obviously inferable.",
  "- ingredients_key: an array of the 5-7 DEFINING ingredients (plain names, no quantities), the ones that make the dish what it is — skip salt, pepper, water, oil unless central.",
  "- dietary: an array of dietary labels the dish ALREADY satisfies as written — e.g. vegetarian, vegan, gluten-free, dairy-free. [] if none apply. (Vegan implies vegetarian — include both when vegan.)",
  "- season: an array drawn ONLY from " +
    SEASON_VOCAB.join(" | ") +
    ". DEFAULT TO [] — most dishes are year-round and MUST be []. Tag a season ONLY when the dish is dominantly tied to it by its defining ingredient or temperature: a cold dish built on peak produce (gazpacho, tomato salad -> [summer]), or a long cold-weather braise/roast eaten for warmth. A dish you'd happily eat any month — including most curries, stir-fries, pastas, tacos, soups, roasts, and braises — is []. \"Hearty\" or \"warm\" alone is NOT enough; when uncertain, output []. \"year-round\" is NOT a valid value — express it as []. Lowercase only; use \"fall\", never \"autumn\".",
  "- tags: a few free-form lowercase tags (e.g. quick, one-pot, weeknight, spicy). [] if none obvious.",
  "- perishable_ingredients: the ingredients that would SPOIL before a typical cook uses them up — the \"would the leftover rot\" test. Include fast-spoilers even in small amounts (fresh herbs, leafy greens, fresh berries, soft cheese, fresh seafood/meat bought for one dish). EXCLUDE shelf-stable staples (oil, canned/dried/jarred goods, spices, vinegar, soy sauce). Skip fuzzy hardy items (potatoes, onions, hard squash). [] if nothing qualifies.",
  "- requires_equipment: an array drawn ONLY from " +
    EQUIPMENT_VOCAB.join(" | ") +
    ". Tag a slug ONLY when the dish is genuinely IMPOSSIBLE without it — no recipe-preserving workaround. A purée/smoothie that must be smooth -> blender; a churned ice cream -> ice-cream-maker. Default to [] — a stand mixer, food processor (when a blender substitutes), oven, pan, or pressure-cooker-with-a-stovetop-version do NOT count. When unsure, output []. Over-tagging silently HIDES a recipe a cook could make.",
  "- side_search_terms: for a course that includes \"main\", a NON-EMPTY array of 2-3 short phrases describing the KIND of side that completes the plate (e.g. [\"a bright acidic salad\", \"crusty bread for the sauce\"]). For anything that is not a main, output [].",
  "",
  "Rules: output STRICT JSON with exactly those keys. Stay strictly inside the controlled vocabularies for protein, cuisine, season, and requires_equipment — an off-list value is a hard error. Do not invent ingredients or attributes the recipe does not contain; if the input is sparse, prefer null/[] over guessing.",
].join("\n");

// Few-shot exemplars — DIFFERENT dishes from the eval set (no leakage). Each anchors a
// silent-failure call: shrimp->shellfish + non-empty side_search_terms; protein/cuisine
// null + a real season + empty side_search_terms on a side; open-vocab course + blender +
// protein null on a sauce.
export const FEW_SHOT = [
  {
    title: "Linguine alle Vongole",
    body: "Ingredients: linguine, fresh littleneck clams, garlic, white wine, red pepper flakes, parsley, olive oil.\nInstructions: Steam the clams open in garlic, wine, and pepper flakes; toss with al dente linguine and parsley.",
    output: {
      protein: "shellfish",
      cuisine: "italian",
      course: ["main"],
      time_total: 30,
      ingredients_key: ["clams", "linguine", "garlic", "white wine", "parsley"],
      dietary: ["dairy-free"],
      season: [],
      tags: ["quick", "seafood"],
      perishable_ingredients: ["clams", "parsley"],
      requires_equipment: [],
      side_search_terms: ["a crisp green salad", "crusty bread for the broth"],
    },
  },
  {
    title: "Grilled Asparagus with Lemon",
    body: "Ingredients: asparagus, olive oil, lemon, flaky salt.\nInstructions: Toss asparagus in oil, grill until charred and tender, finish with lemon and salt.",
    output: {
      protein: null,
      cuisine: null,
      course: ["side"],
      time_total: 15,
      ingredients_key: ["asparagus", "lemon", "olive oil"],
      dietary: ["vegan", "vegetarian", "gluten-free"],
      season: ["spring"],
      tags: ["quick", "grilled"],
      perishable_ingredients: ["asparagus"],
      requires_equipment: [],
      side_search_terms: [],
    },
  },
  {
    title: "Basil Pesto",
    body: "Ingredients: fresh basil, garlic, pine nuts, parmesan, olive oil.\nInstructions: Blend basil, garlic, pine nuts, and parmesan, streaming in oil until smooth.",
    output: {
      protein: null,
      cuisine: "italian",
      course: ["sauce"],
      time_total: 10,
      ingredients_key: ["basil", "garlic", "pine nuts", "parmesan", "olive oil"],
      dietary: ["vegetarian", "gluten-free"],
      season: ["summer"],
      tags: ["no-cook"],
      perishable_ingredients: ["basil", "parmesan"],
      requires_equipment: ["blender"],
      side_search_terms: [],
    },
  },
  {
    // Anchors: plant-only -> vegan (not vegetarian); a hearty curry is still year-round [].
    title: "Chickpea Coconut Curry",
    body: "Ingredients: chickpeas, coconut milk, onion, garlic, ginger, curry powder, tomatoes, spinach.\nInstructions: Simmer aromatics and spices, add chickpeas, coconut milk, and tomatoes, wilt in spinach.",
    output: {
      protein: "vegan",
      cuisine: "indian",
      course: ["main"],
      time_total: 35,
      ingredients_key: ["chickpeas", "coconut milk", "spinach", "curry powder", "tomatoes"],
      dietary: ["vegan", "vegetarian", "gluten-free"],
      season: [],
      tags: ["one-pot", "weeknight"],
      perishable_ingredients: ["spinach"],
      requires_equipment: [],
      side_search_terms: ["warm naan or flatbread", "a cooling cucumber raita"],
    },
  },
];

export function buildUserMessage(recipe) {
  return `Title: ${recipe.title}\n${recipe.body}`;
}

/** The full chat message array for one recipe (system + few-shot + the recipe). */
export function buildMessages(recipe) {
  const msgs = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const ex of FEW_SHOT) {
    msgs.push({ role: "user", content: buildUserMessage(ex) });
    msgs.push({ role: "assistant", content: JSON.stringify(ex.output) });
  }
  msgs.push({ role: "user", content: buildUserMessage(recipe) });
  return msgs;
}
