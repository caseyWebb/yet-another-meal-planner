// The sale-scan adapter plugin model + its SDK (satellite-sale-scan), parallel to the recipe
// SourceAdapter in ./adapter.ts. A sale-scan adapter observes a store's in-store/loyalty sale
// prices behind the operator's captured session and emits RAW `sale` observations (sensor-not-
// judge — never a derived saving; the Worker re-derives everything). Every emitted observation is
// validated against the shared contract (`parseSaleObservation`) before the satellite will report
// it, so an adapter cannot smuggle a non-contract shape or a `savings` field onto the wire.
//
// There is NO generic sale parse analogous to JSON-LD recipe parse (loyalty pages carry no standard
// sale schema), so a sale adapter is always site-specific operator code — and consistent with the
// initiative principle (core ships host + contract + SDK, users ship the ToS-hostile drivers), NO
// built-in named-retailer sale adapter ships: scan adapters load only from the mounted adapters_dir.

import { parseSaleObservation, type SaleObservation, type SaleScanPayload } from "@grocery-agent/contract";
import { pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { SatelliteConfig, ScanStoreConfig } from "./config.js";
import type { FetchResult } from "./fetch.js";
import type { StorageState } from "./session.js";
import type { Logger } from "./adapter.js";

/**
 * The SDK injected into a sale-scan adapter — the same tiered fetch, captured-session consumption,
 * and logger the recipe SDK exposes, minus the recipe parse (loyalty pages have no standard schema).
 */
export interface ScanSdk {
  /** The scan store this SDK instance is bound to. */
  store: ScanStoreConfig;
  /** The machine's config (adapters_dir, connector, etc.). */
  config: SatelliteConfig;
  /** The store's loaded session (null when none captured — a public price page may still work). */
  session: StorageState | null;
  /** Fetch a URL through this store's selected tier (HTTP or browser), replaying the session. */
  fetch(url: string): Promise<FetchResult>;
  log: Logger;
}

/** The target a `sale-scan` task instructs the adapter to observe (from the task payload). */
export type ScanTarget = SaleScanPayload;

/**
 * A sale-scan adapter. `scan` observes the store for the target's broad `terms` and returns the RAW
 * `sale` observations it found, or a structured error to fail the task (e.g. the session expired).
 */
export interface SaleScanAdapter {
  id: string;
  scan(sdk: ScanSdk, target: ScanTarget): Promise<SaleObservation[] | { error: string }>;
}

/** An operator sale adapter module's default export: a factory over the ScanSdk. */
export type SaleAdapterFactory = (sdk: ScanSdk) => SaleScanAdapter;

/** Derived-judgment keys a sensor-not-judge adapter must NEVER emit — the Worker re-derives these. */
const JUDGMENT_KEYS = ["savings", "savings_pct", "savingsPct", "on_sale", "onSale", "sale"] as const;

/**
 * Validate ONE emitted observation against the shared contract before the satellite will report it.
 * Returns the parsed observation, or a structured error the caller treats as a local skip — an
 * adapter cannot push a non-contract shape or a smuggled derived field. A derived-JUDGMENT field
 * (`savings`/`on_sale`/…) is REJECTED loudly rather than silently stripped, so a misbehaving adapter
 * surfaces to the operator instead of quietly shipping a judgment (the Worker also strips defensively).
 */
export function validateSaleEmit(emitted: unknown): { ok: true; value: SaleObservation } | { ok: false; error: string } {
  if (emitted !== null && typeof emitted === "object") {
    for (const k of JUDGMENT_KEYS) {
      if (k in (emitted as Record<string, unknown>)) {
        return { ok: false, error: `sensor-not-judge violation: adapter emitted a derived "${k}" field (report only raw { regular, promo })` };
      }
    }
  }
  const parsed = parseSaleObservation(emitted);
  if (!parsed.ok) return { ok: false, error: `adapter emitted an invalid sale observation: ${parsed.error}` };
  return { ok: true, value: parsed.value };
}

/** The outcome of running one store's scan adapter: the validated observations + any local rejects. */
export interface ScanOutcome {
  observations: SaleObservation[];
  /** Emitted items rejected locally (a non-contract shape / smuggled saving) — logged, never reported. */
  rejected: { reason: string }[];
}

/**
 * Run one sale-scan adapter and VALIDATE every emit locally (never reporting a non-contract shape).
 * A structured adapter error (`{ error }`) is surfaced so the caller reports the task `failed`;
 * otherwise the validated observations + the locally-rejected count are returned. Never throws — an
 * adapter throw is caught and surfaced as an error so one bad adapter never crashes the pull loop.
 */
export async function runScanAdapter(
  sdk: ScanSdk,
  adapter: SaleScanAdapter,
  target: ScanTarget,
): Promise<ScanOutcome | { error: string }> {
  let emitted: SaleObservation[] | { error: string };
  try {
    emitted = await adapter.scan(sdk, target);
  } catch (err) {
    return { error: `scan threw: ${(err as Error).message}` };
  }
  if (emitted && typeof emitted === "object" && "error" in emitted) return { error: emitted.error };

  const observations: SaleObservation[] = [];
  const rejected: { reason: string }[] = [];
  for (const raw of emitted as unknown[]) {
    const v = validateSaleEmit(raw);
    if (v.ok) observations.push(v.value);
    else rejected.push({ reason: v.error });
  }
  return { observations, rejected };
}

/**
 * Load the operator sale-scan adapter factories from `config.adapters_dir` (modules ending
 * .mjs/.js/.ts default-exporting a factory `(sdk) => SaleScanAdapter`). The module's basename is
 * its adapter name. UNLIKE the recipe loader, there are NO built-ins — a store's scan adapter is
 * always operator-authored (the ToS-hostile driver the core does not ship). A missing adapters_dir
 * yields an empty map (the machine references no scan adapter).
 */
export async function loadSaleAdapters(config: SatelliteConfig): Promise<Record<string, SaleAdapterFactory>> {
  const adapters: Record<string, SaleAdapterFactory> = {};
  if (!config.adapters_dir) return adapters;

  let entries: string[];
  try {
    entries = readdirSync(config.adapters_dir);
  } catch {
    return adapters; // a missing dir is not fatal — validated again when a task needs an adapter
  }

  for (const file of entries) {
    if (!/\.(mjs|js|ts)$/.test(file)) continue;
    const name = file.replace(/\.(mjs|js|ts)$/, "");
    const modUrl = pathToFileURL(join(config.adapters_dir, file)).href;
    const mod = (await import(modUrl)) as { default?: unknown };
    if (typeof mod.default !== "function") {
      throw new Error(`operator sale adapter ${file} must default-export a factory (sdk) => SaleScanAdapter`);
    }
    adapters[name] = mod.default as SaleAdapterFactory;
  }
  return adapters;
}
