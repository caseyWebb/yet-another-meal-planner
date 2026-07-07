// Embedding + similarity helpers for semantic recipe search.
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

// --- the request-time query-embedding cache (member-app-propose D5) --------------------
//
// Request-time query texts (the propose freeform/override phrases, `search_recipes`
// ranked-mode vibes) repeat: a member reroll re-sends the same phrase, an agent
// re-searches a saved vibe. Each embed is a Workers AI subrequest, so they're served
// through a content-addressed KV cache. The scheduled reconciles (recipe-embeddings.ts,
// night-vibe-vector.ts) deliberately do NOT route through this — they already hash-gate
// their embeds in D1 and never re-embed unchanged text.

/** Cache entry lifetime. Fixed at put (no rolling re-put — an expiry costs one cheap re-embed). */
export const EMBED_CACHE_TTL_S = 30 * 24 * 60 * 60;

/** Normalize query text for cache addressing: lowercase, trim, inner whitespace collapsed —
 *  so "Cozy Soup" and "cozy  soup" share one entry (and one vector, first-writer's). */
export function normalizeEmbedText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * The cache key for one query text: `embed:<sha256-hex(model + "\n" + normalized)>`.
 * Folding the model id into the hashed material welds the cache to `EMBED_MODEL` — a
 * model change (which re-embeds the whole index anyway) orphans old entries to TTL
 * expiry with no version constant to bump. SHA-256 via `crypto.subtle` (the ETag-helper
 * precedent), NOT `hashText`: the 8-hex FNV-1a is a change-detection key, and a 32-bit
 * collision here would silently serve the wrong *vector*, which does not self-heal.
 */
export async function embedCacheKey(text: string, model: string = EMBED_MODEL): Promise<string> {
  const material = `${model}\n${normalizeEmbedText(text)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `embed:${hex}`;
}

/** A cached value must be exactly what `embedTexts` returned: an `EMBED_DIM` float array.
 *  Anything else (bad JSON, wrong length, non-numbers) is treated as a miss. */
function parseCachedVector(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.length === EMBED_DIM && v.every((n) => typeof n === "number")) {
      return v as number[];
    }
  } catch {
    // malformed entry → miss (re-embed overwrites it)
  }
  return null;
}

/**
 * Embed query texts through the content-addressed KV cache (`KROGER_KV`, the
 * ephemeral-infra namespace): KV-get each key, batch **all misses into one
 * `embedTexts` call** (deduped by key, original text embedded — a cold cache is
 * byte-identical to plain `embedTexts`), then best-effort put-back with the fixed TTL.
 * Returns vectors in input order. The cache FAILS OPEN: a KV read/write failure or a
 * malformed cached value degrades to the plain embed and never fails the request (the
 * ingest limiter's posture). Cross-tenant by design — a vector is a pure function of a
 * public model and the text, the flyer-cache precedent.
 */
export async function embedTextsCached(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const keys = await Promise.all(texts.map((t) => embedCacheKey(t)));

  // Read each key (failures → miss); identical keys within the batch share one lookup.
  const cachedByKey = new Map<string, number[] | null>();
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      let vec: number[] | null = null;
      try {
        vec = parseCachedVector(await env.KROGER_KV.get(key));
      } catch {
        // KV read failure → treat as a miss (fail open)
      }
      cachedByKey.set(key, vec);
    }),
  );

  // Batch the misses — deduped by key, first occurrence's ORIGINAL text — into ONE call.
  const missKeys: string[] = [];
  const missTexts: string[] = [];
  const seen = new Set<string>();
  texts.forEach((text, i) => {
    const key = keys[i];
    if (cachedByKey.get(key) || seen.has(key)) return;
    seen.add(key);
    missKeys.push(key);
    missTexts.push(text);
  });
  const embedded = await embedTexts(env, missTexts);
  const freshByKey = new Map<string, number[]>();
  missKeys.forEach((key, j) => freshByKey.set(key, embedded[j]));

  // Best-effort put-back (a write failure never fails the request).
  await Promise.all(
    missKeys.map(async (key) => {
      try {
        await env.KROGER_KV.put(key, JSON.stringify(freshByKey.get(key)), { expirationTtl: EMBED_CACHE_TTL_S });
      } catch {
        // fail open — the next request just re-embeds
      }
    }),
  );

  return texts.map((_, i) => cachedByKey.get(keys[i]) ?? freshByKey.get(keys[i])!);
}
