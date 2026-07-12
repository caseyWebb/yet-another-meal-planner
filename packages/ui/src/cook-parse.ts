// The shared, pure cook-mode body parser (recipe-card-cook-mode, D32). Cook mode PREFERS the
// skill-supplied `RecipeCardData.cook` (`CookData`); when it is absent, both hosts derive the
// SAME shape from the recipe's markdown `body` client-side — the no-skill annotation path that
// makes every card cook-capable (D32/Q2). Kept deliberately absent-safe: a plain, un-annotated
// body (no `## Ingredients` / `## Instructions`, no tokens, no timers) yields an empty step list,
// and the host simply offers no cook entry — never an error.
//
// Body annotation grammar (mirrors the design mockup's `parseBody`):
//   • `## Ingredients` / `## Instructions` section headers switch the parser's mode.
//   • Ingredient lines are `- item` / `* item`; a `### Group` or `**Group:**` line inside the
//     ingredients section tags the following lines with that group.
//   • Steps are `1. …` / `1) …`. A leading `**Title:**` becomes the step `title`; the rest is the
//     step `content` (its `{id}` / `{id|surface}` ingredient tokens and `*emphasis*` preserved for
//     the renderer). `@Ns` sets `timer_seconds` explicitly; otherwise a "N minutes" phrase in the
//     prose is detected as the timer.

