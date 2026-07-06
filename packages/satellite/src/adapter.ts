// The adapter plugin model + the injected SDK. An adapter handles ONE source's two
// responsibilities the daemon needs per tick: `discover` (yield candidate recipe URLs)
// and `extract` (turn a fetched page into the wire-contract RecipeItem). Session
// establishment (`authenticate` in the spec) is decoupled — captured out-of-band and
// consumed via the SDK — so an adapter never logs in; it only reads/uses the session.
//
// Base adapters ship in the image (keyed by name in BUILTIN_ADAPTERS); operator adapters
// load at runtime from the mounted adapters_dir as modules default-exporting a factory
// `(sdk) => SourceAdapter`. Every adapter's emitted item is validated against the shared
// contract (parseRecipeItem) before the satellite will push it — an adapter cannot smuggle a
// non-contract shape onto the wire.

import { parseRecipeItem, type RecipeItem, type LocalRejectCategory } from "@grocery-agent/contract";
import { pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { SatelliteConfig, SourceConfig } from "./config.js";
import type { FetchResult } from "./fetch.js";
import type { StorageState } from "./session.js";

/** A minimal structured logger the SDK hands adapters (and the daemon uses). */
export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/**
 * The shared SDK injected into every adapter: fetch-via-the-selected-tier, the SAME
 * workerd-pure recipe parse the Worker uses (so `extract` reuses it and only overrides
 * when a source lacks structured data), the source's config + loaded session, and a logger.
 */
export interface Sdk {
  /** The source this SDK instance is bound to. */
  source: SourceConfig;
  /** The machine's config (for adapters_dir, connector, etc.). */
  config: SatelliteConfig;
  /** The source's loaded session (null when none captured — extract may still work on public pages). */
  session: StorageState | null;
  /** Fetch a URL through this source's selected tier (HTTP or browser), replaying the session. */
  fetch(url: string): Promise<FetchResult>;
  /** The generic JSON-LD page → RecipeItem parse (extract → findRecipe → normalize → strip). */
  parsePageToRecipe(html: string, url: string): RecipeItem | { error: string };
  log: Logger;
}

/**
 * A source adapter. `discover` may return an array or an async iterable (a large archive can
 * be streamed during backfill). `extract` is given the already-fetched HTML so the daemon
 * controls the fetch tier; it returns the wire item or a structured error to skip.
 */
export interface SourceAdapter {
  id: string;
  discover(sdk: Sdk): Promise<string[]> | AsyncIterable<string>;
  extract(sdk: Sdk, url: string, html: string): RecipeItem | { error: string };
}

/** An operator adapter module's default export: a factory over the SDK. */
export type AdapterFactory = (sdk: Sdk) => SourceAdapter;

/**
 * Validate an adapter's emitted extract() result against the shared contract. Passes a
 * structured error through unchanged (a fetch/extract skip — NOT a local-reject); validates a
 * claimed item and converts a contract violation into a structured error TAGGED `contract_invalid`
 * so the daemon skips it rather than pushing garbage, and the scheduler can fold that drop into the
 * push batch's `local_rejects` summary (satellite-source-audit). Only the contract-parse branch
 * carries a `category`; a passed-through adapter error does not (it is not a shape reject).
 */
export function validateEmit(emitted: RecipeItem | { error: string }): RecipeItem | { error: string; category?: LocalRejectCategory } {
  if ("error" in emitted) return emitted;
  const parsed = parseRecipeItem(emitted);
  if (!parsed.ok) return { error: `adapter emitted an invalid item: ${parsed.error}`, category: "contract_invalid" };
  return parsed.value;
}

// --- built-in adapters -------------------------------------------------------

// The generic adapter's factory is imported here and registered by name. Additional base
// adapters would be added to this map; site-specific extraction is operator/community code.
import { createJsonLdAdapter } from "./adapters/jsonld.js";

/** Built-in adapter factories, keyed by the `adapter` name a source config references. */
export const BUILTIN_ADAPTERS: Record<string, AdapterFactory> = {
  jsonld: createJsonLdAdapter,
};

/**
 * Load all adapter factories available to this machine: the built-ins plus any operator
 * modules in `config.adapters_dir` (files ending .mjs/.js/.ts default-exporting a factory).
 * The module's basename (sans extension) is its adapter name; an operator module may
 * override a built-in by using the same name. Returns a name → factory map; instantiation
 * (calling the factory with a per-source SDK) happens later in the scheduler.
 */
export async function loadAdapters(config: SatelliteConfig): Promise<Record<string, AdapterFactory>> {
  const adapters: Record<string, AdapterFactory> = { ...BUILTIN_ADAPTERS };
  if (!config.adapters_dir) return adapters;

  let entries: string[];
  try {
    entries = readdirSync(config.adapters_dir);
  } catch {
    // A missing adapters_dir is not fatal — the operator may reference only built-ins.
    return adapters;
  }

  for (const file of entries) {
    if (!/\.(mjs|js|ts)$/.test(file)) continue;
    const name = file.replace(/\.(mjs|js|ts)$/, "");
    const modUrl = pathToFileURL(join(config.adapters_dir, file)).href;
    const mod = (await import(modUrl)) as { default?: unknown };
    if (typeof mod.default !== "function") {
      throw new Error(`operator adapter ${file} must default-export a factory (sdk) => SourceAdapter`);
    }
    adapters[name] = mod.default as AdapterFactory;
  }
  return adapters;
}
