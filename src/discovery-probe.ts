// Operator feed-probe + parked-row re-probe (operator-admin capability). Both run FROM the
// Worker's edge egress and reuse the SAME acquisition helper the discovery sweep uses
// (src/recipe-acquire.ts), so an operator's verdict matches what the autonomous sweep would
// actually do. Neither imports a recipe nor mutates the feed set; the re-probe touches only the
// `detail` of the rows it re-classifies. Throw-free at the acquisition layer (a wall surfaces
// as `unreachable`), so a single dead page can't wedge a probe.

import type { Env } from "./env.js";
import { fetchWithBrowserHeaders } from "./http.js";
import { parseFeed } from "./feeds.js";
import { acquireRecipeContent } from "./recipe-acquire.js";
import { readLegacyUnreachable, updateDiscoveryDetail } from "./discovery-db.js";

/** Entry pages sampled per feed test — bounds the live subrequests one operator click costs. */
export const PROBE_SAMPLE_SIZE = 5;
/** Legacy `unreachable` rows re-classified per re-probe call — bounds the subrequest budget so
 *  a large backlog drains in controlled batches across several operator clicks. */
export const REPROBE_BATCH_CAP = 25;

/** A sampled entry page's verdict: `ok` (a parseable recipe) or the specific failure reason. */
export interface SampleOutcome {
  url: string;
  outcome: "ok" | "unreachable" | "no_jsonld" | "not_a_recipe" | "incomplete";
  status?: number;
}

export interface FeedProbeResult {
  feed: {
    /** The feed URL itself fetched with a 2xx. */
    reachable: boolean;
    /** HTTP status of the feed fetch (absent when the fetch threw). */
    status?: number;
    /** The body parsed as RSS/Atom and yielded at least one item. */
    parsed: boolean;
    /** Items the feed yielded. */
    itemCount: number;
  };
  /** Per-sampled-entry verdicts (empty when the feed was unreachable or empty). */
  sample: SampleOutcome[];
}

/** Map an `acquireRecipeContent` result to a sampled-entry verdict. */
function toSampleOutcome(url: string, result: Awaited<ReturnType<typeof acquireRecipeContent>>): SampleOutcome {
  if (result.ok) return { url, outcome: "ok" };
  return { url, outcome: result.reason, ...(result.status !== undefined ? { status: result.status } : {}) };
}

/**
 * Probe a discovery feed from the edge: fetch the feed URL, report whether it parses as
 * RSS/Atom and how many items it yields, then run the sweep's acquisition path against the
 * first `PROBE_SAMPLE_SIZE` entry pages — so the operator sees whether the feed AND its entries
 * are actually viable from the Worker's egress (which differs from their browser). Writes nothing.
 */
export async function probeFeed(url: string): Promise<FeedProbeResult> {
  let res: Response;
  try {
    res = await fetchWithBrowserHeaders(url);
  } catch {
    return { feed: { reachable: false, parsed: false, itemCount: 0 }, sample: [] };
  }
  if (!res.ok) {
    return { feed: { reachable: false, status: res.status, parsed: false, itemCount: 0 }, sample: [] };
  }

  // A 200 with an unparseable body is "reachable but not a usable feed" — the same verdict the
  // sweep reaches by wrapping its parseFeed in a try/catch (src/discovery-sweep.ts). Surface it
  // as `parsed: false` rather than letting a malformed-XML throw escape as a 500.
  let items: ReturnType<typeof parseFeed>;
  try {
    items = parseFeed(await res.text());
  } catch {
    return { feed: { reachable: true, status: res.status, parsed: false, itemCount: 0 }, sample: [] };
  }
  const feed = { reachable: true, status: res.status, parsed: items.length > 0, itemCount: items.length };

  const sampled = items.slice(0, PROBE_SAMPLE_SIZE);
  const sample = await Promise.all(
    sampled.map(async (item) => toSampleOutcome(item.link, await acquireRecipeContent(item.link))),
  );
  return { feed, sample };
}

export interface ReprobeResult {
  /** Legacy `unreachable` rows examined this call (≤ REPROBE_BATCH_CAP). */
  scanned: number;
  /** Rows whose reason became a specific failure (no_jsonld / not_a_recipe / incomplete). */
  reclassified: number;
  /** Rows that still could not be fetched (kept `unreachable`). */
  stillUnreachable: number;
  /** Rows that now acquire a parseable recipe (the original park was stale). */
  nowAcquirable: number;
}

/**
 * Re-classify a bounded batch of parked `error` rows still carrying the legacy catch-all
 * `detail.reason = 'unreachable'`: re-fetch each through the shared acquisition helper and
 * rewrite its `detail.reason` in place to the specific outcome (or leave `unreachable`). Rows
 * already carrying a specific reason are excluded by the query, so re-running drains the
 * remaining unreachable rows without redoing settled ones. Imports nothing.
 */
export async function reprobeParked(env: Env): Promise<ReprobeResult> {
  const rows = await readLegacyUnreachable(env, REPROBE_BATCH_CAP);
  const result: ReprobeResult = { scanned: rows.length, reclassified: 0, stillUnreachable: 0, nowAcquirable: 0 };

  for (const row of rows) {
    if (!row.url) continue;
    const acquired = await acquireRecipeContent(row.url);
    if (acquired.ok) {
      // The page now yields a valid recipe — the original park was stale (a transient outage, or
      // the site added JSON-LD). Relabel `ok` so the operator can see it recovered. The row STAYS
      // parked (`outcome` is untouched — the re-probe imports nothing, by design): its URL is
      // already in the sweep's evaluated-set, so re-importing is a manual re-add, not automatic.
      await updateDiscoveryDetail(env, row.id, { reason: "ok" });
      result.nowAcquirable++;
    } else if (acquired.reason === "unreachable") {
      // Keep unreachable, refreshing the recorded status if the fetch now carries one.
      await updateDiscoveryDetail(env, row.id, {
        reason: "unreachable",
        ...(acquired.status !== undefined ? { status: acquired.status } : {}),
      });
      result.stillUnreachable++;
    } else {
      await updateDiscoveryDetail(env, row.id, { reason: acquired.reason });
      result.reclassified++;
    }
  }
  return result;
}