// Structural mirror of `@yamp/contract`'s `CookData`, kept local so `@yamp/ui` carries no
// contract dependency (the propose-controller precedent). A host's concrete `RecipeCardData.cook`
// assigns to it structurally.
export interface CookData {
  base_servings?: number | null;
  ingredients: { id: string; text: string; group?: string }[];
  steps: { title?: string; content: string; timer_seconds?: number | null }[];
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escape a string (escape-first defence — cook content is authored corpus text). */
export function escapeCookHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Inline markdown (bold / italic) over an ALREADY-escaped string, matching the member app's
 *  `md.ts` inline pass so a step's emphasis renders like the recipe body. */
function inlineMarkdown(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

/** An ingredient-reference token: `{id}` or `{id|surface text}`. `id` keys a `CookData`
 *  ingredient; `surface` is the visible label (defaults to the id with underscores spaced). */
const TOKEN_RE = /\{([a-z0-9_]+)(?:\|([^}]+))?\}/gi;

/** An explicit per-step timer hint: `@780s` (seconds, literal — NOT minutes). */
const TIMER_HINT_RE = /\s*@(\d+)s\b/;

/**
 * Detect a wait duration in step prose ("simmer 12 minutes", "4–5 mins") as SECONDS, or null when
 * the step names no duration. A range takes the low end. Minutes only — the annotation grammar's
 * `@Ns` hint carries anything finer.
 */
export function detectDuration(text: string): number | null {
  const m = /(\d+)(?:\s*[–-]\s*(\d+))?\s*(?:minutes?|mins?)\b/i.exec(String(text));
  if (!m) return null;
  return parseInt(m[1], 10) * 60;
}

/** Strip every `{id}` / `{id|surface}` token (to its surface label) and any `@Ns` timer hint from
 *  a step's prose, leaving plain text — the copy/read fallback rendering. */
export function stripCookTokens(text: string): string {
  return String(text)
    .replace(TIMER_HINT_RE, "")
    .replace(TOKEN_RE, (_m, key: string, surface?: string) =>
      surface != null ? surface : key.replace(/_/g, " "),
    );
}

/**
 * Render a step's `content` to safe HTML: escape-first, inline markdown, then resolve every
 * `{id}` / `{id|surface}` token against `keyMap` (id → the ingredient's full text). A matched
 * token becomes a dotted `ingredient-ref` span carrying the amount as a hover tooltip; an
 * unmatched token degrades to its plain surface label. Absent-safe: an empty `keyMap` renders all
 * tokens as plain text.
 */
export function interpolateIngredientRefs(content: string, keyMap: Record<string, string>): string {
  const rendered = inlineMarkdown(escapeCookHtml(String(content ?? "")));
  return rendered.replace(TOKEN_RE, (_m, key: string, surface?: string) => {
    // `surface` here already rode through `escapeCookHtml`, so it is safe to emit as-is; only the
    // tooltip (a raw `keyMap` value) needs escaping. The default label is a slug — no unsafe chars.
    const label = surface != null ? surface : escapeCookHtml(key.replace(/_/g, " "));
    const tip = keyMap[key];
    if (!tip) return label;
    return `<span class="ingredient-ref" data-qty="${escapeCookHtml(tip)}">${label}</span>`;
  });
}

/** Build a step interpolation map (ingredient id → its full text) from a parsed cook block. */
export function cookKeyMap(cook: CookData): Record<string, string> {
  const map: Record<string, string> = {};
  for (const ing of cook.ingredients) map[ing.id] = ing.text;
  return map;
}

/** Slugify an ingredient line into a stable, reasonably semantic token id: drop a leading quantity
 *  / unit prefix, take the phrase up to the first comma, and underscore-join the words. Used only
 *  on the body-parse path (the skill path supplies its own ids); collisions are suffixed. */
function ingredientId(text: string, taken: Set<string>): string {
  const core = text
    .replace(/^[\s\d./–-]+/, "") // leading amount (numbers, fractions, ranges)
    .replace(/^(?:oz|lb|lbs|g|kg|ml|l|tsp|tbsp|cup|cups|clove|cloves|can|cans|pinch|slice|slices)\b\.?\s*/i, "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const base = core.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "ingredient";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

/** Match an ingredients-section subgroup header (`### Group` or `**Group:**` / `**Group**`). */
function subgroupHeader(line: string): string | null {
  const hashed = /^#{3,4}\s+(.+?)\s*$/.exec(line);
  if (hashed) return hashed[1].replace(/:$/, "").trim();
  const bold = /^\*\*(.+?):?\*\*\s*$/.exec(line);
  if (bold) return bold[1].trim();
  return null;
}

/**
 * Parse a recipe markdown `body` into `CookData` (D32). Absent-safe: a body with no
 * `## Instructions` list yields `steps: []`, and callers gate the cook entry on a non-empty step
 * list. The step `content` retains its `{id}` tokens and `*emphasis*` for `interpolateIngredientRefs`.
 */
export function parseCookBody(body: string | null | undefined): CookData {
  const ingredients: CookData["ingredients"] = [];
  const steps: CookData["steps"] = [];
  const taken = new Set<string>();
  let section: "ingredients" | "instructions" | null = null;
  let group: string | undefined;

  for (const raw of String(body ?? "").split("\n")) {
    const line = raw.trim();
    if (/^##\s+ingredients\b/i.test(line)) {
      section = "ingredients";
      group = undefined;
      continue;
    }
    if (/^##\s+instructions\b/i.test(line)) {
      section = "instructions";
      continue;
    }
    if (!line) continue;

    if (section === "ingredients") {
      if (/^[-*]\s+/.test(line)) {
        const text = line.replace(/^[-*]\s+/, "").trim();
        ingredients.push({ id: ingredientId(text, taken), text, ...(group ? { group } : {}) });
        continue;
      }
      const header = subgroupHeader(line);
      if (header) group = header;
      continue;
    }

    if (section === "instructions" && /^\d+[.)]\s+/.test(line)) {
      let text = line.replace(/^\d+[.)]\s+/, "").trim();
      let timerSeconds: number | null;
      const hint = TIMER_HINT_RE.exec(text);
      if (hint) {
        timerSeconds = parseInt(hint[1], 10);
        text = text.replace(TIMER_HINT_RE, "").trim();
      } else {
        timerSeconds = detectDuration(text);
      }
      let title: string | undefined;
      const tm = /^\*\*([^*]+?):\*\*\s*/.exec(text);
      if (tm) {
        title = tm[1].trim();
        text = text.slice(tm[0].length).trim();
      }
      steps.push({ ...(title ? { title } : {}), content: text, timer_seconds: timerSeconds });
    }
  }

  return { ingredients, steps };
}
