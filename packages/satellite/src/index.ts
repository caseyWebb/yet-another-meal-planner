// @grocery-agent/satellite — the home-network satellite. Public surface:
// the config loader, the Node layer-1 JSON-LD extractor + shared parse, fact-stripping, the
// session helpers, the tiered fetch, the adapter plugin model + generic adapter, the push
// layer, the dedup cursor, and the scheduler's `runTick`. The CLI (src/cli.ts, the `bin`)
// wires these together for the operator verbs.

export const SATELLITE_PACKAGE = "@grocery-agent/satellite";

// config
export {
  parseConfig,
  parseConfigToml,
  loadRuntimeContext,
  type SatelliteConfig,
  type SourceConfig,
  type RuntimeContext,
} from "./config.js";

// layer-1 extraction + shared parse
export { extractJsonLdBlocks, parsePageToRecipe } from "./jsonld.js";

// fact-stripping
export { toRecipeItem } from "./strip.js";

// session capture / replay / expiry
export {
  sessionPath,
  loadSession,
  saveSession,
  importSession,
  cookieHeaderFor,
  looksLikeAuthWall,
  type StorageState,
  type StorageStateCookie,
} from "./session.js";

// tiered fetch
export {
  httpTier,
  createBrowserTier,
  selectTier,
  type FetchTier,
  type FetchResult,
} from "./fetch.js";

// adapters
export {
  loadAdapters,
  validateEmit,
  BUILTIN_ADAPTERS,
  type SourceAdapter,
  type AdapterFactory,
  type Sdk,
  type Logger,
} from "./adapter.js";
export { createJsonLdAdapter, extractUrlsFromXml } from "./adapters/jsonld.js";

// push
export {
  buildBatch,
  pushBatch,
  SATELLITE_VERSION,
  type PushOutcome,
  type PushOptions,
  type FetchImpl,
} from "./push.js";

// cursor
export { Cursor, canonicalizeUrl, cursorPath } from "./cursor.js";

// scheduler
export { runTick, type TickDeps, type SourceSummary } from "./scheduler.js";
