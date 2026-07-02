#!/usr/bin/env -S npx tsx
// The operator CLI. Verbs:
//   run [--watch]        one scrape tick over all sources; --watch loops on the schedule
//   test <source> <url>  dry-run: fetch+extract+validate one URL, print the item, no POST
//   login <source>       headful Playwright → capture + save the source's session
//   backfill <source>    discover + push the whole archive for one source
//   cookie-import <source> <storageState.json>   import an exported browser session
//
// Arg parsing is dependency-free. The daemon wires the real deps (filesystem sessions, the
// selected fetch tier reusing one browser, the built-in + operator adapters) into runTick;
// the pure orchestration lives in scheduler.ts.

import { loadRuntimeContext, type RuntimeContext, type SourceConfig, type ScanStoreConfig } from "./config.js";
import { loadAdapters } from "./adapter.js";
import { createBrowserTier, selectTier, type FetchTier } from "./fetch.js";
import { parsePageToRecipe } from "./jsonld.js";
import { loadSession, saveSession, importSession, looksLikeAuthWall, type StorageState } from "./session.js";
import { Cursor } from "./cursor.js";
import { runTick, type TickDeps } from "./scheduler.js";
import { runPullTick, buildPullDeps } from "./pull.js";
import { loadSaleAdapters, runScanAdapter, type ScanSdk } from "./sale-adapter.js";
import { SATELLITE_VERSION } from "./push.js";

/** A plain console logger — structured extras are appended as JSON for grep-ability. */
const log = {
  info: (msg: string, extra?: Record<string, unknown>) => console.log(fmt("info", msg, extra)),
  warn: (msg: string, extra?: Record<string, unknown>) => console.warn(fmt("warn", msg, extra)),
  error: (msg: string, extra?: Record<string, unknown>) => console.error(fmt("error", msg, extra)),
};
function fmt(level: string, msg: string, extra?: Record<string, unknown>): string {
  const base = `[${new Date().toISOString()}] ${level} ${msg}`;
  return extra && Object.keys(extra).length ? `${base} ${JSON.stringify(extra)}` : base;
}

/** Find a source by id or exit with a clear message. */
function requireSource(ctx: RuntimeContext, id: string): SourceConfig {
  const source = ctx.config.sources.find((s) => s.id === id);
  if (!source) {
    console.error(`unknown source "${id}". configured: ${ctx.config.sources.map((s) => s.id).join(", ") || "(none)"}`);
    process.exit(1);
  }
  return source;
}

/**
 * Resolve a SESSION SCOPE (for `login`/`cookie-import`) — a recipe source id OR a sale-scan store
 * slug, since both key a session file the same way (by that id). Returns the id + a start URL to
 * seed the login browser; exits with a clear message when the id is neither.
 */
function requireSessionScope(ctx: RuntimeContext, id: string): { id: string; startUrl: string } {
  const source = ctx.config.sources.find((s) => s.id === id);
  if (source) return { id, startUrl: source.sitemap_url ?? source.feed_url ?? ctx.config.connector_url };
  const store = ctx.config.scan_stores?.find((s) => s.store === id);
  if (store) return { id, startUrl: ctx.config.connector_url };
  const sources = ctx.config.sources.map((s) => s.id);
  const stores = (ctx.config.scan_stores ?? []).map((s) => s.store);
  console.error(`unknown session scope "${id}". sources: ${sources.join(", ") || "(none)"}; scan_stores: ${stores.join(", ") || "(none)"}`);
  process.exit(1);
}

/** Build the real deps for the scheduler, sharing one browser tier across browser-tier sources. */
async function buildTickDeps(ctx: RuntimeContext, browserTier: FetchTier, overrides: Partial<TickDeps> = {}): Promise<TickDeps> {
  const adapters = await loadAdapters(ctx.config);
  const cursor = Cursor.load(ctx.configDir);
  return {
    loadSession: (sourceId: string) => loadSession(ctx.configDir, sourceId),
    tierFor: (source: SourceConfig) => selectTier(source, browserTier),
    adapters,
    cursor,
    fetchImpl: fetch as unknown as TickDeps["fetchImpl"],
    connectorUrl: ctx.config.connector_url,
    ingestKey: ctx.ingestKey,
    log,
    ...overrides,
  };
}

/** Log the per-source summary array in a compact line each. */
function reportSummaries(summaries: Awaited<ReturnType<typeof runTick>>): void {
  for (const s of summaries) {
    log.info("source result", {
      source: s.source,
      pushed: s.pushed,
      failed: s.failed,
      skippedSeen: s.skippedSeen,
      authExpired: s.authExpired,
      push: s.push,
    });
  }
}

