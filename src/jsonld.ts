// schema.org Recipe extraction + normalization (design D5).
//
// Two layers:
//   1. extractJsonLd(res) — pull <script type="application/ld+json"> blocks out of
//      the HTML with HTMLRewriter (the idiomatic Cloudflare tool; workerd-only, so
//      it's exercised by the live smoke test, not Node unit tests). Thin + mechanical.
//   2. findRecipe / normalizeRecipe — PURE functions over already-parsed JSON-LD.
//      All the real complexity (instruction shapes, durations, yield) lives here
//      and is fully unit-tested with fixtures.

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

// --- layer 1: HTML → parsed JSON-LD blocks (workerd, via HTMLRewriter) -------

function tryParseJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A few sites HTML-encode quotes inside the script; try a minimal decode.
    try {
      return JSON.parse(text.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&"));
    } catch {
      return undefined;
    }
  }
}

/**
 * Collect and parse every JSON-LD script block from an HTML Response. Script
 * content is raw text bounded by `</script>`, so HTMLRewriter's text chunks are
 * accumulated per element and parsed at its end tag. Unparseable blocks are skipped.
 */
export async function extractJsonLd(res: Response): Promise<unknown[]> {
  const blocks: unknown[] = [];
  let buf = "";
  const rewriter = new HTMLRewriter().on('script[type="application/ld+json"]', {
    element(el) {
      buf = "";
      el.onEndTag(() => {
        const parsed = tryParseJson(buf);
        if (parsed !== undefined) blocks.push(parsed);
        buf = "";
      });
    },
    text(chunk) {
      buf += chunk.text;
    },
  });
  // Consuming the transformed body drives the handlers to completion.
  await rewriter.transform(res).text();
  return blocks;
}

// --- layer 2: parsed JSON-LD → NormalizedRecipe (pure, unit-tested) ----------

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
 * the signal parse_recipe maps to the structured `incomplete` error.
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
