// Embedding + similarity helpers for semantic recipe search (semantic-meal-plan).
//
// Two concerns live here, deliberately split:
//   * `cosineSimilarity` is PURE arithmetic (no I/O) so the ranking math is
//     unit-testable without a Workers AI binding — the same discipline as
//     src/matching.ts / src/unit-price.ts.
//   * `embedText` embeds a QUERY string in the Worker so the caller ships text, not
//     vectors, keeping the match off the caller's token budget. RECIPE embeddings go
//     through the same `env.AI` binding but on the cron reconcile (src/recipe-
//     embeddings.ts), not here — the Node build has no binding, so recipe vectors are
//     reconciled Worker-side rather than projected by the build. See the semantic-
//     meal-plan design's embedding-placement decision (option B).

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";

/** The embedding model. Welded to the index's dimension — changing it re-embeds everything. */
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

/** Output dimension of EMBED_MODEL. The D1 embedding projection MUST match. */
export const EMBED_DIM = 768;

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1]. Pure. Returns 0 when
 * either vector is zero-magnitude (degenerate — no direction to compare) or the
 * lengths differ (caller passed mismatched dimensions; treated as "no signal"
 * rather than throwing, so one bad row can't abort a ranking pass).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Workers AI bge response: `{ shape, data: number[][] }` (one row per input text). */
interface EmbeddingResponse {
  data: number[][];
}

/**
 * Embed a single text via Workers AI, returning its `EMBED_DIM`-length vector. Maps
 * any AI failure (or an unexpectedly-shaped response) to a structured `storage_error`
 * ToolError — never a raw throw — matching the tool-boundary discipline (D4).
 */
export async function embedText(env: Env, text: string): Promise<number[]> {
  let res: EmbeddingResponse;
  try {
    res = (await env.AI.run(EMBED_MODEL, { text })) as unknown as EmbeddingResponse;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("storage_error", `Workers AI embed failed: ${message}`, { model: EMBED_MODEL });
  }
  const vector = res?.data?.[0];
  if (!Array.isArray(vector) || vector.length !== EMBED_DIM) {
    throw new ToolError("storage_error", "Workers AI returned an unexpected embedding shape", {
      model: EMBED_MODEL,
    });
  }
  return vector;
}

/**
 * Embed MANY texts in one Workers AI call — `{ text: string[] }` returns one row per
 * input, so a whole reconcile batch is a single subrequest (the recipe-embedding
 * reconcile's batching primitive; see src/recipe-embeddings.ts). Returns the vectors
 * in input order. An empty input is a no-op (`[]`, no call). Same structured-error
 * discipline as `embedText`: any AI failure or a response whose row count / dimension
 * doesn't match the request maps to a `storage_error` ToolError, never a raw throw.
 */
export async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  let res: EmbeddingResponse;
  try {
    res = (await env.AI.run(EMBED_MODEL, { text: texts })) as unknown as EmbeddingResponse;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("storage_error", `Workers AI embed failed: ${message}`, { model: EMBED_MODEL });
  }
  const vectors = res?.data;
  if (
    !Array.isArray(vectors) ||
    vectors.length !== texts.length ||
    vectors.some((v) => !Array.isArray(v) || v.length !== EMBED_DIM)
  ) {
    throw new ToolError("storage_error", "Workers AI returned an unexpected embedding shape", {
      model: EMBED_MODEL,
    });
  }
  return vectors;
}