/** Parse a `--schedule`-ish interval to milliseconds. Accepts "30m", "2h", "45s", or bare ms. */
function scheduleToMs(schedule: string | undefined): number {
  if (!schedule) return 6 * 60 * 60 * 1000; // default: every 6h
  const m = /^(\d+)\s*(s|m|h|d)?$/.exec(schedule.trim());
  if (!m) return 6 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = m[2] ?? "ms";
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 1;
  return n * mult;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- verbs -------------------------------------------------------------------

/** `run [--watch]` — one tick, or loop on the schedule. Runs the recipe push tick AND (when the
 *  machine declares `[[scan_stores]]`) the outbound-only sale-scan pull tick, sharing one browser. */
async function cmdRun(watch: boolean): Promise<void> {
  const ctx = loadRuntimeContext();
  const browserTier = createBrowserTier();
  const scanStores = ctx.config.scan_stores ?? [];
  try {
    const deps = await buildTickDeps(ctx, browserTier);
    const pullDeps = scanStores.length
      ? await buildPullDeps(ctx.config, ctx.ingestKey, ctx.configDir, browserTier, loadSession, selectTier, log)
      : null;
    do {
      log.info("tick start", { sources: ctx.config.sources.length, scan_stores: scanStores.length, version: SATELLITE_VERSION });
      if (ctx.config.sources.length) {
        const summaries = await runTick(ctx.config, deps);
        reportSummaries(summaries);
      }
      if (pullDeps) {
        const pull = await runPullTick(ctx.config, pullDeps);
        log.info("sale-scan pull result", { ...pull });
      }
      if (watch) {
        const ms = scheduleToMs(ctx.config.schedule);
        log.info("sleeping until next tick", { ms });
        await sleep(ms);
      }
    } while (watch);
  } finally {
    await browserTier.close();
  }
}

/**
 * `test <store> <locationId> [terms...]` — dry-run a SALE-SCAN adapter (satellite-sale-scan):
 * run the operator adapter behind the store's session, validate each emitted `sale` observation
 * locally against the shared contract, and PRINT them — reporting NOTHING to the Worker. Lets the
 * operator verify a scan adapter before going live.
 */
async function cmdTestScan(store: ScanStoreConfig, locationId: string, terms: string[]): Promise<void> {
  const ctx = loadRuntimeContext();
  const browserTier = createBrowserTier();
  try {
    const adapters = await loadSaleAdapters(ctx.config);
    const factory = adapters[store.adapter];
    if (!factory) {
      console.error(`no sale adapter "${store.adapter}" for store "${store.store}" (drop it in ${ctx.config.adapters_dir ?? "adapters_dir"})`);
      process.exit(1);
    }
    const session = loadSession(ctx.configDir, store.store);
    const tier = selectTier(store, browserTier);
    const sdk: ScanSdk = { store, config: ctx.config, session, fetch: (u: string) => tier.fetch(u, session), log };
    const adapter = factory(sdk);
    const outcome = await runScanAdapter(sdk, adapter, { store: store.store, locationId, terms });
    if ("error" in outcome) {
      console.error(`scan error: ${outcome.error}`);
      process.exit(2);
    }
    for (const r of outcome.rejected) console.error(`rejected (would NOT report): ${r.reason}`);
    log.info("scan dry-run", { store: store.store, locationId, terms, observations: outcome.observations.length, rejected: outcome.rejected.length });
    // The validated observations it WOULD report (nothing is sent).
    console.log(JSON.stringify(outcome.observations, null, 2));
  } finally {
    await browserTier.close();
  }
}

/** `test <source> <url>` — dry-run one URL: fetch + extract + validate, print, no POST. */
async function cmdTest(sourceId: string, url: string): Promise<void> {
  const ctx = loadRuntimeContext();
  const source = requireSource(ctx, sourceId);
  const browserTier = createBrowserTier();
  try {
    const adapters = await loadAdapters(ctx.config);
    const factory = adapters[source.adapter];
    if (!factory) {
      console.error(`no adapter "${source.adapter}" for source "${sourceId}"`);
      process.exit(1);
    }
    const session = loadSession(ctx.configDir, sourceId);
    const tier = selectTier(source, browserTier);
    const sdk = {
      source,
      config: ctx.config,
      session,
      fetch: (u: string) => tier.fetch(u, session),
      parsePageToRecipe,
      log,
    };
    const adapter = factory(sdk);
    const { html, finalUrl, status } = await tier.fetch(url, session);
    log.info("fetched", { url, finalUrl, status, bytes: html.length });
    if (looksLikeAuthWall(finalUrl, html)) {
      console.error("AUTH WALL: this page looks like a login/paywall — the session is missing or expired.");
      process.exit(2);
    }
    const emitted = adapter.extract(sdk, url, html);
    if ("error" in emitted) {
      console.error(`extract error: ${emitted.error}`);
      process.exit(2);
    }
    // Validate locally exactly as the push would, then print the item it WOULD push.
    console.log(JSON.stringify(emitted, null, 2));
  } finally {
    await browserTier.close();
  }
}

/** `backfill <source>` — discover + push the whole archive (mode forced to backfill). */
async function cmdBackfill(sourceId: string): Promise<void> {
  const ctx = loadRuntimeContext();
  const source = requireSource(ctx, sourceId);
  const backfillSource: SourceConfig = { ...source, mode: "backfill" };
  // A one-source config so runTick processes only this source in backfill mode.
  const oneSourceConfig = { ...ctx.config, sources: [backfillSource] };
  const browserTier = createBrowserTier();
  try {
    const deps = await buildTickDeps(ctx, browserTier);
    log.info("backfill start", { source: sourceId });
    const summaries = await runTick(oneSourceConfig, deps);
    reportSummaries(summaries);
  } finally {
    await browserTier.close();
  }
}

/**
 * `login <source>` — capture the operator's session in a HEADFUL browser and save its
 * storageState. Needs a display (see the README/Dockerfile for the container path). Lazy
 * Playwright import so the daemon never loads it.
 */
async function cmdLogin(sourceId: string): Promise<void> {
  const ctx = loadRuntimeContext();
  // A recipe source id OR a sale-scan store slug — both capture a session keyed by that id.
  const { startUrl } = requireSessionScope(ctx, sourceId);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Seed navigation to the source so the operator lands somewhere useful to log in.
    try {
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    } catch {
      // Non-fatal — the operator can navigate manually.
    }
    console.log(
      `A browser window opened. Log in to "${sourceId}" with YOUR OWN subscription, then return here and press Enter to save the session.`,
    );
    await waitForEnter();
    const state = (await context.storageState()) as unknown as StorageState;
    saveSession(ctx.configDir, sourceId, state);
    log.info("session saved", { source: sourceId, cookies: state.cookies.length });
  } finally {
    await browser.close();
  }
}

