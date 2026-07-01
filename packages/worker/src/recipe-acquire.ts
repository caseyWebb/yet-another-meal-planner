// The shared recipe-acquisition pipeline: fetch a page → extract JSON-LD → find the
// schema.org Recipe → normalize it, returning a DISCRIMINATED result that names WHICH leg
// failed rather than a bare null. The discovery sweep (src/discovery-sweep.ts), the manual
// parse_recipe tool (src/discovery-tools.ts), and the operator feed-probe (src/admin.ts) all
// wrap this one helper so their verdicts can never drift — the sweep's parked `reason` and
// parse_recipe's structured error are the SAME taxonomy by construction.
//
// This is acquisition only (fetch + parse). It does NO corpus idempotency lookup and NO
// classification — those stay with the callers (parse_recipe resolves existing_slug; the
// sweep classifies). Throw-free: a network failure or a non-2xx surfaces as `unreachable`
// (the bot-wall case too — see src/http.ts), never an exception.

import { fetchWithBrowserHeaders } from "./http.js";
import { extractJsonLd, findRecipe, normalizeRecipe, type NormalizedRecipe } from "./jsonld.js";

/** Why a page could not be acquired as a parseable recipe — the same taxonomy parse_recipe
 *  returns as structured errors. `unreachable` covers both a thrown fetch and a non-2xx. */
export type AcquireReason = "unreachable" | "no_jsonld" | "not_a_recipe" | "incomplete";

export type AcquireResult =
  | { ok: true; recipe: NormalizedRecipe }
  | { ok: false; reason: AcquireReason; status?: number; missing?: string[] };

/**
 * Fetch `url` and parse it to a normalized schema.org Recipe. On failure returns the specific
 * reason (and the HTTP status for a non-2xx, the `missing` fields for an incomplete recipe)
 * instead of throwing. `fetchImpl` is injectable so tests can stub the network.
 */
export async function acquireRecipeContent(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AcquireResult> {
  let res: Response;
  try {
    res = await fetchWithBrowserHeaders(url, fetchImpl);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!res.ok) return { ok: false, reason: "unreachable", status: res.status };

  const blocks = await extractJsonLd(res);
  if (blocks.length === 0) return { ok: false, reason: "no_jsonld" };

  const recipe = findRecipe(blocks);
  if (!recipe) return { ok: false, reason: "not_a_recipe" };

  const norm = normalizeRecipe(recipe);
  if (!norm.ok) return { ok: false, reason: "incomplete", missing: norm.missing };

  return { ok: true, recipe: norm.recipe };
}
