// POST /admin/api/ingest — the walled-source ingest endpoint (recipe-ingestion).
//
// Authenticated by a bearer INGEST KEY (NOT Cloudflare Access) as an explicit,
// allowlisted carve-out from the /admin* Access gate — a headless home scraper carries
// no Access JWT. Wired in src/index.ts BEFORE the /admin dispatch so it never reaches
// the admin app's access middleware, and scoped to exactly POST /admin/api/ingest.
//
// It validates the batch envelope + each item against the shared @grocery-agent/contract
// wire types, dedups on arrival (corpus / rejections / settled-log / in-flight inbox, with
// the walled-park supersede exception), persists accepted candidates to ingest_candidates,
// and returns the { received, accepted, deduped, rejected, results } summary. The classify/
// match/import pipeline runs later in the background sweep — never synchronously here.

import { parseIngestEnvelope, parseRecipeItem, type BatchResponse, type ItemResult } from "@grocery-agent/contract";
import type { Env } from "./env.js";
import { lookupIngestKey, touchIngestKey, insertIngestCandidate, ingestCandidateUrls } from "./ingest-db.js";
import { readDiscoveryRejections } from "./corpus-db.js";
import { loadSettledUrls } from "./discovery-db.js";
import { recipeSourceMap } from "./recipe-index.js";
import { extractRecipeSources, canonicalizeUrl } from "./discovery.js";

/** Per-key fixed-window rate limit (best-effort, KV-backed; fail-open on a KV error). */
const RL_MAX = 120;
const RL_WINDOW_S = 60;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** Best-effort per-key fixed-window limiter over KROGER_KV. Returns true when the request is allowed. */
async function underRateLimit(env: Env, keyId: string, now: number): Promise<boolean> {
  try {
    const bucket = Math.floor(now / 1000 / RL_WINDOW_S);
    const k = `ingest:rl:${keyId}:${bucket}`;
    const cur = Number.parseInt((await env.KROGER_KV.get(k)) ?? "0", 10) || 0;
    if (cur >= RL_MAX) return false;
    await env.KROGER_KV.put(k, String(cur + 1), { expirationTtl: RL_WINDOW_S * 2 });
    return true;
  } catch {
    return true; // never let the limiter's own failure reject a valid push
  }
}

/**
 * Handle one POST /admin/api/ingest. `now` is injectable for tests.
 */
export async function handleIngest(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // [1] key auth — bad/absent/revoked key → 401 (bad_key). Never persists anything.
  const secret = bearer(request);
  if (!secret) return json({ error: "bad_key", message: "missing bearer ingest key" }, 401);
  const key = await lookupIngestKey(env, secret);
  if (!key) return json({ error: "bad_key", message: "unknown or revoked ingest key" }, 401);

  // [2] rate limit (best-effort).
  if (!(await underRateLimit(env, key.id, now))) {
    return json({ error: "rate_limited", message: "too many pushes; slow down" }, 429);
  }

  // [3] parse body + validate the envelope META (source + versions + non-empty recipes[]).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_payload", message: "body is not valid JSON" }, 400);
  }
  const env0 = parseIngestEnvelope(body);
  if (!env0.ok) return json({ error: "bad_payload", message: env0.error }, 400);
  const batch = env0.value;

  // Record liveness (last_used + reported versions) now that the key + envelope are valid.
  await touchIngestKey(env, key.id, batch.scraper_version, batch.contract_version, now).catch(() => {});

  // [4] arrival dedup sets. Pushed candidates dedup against the SETTLED log only (not parks),
  // so a push supersedes a prior walled `unreachable`/`no_jsonld` park for the same url.
  const [sourceMap, rejections, settled, inflight] = await Promise.all([
    recipeSourceMap(env),
    readDiscoveryRejections(env),
    loadSettledUrls(env),
    ingestCandidateUrls(env),
  ]);
  const corpusUrls = extractRecipeSources(sourceMap);
  const receivedAt = new Date(now).toISOString();

  // [5] per-item: validate, canonicalize, dedup, persist. One bad item never sinks the batch.
  const results: ItemResult[] = [];
  let accepted = 0;
  let deduped = 0;
  let rejected = 0;
  const seenThisBatch = new Set<string>();

  for (const raw of batch.recipes) {
    const parsed = parseRecipeItem(raw);
    if (!parsed.ok) {
      const src = typeof (raw as { source?: unknown })?.source === "string" ? (raw as { source: string }).source : "";
      results.push({ disposition: "rejected", source: src, reason: parsed.error });
      rejected++;
      continue;
    }
    const item = parsed.value;
    const url = canonicalizeUrl(item.source);
    if (!url) {
      results.push({ disposition: "rejected", source: item.source, reason: "unresolvable source url" });
      rejected++;
      continue;
    }
    if (
      corpusUrls.has(url) ||
      rejections.has(url) ||
      settled.has(url) ||
      inflight.has(url) ||
      seenThisBatch.has(url)
    ) {
      results.push({ disposition: "deduped", source: url });
      deduped++;
      continue;
    }
    const written = await insertIngestCandidate(env, {
      url,
      title: item.title,
      content: {
        ingredients: item.ingredients,
        instructions: item.instructions,
        summary: item.summary ?? null,
        servings: item.servings ?? null,
        time_total: item.time_total ?? null,
        time_active: item.time_active ?? null,
      },
      origin: batch.source,
      keyId: key.id,
      receivedAt,
    });
    seenThisBatch.add(url);
    if (written) {
      results.push({ disposition: "accepted", source: url });
      accepted++;
    } else {
      // A concurrent insert won the UNIQUE(url) race — count as deduped, not accepted.
      results.push({ disposition: "deduped", source: url });
      deduped++;
    }
  }

  const response: BatchResponse = { received: batch.recipes.length, accepted, deduped, rejected, results };
  return json(response, 200);
}