/** `cookie-import <source|store> <storageState.json>` — import an exported browser session. */
function cmdCookieImport(sourceId: string, path: string): void {
  const ctx = loadRuntimeContext();
  requireSessionScope(ctx, sourceId); // a recipe source id OR a sale-scan store slug
  const state = importSession(ctx.configDir, sourceId, path);
  log.info("session imported", { source: sourceId, cookies: state.cookies.length });
}

/** Resolve when the operator presses Enter on stdin (for the interactive login). */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

// --- arg parsing / dispatch --------------------------------------------------

function usage(): never {
  console.error(
    [
      "grocery-satellite <verb> [args]",
      "",
      "  run [--watch]                     one tick: recipe push + sale-scan pull (--watch loops on schedule)",
      "  test <source> <url>               dry-run one recipe URL: fetch+extract+validate, print item, no POST",
      "  test <store> <loc> [terms...]     dry-run a sale-scan adapter for a store: print observations, no report",
      "  login <source>                    headful browser to capture + save the source's session",
      "  cookie-import <source> <file>     import an exported storageState JSON as the source's session",
      "  backfill <source>                 discover + push the whole archive for one source",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [verb, ...rest] = process.argv.slice(2);
  switch (verb) {
    case "run":
      await cmdRun(rest.includes("--watch"));
      break;
    case "test": {
      const [first, second, ...more] = rest;
      if (!first || !second) usage();
      // A configured scan-store slug as the first arg → the sale-scan dry-run (store, locationId,
      // terms…); otherwise the recipe dry-run (source, url). Detection avoids a second verb.
      const scanStore = loadRuntimeContext().config.scan_stores?.find((s) => s.store === first);
      if (scanStore) await cmdTestScan(scanStore, second, more);
      else await cmdTest(first, second);
      break;
    }
    case "backfill": {
      const [sourceId] = rest;
      if (!sourceId) usage();
      await cmdBackfill(sourceId);
      break;
    }
    case "login": {
      const [sourceId] = rest;
      if (!sourceId) usage();
      await cmdLogin(sourceId);
      break;
    }
    case "cookie-import": {
      const [sourceId, path] = rest;
      if (!sourceId || !path) usage();
      cmdCookieImport(sourceId, path);
      break;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
