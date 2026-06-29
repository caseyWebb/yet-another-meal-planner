// Operator feed-probe (operator-admin capability). Runs FROM the Worker's edge egress
// and reuses the SAME acquisition helper the discovery sweep uses (src/recipe-acquire.ts),
// so an operator's verdict matches what the autonomous sweep would actually do. Writes nothing.

import { fetchWithBrowserHeaders, readTextCapped } from "./http.js";
import { parseFeed } from "./feeds.js";
import { acquireRecipeContent } from "./recipe-acquire.js";

/** Entry pages sampled per feed test — bounds the live subrequests one operator click costs. */
export const PROBE_SAMPLE_SIZE = 5;

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
    items = parseFeed(await readTextCapped(res));
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
