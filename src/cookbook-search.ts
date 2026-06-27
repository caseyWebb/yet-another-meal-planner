// Pure keyword ranking for the cookbook site's search. No I/O here (mirrors
// src/semantic-search.ts), so the scoring is unit-testable without any binding; the route
// (src/cookbook.ts) supplies the recipe index and renders the ordered result.
//
// The open cookbook ranks by KEYWORD relevance over the metadata the D1 index already
// carries — there is no query embedding, no cosine, and no per-query Workers AI call. Each
// query token contributes a field-weighted score (title ≫ tags/facets > course >
// ingredient/dietary/season > description), the per-token contributions sum, and the total
// scales by query COVERAGE (the fraction of distinct tokens a recipe matched) so an
// all-token match outranks a partial one. A whole-query title prefix earns a typeahead
// bonus. Results are score-descending, tie-broken on title then slug for determinism.
//
// The surface is anonymous (no caller identity), so ranking is keyword relevance alone —
// none of the per-tenant favorite / freshness / pantry boosts the agent-facing
// `search_recipes` tool applies (src/semantic-search.ts).

import { queryTokens } from "./recipes.js";
import type { RecipeIndex, IndexedRecipe } from "./recipes.js";

/** One rendered row — the fields a cookbook list item needs. */
export interface CookbookHit {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
}

/** A loose index entry / search hit → the compact shape the list renderer needs. Pure
 *  (no I/O), shared by the route's index render and the ranker. */
export function toHit(r: Record<string, unknown>): CookbookHit {
  const slug = String(r.slug);
  return {
    slug,
    title: typeof r.title === "string" && r.title.length > 0 ? r.title : slug,
    description: typeof r.description === "string" ? r.description : null,
    protein: typeof r.protein === "string" ? r.protein : null,
    cuisine: typeof r.cuisine === "string" ? r.cuisine : null,
  };
}

/**
 * Field weights and match-kind multipliers for the keyword scorer. These are TUNING
 * CONSTANTS, deliberately kept OUT of the spec'd contract — the spec fixes the ordering
 * semantics (title outranks description, coverage rewards full matches, ties break
 * deterministically), not these numbers. Each pair is `{ word, partial }`: a whole-word
 * hit scores `word`, a mere substring hit scores `partial` (which powers typeahead, e.g.
 * "chick" reaching "Chicken"). Tune against the live corpus.
 */
export const WEIGHTS = {
  title: { word: 10, partial: 5 },
  tag: { word: 6, partial: 3 },
  facet: { word: 6, partial: 3 }, // protein / cuisine (single-vocab scalars)
  course: { word: 4, partial: 2 },
  list: { word: 3, partial: 1.5 }, // ingredients_key / dietary / season
  description: { word: 1.5, partial: 1 },
  /** Added once when the whole normalized query is a prefix of the title (typeahead). */
  titlePrefixBonus: 8,
} as const;

type Weight = { word: number; partial: number };

/** Coerce a frontmatter value to a string array (array as-is; a scalar → singleton). */
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v != null && v !== "") return [String(v)];
  return [];
}

/** A non-empty string, or null. */
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Lowercase alphanumeric words of a field, for whole-word matching. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Score one token against one text field: whole-word hit, else substring, else 0. */
function scoreText(token: string, text: string | null, w: Weight): number {
  if (!text) return 0;
  if (words(text).includes(token)) return w.word;
  if (text.toLowerCase().includes(token)) return w.partial;
  return 0;
}

/** Best score of one token across an array of values (e.g. tags, course). */
function scoreList(token: string, values: string[], w: Weight): number {
  let best = 0;
  for (const v of values) {
    const s = scoreText(token, v, w);
    if (s > best) best = s;
  }
  return best;
}

/** Normalize the raw query for the title-prefix bonus: lowercase, trim, collapse whitespace
 *  (stopwords kept, so a literal typed prefix like "chicken and r" still matches a title). */
function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Tokenize the query through the shared `queryTokens` (which owns the stopword set), after
 * replacing punctuation with spaces so "chicken-tacos" / "tacos!" tokenize cleanly and an
 * embedded stopword ("stir-and-fry" → stir, fry) is still dropped.
 */
function tokenize(q: string): string[] {
  return queryTokens(q.replace(/[^a-z0-9\s]+/gi, " "));
}

/** Keyword score for one recipe against the (already tokenized) query. 0 = no match. */
function scoreRecipe(recipe: IndexedRecipe, tokens: string[], normQuery: string): number {
  const title = str(recipe.title) ?? recipe.slug;
  const tags = asStringArray(recipe.tags);
  const protein = str(recipe.protein);
  const cuisine = str(recipe.cuisine);
  const course = asStringArray(recipe.course);
  const ingredients = asStringArray(recipe.ingredients_key);
  const dietary = asStringArray(recipe.dietary);
  const season = asStringArray(recipe.season);
  const description = str(recipe.description);

  let total = 0;
  let matched = 0;
  for (const tok of tokens) {
    let s = 0;
    s += scoreText(tok, title, WEIGHTS.title);
    s += scoreList(tok, tags, WEIGHTS.tag);
    s += scoreText(tok, protein, WEIGHTS.facet);
    s += scoreText(tok, cuisine, WEIGHTS.facet);
    s += scoreList(tok, course, WEIGHTS.course);
    s += scoreList(tok, ingredients, WEIGHTS.list);
    s += scoreList(tok, dietary, WEIGHTS.list);
    s += scoreList(tok, season, WEIGHTS.list);
    s += scoreText(tok, description, WEIGHTS.description);
    if (s > 0) matched++;
    total += s;
  }
  if (matched === 0) return 0;
  // Coverage: an all-token match outranks a partial one.
  total *= matched / tokens.length;
  // Typeahead: the whole query is a prefix of the title ("chicken ta" → "Chicken Tacos").
  if (title.toLowerCase().startsWith(normQuery)) total += WEIGHTS.titlePrefixBonus;
  return total;
}

/**
 * Rank the recipe index against a free-text query by keyword relevance over the indexed
 * metadata. Pure: the caller (src/cookbook.ts) supplies the index. Returns the compact
 * render rows in descending score, tie-broken on title then slug. A query that tokenizes
 * to nothing (empty, or all stopwords) returns no results, as does a recipe matching no
 * token — so a nonsense query yields a clean empty result rather than the whole corpus.
 */
export function rankByKeyword(index: RecipeIndex, q: string): CookbookHit[] {
  const tokens = tokenize(q);
  if (tokens.length === 0) return [];
  const normQuery = normalizeQuery(q);

  const scored: { hit: CookbookHit; score: number }[] = [];
  for (const recipe of Object.values(index)) {
    const score = scoreRecipe(recipe, tokens, normQuery);
    if (score > 0) scored.push({ hit: toHit(recipe), score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.hit.title.localeCompare(b.hit.title) ||
      a.hit.slug.localeCompare(b.hit.slug),
  );
  return scored.map((s) => s.hit);
}
