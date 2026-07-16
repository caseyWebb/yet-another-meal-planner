// The runtime-agnostic recipe-parse spine (shared by the Worker and the satellite).
//
// This is layer 2 of the recipe parse — PURE functions over already-parsed JSON-LD
// blocks (instruction shapes, durations, yield). It runs identically on workerd and
// in Node, so BOTH the Worker (`packages/worker`, via HTMLRewriter for layer 1) and
// the home-network satellite (`packages/satellite`, via its own Node HTML extraction for
// layer 1) feed their extracted blocks into `findRecipe` + `normalizeRecipe` here.
// Layer 1 (HTML → JSON-LD blocks) is runtime-specific and stays with each caller.

import { cleanText } from "./text.js";

export interface NormalizedRecipe {
  title: string;
  ingredients: string[];
  instructions: string[];
  servings: number | string | null;
  time_total: number | null; // minutes
  time_active: number | null; // minutes (prep)
  source: string | null;
  /**
   * The schema.org `tool` list, flattened to names. A NON-AUTHORITATIVE HINT for
   * the classifier deciding `requires_equipment` — it enumerates every utensil
   * (bowls, whisks) which are mostly not vital. Never written to a recipe directly.
   * Omitted when the page carries no `tool`.
   */
  tools_hint?: string[];
}

export type NormalizeResult =
  | { ok: true; recipe: NormalizedRecipe }
  | { ok: false; missing: string[] };

/** True when `@type` (string or array) names `target`, bare or as schema.org/<target>. */
function typeIncludes(type: unknown, target: string): boolean {
  const matches = (t: unknown): boolean =>
    typeof t === "string" && (t === target || t.endsWith(`/${target}`));
  return Array.isArray(type) ? type.some(matches) : matches(type);
}

/** Depth-first search for the first node whose @type includes "Recipe" (descends @graph + arrays). */
export function findRecipe(blocks: unknown[]): Record<string, unknown> | null {
  const search = (node: unknown): Record<string, unknown> | null => {
    if (Array.isArray(node)) {
      for (const n of node) {
        const found = search(n);
        if (found) return found;
      }
      return null;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeIncludes(obj["@type"], "Recipe")) return obj;
      if (Array.isArray(obj["@graph"])) return search(obj["@graph"]);
    }
    return null;
  };
  for (const block of blocks) {
    const found = search(block);
    if (found) return found;
  }
  return null;
}

function asStringArray(v: unknown): string[] {
  const out: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === "string") {
      const t = cleanText(x);
      if (t) out.push(t);
    }
  };
  if (Array.isArray(v)) v.forEach(push);
  else push(v);
  return out;
}

/**
 * Flatten schema.org `tool` to names. Handles a plain string, an array of strings,
 * and `HowToTool` objects (`{ "@type": "HowToTool", "name": "blender" }`).
 */
function flattenTools(v: unknown): string[] {
  const out: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === "string") {
      const t = cleanText(x);
      if (t) out.push(t);
    } else if (x && typeof x === "object" && typeof (x as Record<string, unknown>).name === "string") {
      const t = cleanText((x as Record<string, unknown>).name as string);
      if (t) out.push(t);
    }
  };
  if (Array.isArray(v)) v.forEach(push);
  else push(v);
  return out;
}

/**
 * Flatten recipeInstructions to step strings. Handles plain strings, HowToStep
 * objects, HowToSection (recurse into itemListElement), and mixed arrays.
 * Typed non-steps (e.g. HowToTip in a "Notes" section) are skipped — they aren't
 * cooking steps; untyped objects carrying `text` are treated as steps.
 */
export function flattenInstructions(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === "string") {
      const t = cleanText(v);
      if (t) out.push(t);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeIncludes(o["@type"], "HowToSection") || Array.isArray(o.itemListElement)) {
        walk(o.itemListElement);
        return;
      }
      const isStep = typeIncludes(o["@type"], "HowToStep");
      const untypedWithText = o["@type"] === undefined && typeof o.text === "string";
      if (isStep || untypedWithText) {
        const t = cleanText(typeof o.text === "string" ? o.text : String(o.name ?? ""));
        if (t) out.push(t);
      }
      // typed non-step (HowToTip, etc.): skip
    }
  };
  walk(value);
  return out;
}

function num(x: string | undefined): number {
  return x ? parseFloat(x) : 0;
}

/** Parse a duration to whole minutes: ISO 8601 (incl. `PT…S` seconds) or plain text ("45 minutes"). */
export function parseDurationMinutes(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  if (/^P/i.test(s)) {
    const m = /^P(?:([\d.]+)W)?(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/i.exec(s);
    if (!m) return null;
    const [, w, d, h, min, sec] = m;
    const total = num(w) * 7 * 1440 + num(d) * 1440 + num(h) * 60 + num(min) + num(sec) / 60;
    return total > 0 ? Math.round(total) : null;
  }

  let mins = 0;
  let matched = false;
  for (const hm of s.matchAll(/([\d.]+)\s*(?:hours?|hrs?)\b/gi)) {
    mins += parseFloat(hm[1]) * 60;
    matched = true;
  }
  for (const mm of s.matchAll(/([\d.]+)\s*(?:minutes?|mins?)\b/gi)) {
    mins += parseFloat(mm[1]);
    matched = true;
  }
  return matched && mins > 0 ? Math.round(mins) : null;
}

/** Normalize recipeYield (string|number|array) to a sensible scalar, preferring an integer count. */
export function normalizeYield(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = /\d+/.exec(v);
    if (m) return parseInt(m[0], 10);
    const t = v.trim();
    return t || null;
  }
  if (Array.isArray(v)) {
    for (const e of v) {
      const r = normalizeYield(e);
      if (typeof r === "number") return r;
    }
    for (const e of v) {
      const r = normalizeYield(e);
      if (r != null) return r;
    }
  }
  return null;
}

function titleOf(recipe: Record<string, unknown>): string {
  const n = recipe.name ?? recipe.headline;
  if (typeof n === "string") return n.trim();
  if (Array.isArray(n) && typeof n[0] === "string") return n[0].trim();
  return "";
}

/**
 * Normalize a schema.org Recipe to the parser's return shape. Returns
 * `{ ok: false, missing }` when it yields no ingredients or no instructions —
 * the signal `import_recipe`'s URL path maps to the structured `incomplete` error.
 */
export function normalizeRecipe(recipe: Record<string, unknown>): NormalizeResult {
  const ingredients = asStringArray(recipe.recipeIngredient);
  const instructions = flattenInstructions(recipe.recipeInstructions);

  const missing: string[] = [];
  if (ingredients.length === 0) missing.push("ingredients");
  if (instructions.length === 0) missing.push("instructions");
  if (missing.length) return { ok: false, missing };

  const totalFromParts = (() => {
    const p = parseDurationMinutes(recipe.prepTime);
    const c = parseDurationMinutes(recipe.cookTime);
    if (p === null && c === null) return null;
    return (p ?? 0) + (c ?? 0);
  })();

  const toolsHint = flattenTools(recipe.tool);

  return {
    ok: true,
    recipe: {
      title: titleOf(recipe),
      ingredients,
      instructions,
      servings: normalizeYield(recipe.recipeYield),
      time_total: parseDurationMinutes(recipe.totalTime) ?? totalFromParts,
      time_active: parseDurationMinutes(recipe.prepTime),
      source: typeof recipe.url === "string" ? recipe.url : null,
      ...(toolsHint.length ? { tools_hint: toolsHint } : {}),
    },
  };
}
