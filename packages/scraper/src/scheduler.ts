// The scheduler: `runTick` orchestrates one pass over every configured source —
//   load session (missing/corrupt → auth_expired, skip) → discover → filter unseen via the
//   cursor → fetch + extract + validate each candidate → batch + push per source with
//   backoff → mark pushed URLs seen.
// It is PURE orchestration over injected deps (session loader, tier factory, adapters, push,
// cursor, logger), so the whole flow is testable with in-memory fakes — no network, no
// browser, no filesystem. The CLI wires the real deps; tests wire fakes.

import type { RecipeItem } from "@grocery-agent/contract";
import type { ScraperConfig, SourceConfig } from "./config.js";
import type { AdapterFactory, Sdk, SourceAdapter } from "./adapter.js";
import { validateEmit } from "./adapter.js";
import type { FetchResult, FetchTier } from "./fetch.js";
import { parsePageToRecipe } from "./jsonld.js";
import { buildBatch, pushBatch, type FetchImpl, type PushOptions, type PushOutcome } from "./push.js";
import type { StorageState } from "./session.js";
import { looksLikeAuthWall } from "./session.js";
import type { Logger } from "./adapter.js";

/** Per-source outcome the tick reports (rolled up for the operator liveness view). */
export interface SourceSummary {
  source: string;
  /** Recipe items accepted by the push (0 when auth_expired/skipped). */
  pushed: number;
  /** Candidates that failed extraction/validation/fetch and were skipped. */
  failed: number;
  /** Candidates already in the cursor and not re-fetched. */
  skippedSeen: number;
  /** True when the source's session was missing/expired — the operator must re-capture. */
  authExpired: boolean;
  /** The coarse push result, when a push was attempted. */
  push?: PushOutcome["result"];
}

/** Everything runTick needs, injected so it's testable without real I/O. */
export interface TickDeps {
  /** Load a source's session (real: from the volume; fake: in-memory). Null when uncaptured. */
  loadSession(sourceId: string): StorageState | null;
  /** The fetch tier to use for a source (real: selectTier over a shared browser; fake: canned). */
  tierFor(source: SourceConfig): FetchTier;
  /** Adapter factories by name (from loadAdapters). */
  adapters: Record<string, AdapterFactory>;
  /** Cursor membership + recording (real: the Cursor class; fake: a Set). */
  cursor: { has(url: string): boolean; add(url: string): void; save(): void };
  /** The push transport (real: global fetch; fake: canned responses). */
  fetchImpl: FetchImpl;
  /** The ingest key + connector, for the push. */
  connectorUrl: string;
  ingestKey: string;
  log: Logger;
  /** Push retry knobs (tests set a tiny/zero backoff). */
  pushOptions?: PushOptions;
  /** Per-tick candidate cap per source (backfill sets this high; incremental modest). */
  maxPerSource?: number;
}

/** Run one candidate URL through fetch → extract → validate. Returns the item, an auth signal, or a skip. */
async function processCandidate(
  sdk: Sdk,
  adapter: SourceAdapter,
  tier: FetchTier,
  session: StorageState | null,
  url: string,
): Promise<{ kind: "item"; item: RecipeItem } | { kind: "auth_expired" } | { kind: "skip"; reason: string }> {
  let fetched: FetchResult;
  try {
    fetched = await tier.fetch(url, session);
  } catch (err) {
    return { kind: "skip", reason: `fetch error: ${(err as Error).message}` };
  }
  if (looksLikeAuthWall(fetched.finalUrl, fetched.html)) return { kind: "auth_expired" };
  if (fetched.status >= 400) return { kind: "skip", reason: `http ${fetched.status}` };

  const emitted = adapter.extract(sdk, url, fetched.html);
  const validated = validateEmit(emitted);
  if ("error" in validated) return { kind: "skip", reason: validated.error };
  return { kind: "item", item: validated };
}

/** Drain discover()'s result (array or async iterable) to a bounded array of candidate URLs. */
async function collectDiscovered(adapter: SourceAdapter, sdk: Sdk, cap: number): Promise<string[]> {
  const discovered = await adapter.discover(sdk);
  if (Array.isArray(discovered)) return discovered.slice(0, cap);
  const out: string[] = [];
  for await (const u of discovered) {
    out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}

/** Process one source end-to-end, returning its summary. Never throws — errors become skips/logs. */
async function runSource(config: ScraperConfig, source: SourceConfig, deps: TickDeps): Promise<SourceSummary> {
  const summary: SourceSummary = { source: source.id, pushed: 0, failed: 0, skippedSeen: 0, authExpired: false };

  const factory = deps.adapters[source.adapter];
  if (!factory) {
    deps.log.error("no adapter for source", { source: source.id, adapter: source.adapter });
    summary.failed = 1;
    return summary;
  }

  // Session: a missing/corrupt one is auth_expired — surfaced, not silently dropped.
  const session = deps.loadSession(source.id);
  if (!session) {
    deps.log.warn("no session for source — reporting auth_expired", { source: source.id });
    summary.authExpired = true;
    return summary;
  }

  const tier = deps.tierFor(source);
  const sdk: Sdk = {
    source,
    config,
    session,
    fetch: (url: string) => tier.fetch(url, session),
    parsePageToRecipe,
    log: deps.log,
  };
  const adapter = factory(sdk);

  // Discover → filter unseen (unless a backfill, which re-scans the whole archive).
  const cap = deps.maxPerSource ?? (source.mode === "backfill" ? 10_000 : 500);
  let discovered: string[];
  try {
    discovered = await collectDiscovered(adapter, sdk, cap);
  } catch (err) {
    deps.log.error("discover failed", { source: source.id, error: (err as Error).message });
    summary.failed = 1;
    return summary;
  }

  const candidates =
    source.mode === "backfill" ? discovered : discovered.filter((u) => !deps.cursor.has(u));
  summary.skippedSeen = discovered.length - candidates.length;

  // Fetch + extract + validate each candidate; collect the items.
  const items: RecipeItem[] = [];
  const pushedUrls: string[] = [];
  for (const url of candidates) {
    const result = await processCandidate(sdk, adapter, tier, session, url);
    if (result.kind === "auth_expired") {
      // One authwalled fetch means the session is dead — stop and surface it.
      deps.log.warn("auth wall hit — reporting auth_expired", { source: source.id, url });
      summary.authExpired = true;
      return summary;
    }
    if (result.kind === "skip") {
      deps.log.info("skipped candidate", { source: source.id, url, reason: result.reason });
      summary.failed++;
      continue;
    }
    items.push(result.item);
    pushedUrls.push(url);
  }

  if (items.length === 0) return summary;

  // One batch per source.
  const batch = buildBatch(source.id, items);
  const outcome = await pushBatch(deps.connectorUrl, deps.ingestKey, batch, deps.fetchImpl, deps.pushOptions);
  summary.push = outcome.result;

  if (outcome.result === "accepted" || outcome.result === "partial") {
    summary.pushed = outcome.response.accepted;
    // Mark every attempted URL seen — deduped ones are still "done" from our side.
    for (const u of pushedUrls) deps.cursor.add(u);
    deps.cursor.save();
  } else {
    deps.log.error("push failed", { source: source.id, result: outcome.result });
  }

  return summary;
}

/** Run one tick over all configured sources, returning a per-source summary array. */
export async function runTick(config: ScraperConfig, deps: TickDeps): Promise<SourceSummary[]> {
  const summaries: SourceSummary[] = [];
  for (const source of config.sources) {
    summaries.push(await runSource(config, source, deps));
  }
  return summaries;
}
